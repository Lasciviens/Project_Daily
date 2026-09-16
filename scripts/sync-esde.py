#!/usr/bin/env python3
"""ES-DE games, play statistics, covers and explicit deletions in one manual run."""
import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import http.client
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import time
import urllib.error
import urllib.request

spec = importlib.util.spec_from_file_location("push", Path(__file__).with_name("push-esde-library.py"))
push = importlib.util.module_from_spec(spec)
spec.loader.exec_module(push)
CONFIG = Path.home() / ".config/esde-sync"


class APIError(ValueError):
    def __init__(self, status):
        self.status = status
        super().__init__(f"HTTP {status}; nothing marked complete. Run again after fixing the cause.")


class BadCover(ValueError):
    pass


def request(endpoint, secret, body):
    wire = push.encode(body).encode()
    opener = urllib.request.build_opener(push.NoRedirect())
    for attempt in range(3):
        try:
            req = urllib.request.Request(endpoint, data=wire, method="POST", headers={
                "Content-Type": "application/json", "x-esde-secret": secret})
            with opener.open(req, timeout=60) as response:
                result = json.load(response)
            if not isinstance(result, dict) or result.get("status") != "ok":
                raise ValueError("Invalid success response")
            return result
        except urllib.error.HTTPError as error:
            if error.code not in (408, 429) and not 500 <= error.code < 600:
                raise APIError(error.code) from None
            reason = f"HTTP {error.code}"
        except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.HTTPException):
            reason = "Network interrupted"
        if attempt == 2:
            raise ValueError(reason + "; retry limit reached. Run again to resume.")
        print(f"{reason}; retrying in {2 ** (attempt + 1)} seconds", flush=True)
        time.sleep(2 ** (attempt + 1))


def inventory(endpoint, secret):
    result = {}; prefix = None
    for page in range(10000):
        response = request(endpoint, secret, {"action": "inventory", "page": page})
        if not isinstance(response.get("variants"), list) or type(response.get("more")) is not bool:
            raise ValueError("Incomplete remote inventory")
        current_prefix = response.get("managed_prefix")
        if not isinstance(current_prefix, str) or (prefix and prefix != current_prefix):
            raise ValueError("Inventory destination changed")
        prefix = current_prefix
        for variant in response["variants"]:
            identity = push.encode([variant["esde_system"], variant["esde_path"]])
            if identity in result:
                raise ValueError("Remote inventory changed during pagination; retry")
            result[identity] = variant
        if not response["more"]:
            return result, prefix
    raise ValueError("Remote inventory too large")


def snapshot(root, roms):
    """Only successfully parsed, readable systems may authorize deletion."""
    before = {p.parent.name: hashlib.sha256(p.read_bytes()).hexdigest()
              for p in root.glob("*/gamelist.xml")
              if p.parent.name not in push.EXCLUDED and not p.is_symlink() and not p.parent.is_symlink()}
    rows = push.read_library(root, roms)
    for system, digest in before.items():
        if hashlib.sha256((root / system / "gamelist.xml").read_bytes()).hexdigest() != digest:
            raise ValueError("ES-DE is still saving; close it and retry")
        directory = roms / system
        if not directory.is_dir():
            raise ValueError(f"System ROM directory unavailable: {directory}; no deletion allowed")
        list(directory.iterdir())  # propagate permission/I/O errors
    active = {push.key(game): game for game, _ in rows if not game.get("hidden")}
    if not active:
        raise ValueError("Empty library; refusing automatic reconciliation")
    return active, before


def deletion_plan(remote, active, systems, allow_large=False):
    missing_systems = {v["esde_system"] for v in remote.values()} - set(systems)
    if missing_systems:
        raise ValueError("Remote systems missing from local scan; restore their gamelists/ROM folders: "
                         + ", ".join(sorted(missing_systems)))
    entries = [{"id": v["id"], "system": v["esde_system"], "path": v["esde_path"], "updated_at": v["updated_at"]}
               for identity, v in remote.items() if identity not in active]
    if not allow_large and len(entries) > max(25, len(remote) // 4):
        raise ValueError(f"{len(entries)} deletions exceed the safety limit; inspect --dry-run before --allow-large-delete")
    return entries


def cover_path(media, game):
    directory = (media / game["system"] / "covers").resolve()
    stem = Path(game["path"]).with_suffix("")
    target = (directory / stem).resolve()
    if not target.is_relative_to(directory):
        raise ValueError("Cover path escapes its system directory")
    for extension in (".png", ".jpg", ".jpeg", ".webp", ".PNG", ".JPG"):
        path = Path(str(target) + extension)
        if path.is_file():
            if not path.resolve().is_relative_to(directory):
                raise ValueError("Cover symlink escapes its system directory")
            return path
    return None


def optimized_cover(source, cache):
    from PIL import Image, ImageOps
    raw = source.read_bytes()
    # Conversion parameters are part of the cache identity; originals stay intact.
    source_hash = hashlib.sha256(b"webp-v1-640-q82\0" + raw).hexdigest()
    path = cache / (source_hash + ".webp")
    if path.exists():
        content = path.read_bytes()
    else:
        try:
            with Image.open(io.BytesIO(raw)) as picture:
                picture = ImageOps.exif_transpose(picture)
                picture.thumbnail((640, 640), Image.Resampling.LANCZOS)
                picture = picture.convert("RGBA" if "A" in picture.getbands() else "RGB")
                output = io.BytesIO()
                picture.save(output, "WEBP", quality=82, method=4)
                content = output.getvalue()
        except (OSError, ValueError, Image.DecompressionBombError) as error:
            raise BadCover(f"Unreadable cover: {source}") from error
        if len(content) > 1000000:
            raise ValueError(f"Optimized cover exceeds server limit: {source.name}")
        cache.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix=".cover-", dir=cache)
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(content)
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    return content, hashlib.sha256(content).hexdigest()


def synchronize(args, root, roms, media, base, secret):
    active, signature = snapshot(root, roms)
    if not media.is_dir():
        raise ValueError(f"Media directory unavailable: {media}")
    covers = {identity: cover_path(media, game) for identity, game in active.items()}
    print(f"Active: {len(active)}; covers found: {sum(p is not None for p in covers.values())}; "
          f"missing covers: {sum(p is None for p in covers.values())}", flush=True)
    if args.dry_run:
        print("Local check passed. No network requests, uploads, deletions or state writes.")
        return
    endpoint = base + "/functions/v1/esde-media-sync"
    remote, managed_prefix = inventory(endpoint, secret)
    if not args.covers_only:
        # Validate prospective deletions before starting any writes.
        deletion_plan(remote, active, signature, args.allow_large_delete)
        args.remote_keys = set(remote)
        push.sync(args, root, base + "/functions/v1/esde-sync", secret, args.state)
        remote, managed_prefix = inventory(endpoint, secret)
    uploaded = unchanged = manual = missing_game = corrupt = 0
    uploaded_bytes = 0
    cache = args.state.parent / "covers"
    def send_cover(item):
        identity, game = item
        source = covers[identity]
        if source is None:
            return "missing", 0
        variant = remote.get(identity)
        if variant is None:
            return "missing_game", 0
        url = variant.get("cover_url")
        if url and not url.startswith(managed_prefix):
            return "manual", 0
        try:
            content, digest = optimized_cover(source, cache)
        except BadCover as error:
            return "corrupt", 0
        if url == managed_prefix + variant["id"] + "/" + digest + ".webp":
            return "unchanged", 0
        response = request(endpoint, secret, {"action": "upload_cover", "system": game["system"],
            "path": game["path"], "sha256": digest, "image_base64": base64.b64encode(content).decode("ascii")})
        if response.get("manual_cover"):
            return "manual", 0
        elif response.get("linked") is True:
            return "uploaded", len(content)
        else:
            raise ValueError("Cover was not acknowledged; retry")
    with ThreadPoolExecutor(max_workers=3) as pool:
        def bounded_results():
            items = list(active.items())
            for offset in range(0, len(items), 3):
                yield from pool.map(send_cover, items[offset:offset + 3])
        for index, (status, size) in enumerate(bounded_results(), 1):
            uploaded += status == "uploaded"
            unchanged += status == "unchanged"
            manual += status == "manual"
            missing_game += status == "missing_game"
            corrupt += status == "corrupt"
            uploaded_bytes += size
            if index % 25 == 0:
                print(f"Cover {index}/{len(active)}; uploaded={uploaded}, unchanged={unchanged}", flush=True)
    print(f"Covers: uploaded={uploaded} ({uploaded_bytes / 1048576:.1f} MiB), unchanged={unchanged}, "
          f"manual preserved={manual}, game not imported={missing_game}, corrupt={corrupt}", flush=True)
    if args.covers_only:
        return
    current, current_signature = snapshot(root, roms)
    if current != active or current_signature != signature:
        raise ValueError("Library changed during sync; no deletions performed. Close ES-DE and retry.")
    remote, _ = inventory(endpoint, secret)
    entries = deletion_plan(remote, active, signature, args.allow_large_delete)
    pending_path = args.state.parent / "pending-deletions.json"
    context = {"endpoint": endpoint, "gamelists": str(root), "roms": str(roms)}
    if pending_path.exists():
        pending = json.loads(pending_path.read_text())
        if pending.get("context") != context:
            raise ValueError("Pending deletion belongs to a different destination; review local state")
        saved = pending["entries"]
        # Never replay an old delete if that ROM has since reappeared.
        saved = [e for e in saved if push.key(e) not in active and e["system"] in signature]
        if saved:
            try:
                request(endpoint, secret, {"action": "delete_variants", "entries": saved})
            except APIError as error:
                if error.status != 409:
                    raise
                # Compare-and-swap rejected stale inventory, atomically. Rescan on next run.
                pending_path.unlink()
                raise ValueError("Deletion inventory changed; rerun to rescan") from None
        pending_path.unlink(missing_ok=True)
    deleted = 0
    for offset in range(0, len(entries), 150):
        batch = entries[offset:offset + 150]
        # Recheck card/XML/ROM eligibility immediately before every deletion batch.
        latest, latest_signature = snapshot(root, roms)
        if latest != active or latest_signature != signature:
            raise ValueError("Library changed; deletion stopped")
        push.save_state(pending_path, {"context": context, "entries": batch})
        result = request(endpoint, secret, {"action": "delete_variants", "entries": batch})
        deleted += result["deleted_variants"]
        pending_path.unlink()
    print(f"Sync complete. Removed ES-DE variants: {deleted}", flush=True)


def main(argv=None):
    config = json.loads((CONFIG / "config.json").read_text()) if (CONFIG / "config.json").exists() else {}
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gamelists", type=Path, default=config.get("gamelists"))
    parser.add_argument("--roms", type=Path, default=config.get("roms"))
    parser.add_argument("--media", type=Path, default=config.get("media"))
    parser.add_argument("--state", type=Path, default=Path.home() / ".local/state/esde-sync/state.json")
    parser.add_argument("--timezone", default="Europe/Oslo")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--covers-only", action="store_true")
    parser.add_argument("--allow-large-delete", action="store_true")
    parser.add_argument("--full", action="store_true")
    parser.add_argument("--secret-file", type=Path, default=CONFIG / "secret")
    args = parser.parse_args(argv)
    args.attempts, args.timeout = 3, 60
    secret = ""
    try:
        if args.gamelists is None:
            raise ValueError("Gamelists path missing; run setup-esde-widgets.sh once")
        root = args.gamelists.expanduser().resolve()
        roms = push.rom_location(root, args.roms)
        media = (args.media or root.parent / "downloaded_media").expanduser().resolve()
        base = os.environ.get("SUPABASE_URL", config.get("url", "")).rstrip("/")
        if args.dry_run:
            synchronize(args, root, roms, media, base, "")
            return 0
        if not re.fullmatch(r"https://[a-z0-9-]+\.supabase\.co", base):
            raise ValueError("Invalid or missing Supabase URL")
        secret = os.environ.get("ESDE_SYNC_SECRET", "")
        if not secret and args.secret_file.exists():
            if args.secret_file.stat().st_mode & 0o077:
                raise ValueError("Secret file must be private (chmod 600)")
            secret = args.secret_file.read_text().strip()
        if not secret:
            raise ValueError("Device secret missing; run widget setup once")
        from PIL import Image  # fail before any writes if dependency is missing
        args.state = args.state.expanduser().absolute()
        with push.state_lock(args.state):
            synchronize(args, root, roms, media, base, secret)
        return 0
    except (OSError, ValueError, ImportError, push.RejectedBatch) as error:
        message = str(error)
        print("Error: " + (message.replace(secret, "[REDACTED]") if secret else message), file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Stopped. Run again to resume.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())
