#!/usr/bin/env python3
"""Manual RP6/Termux push. Wire contract: screenscraper-integration.md §10.

Python standard library only. See scripts/esde-push-README.md for setup.
"""

import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import http.client
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET


EXCLUDED = {"androidapps", "androidgames", "emulators", "steam", "CLEANUP"}
TEXT_FIELDS = ("path", "name", "desc", "developer", "publisher", "genre",
               "players", "releasedate", "lastplayed")
STATS = ("playcount", "playtime", "lastplayed")
FILTER_VERSION = 2


class PendingStateError(ValueError):
    pass


def addon_reason(system, path):
    """Only explicit Switch package labels; never guess from a game's title."""
    if system != "switch":
        return None
    stem = Path(path).stem
    # A combined package is still a playable game, not a standalone update.
    if re.search(r"\[BASE\s*\+", stem, re.I):
        return None
    title_ids = set(re.findall(r"\[(0100[0-9a-f]{12})\]", stem, re.I))
    if len(title_ids) == 1 and Path(path).suffix.lower() in {".nsp", ".nsz"}:
        title_id = next(iter(title_ids))
        # Switch update ProgramIds have 0x800 set; base applications end in 000.
        if title_id.lower().endswith("800"):
            return "update_title_id"
    parts = Path(path).parts
    if any(re.fullmatch(r"(?:\d+\s+)?(?:dlcs?|updates?|upgrades?)", p, re.I)
           for p in parts[:-1]):
        return "addon_folder"
    if re.search(r"\[(?:DLC|UPD|UPDATE|UPGRADE)(?:\b|[-_])[^\]]*\]", stem, re.I):
        return "addon_package"
    if re.search(r"\sDLC$|\s(?:Update|Upgrade)\s+(?:v?\d[\w.-]*)$", stem, re.I):
        return "addon_package"
    return None


def rom_location(root, roms=None):
    result = (roms if roms is not None else root.parent.parent / "ROMs").expanduser().resolve()
    # Actually enumerate: an unreadable/unmounted card must not look like an empty library.
    if not result.is_dir() or not list(result.iterdir()):
        raise ValueError(f"ROM directory missing or empty: {result}; mount the card or use --roms")
    return result


def rom_exists(roms, system, path):
    base = (roms / system).resolve()
    target = (base / path).resolve()
    if not target.is_relative_to(base):
        raise ValueError(f"ROM path is outside its system directory: {system} {path}")
    try:
        target.stat()  # Permission and I/O failures must propagate, not count as deleted ROMs.
    except FileNotFoundError:
        return False
    return True


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def key(game):
    return encode([game["system"], game["path"]])


def fingerprint(raw):
    # Missing and explicit zero remain different, including in local state.
    return hashlib.sha256(encode({k: raw[k] for k in STATS if k in raw}).encode()).hexdigest()


def read_library(root, roms=None, audit=None):
    if root.name != "gamelists" or "CLEANUP" in root.parts:
        raise ValueError("--gamelists must point to the live gamelists directory")
    roms = rom_location(root, roms)
    rows, seen = [], set()
    counts = dict(systems=0, excluded_systems=0, folders=0, sidecars=0, missing_roms=0, addons=0)
    files = 0
    # Deliberately one level only: never descend into dated CLEANUP snapshots.
    for directory in sorted(root.iterdir()):
        if directory.name in EXCLUDED:
            counts["excluded_systems"] += 1
            continue
        if not directory.is_dir() or directory.is_symlink():
            continue
        source = directory / "gamelist.xml"
        if not source.exists() or source.is_symlink():
            continue
        files += 1
        # ES-DE writes <alternativeEmulator> beside <gameList> in some systems.
        # Wrap this XML fragment, after removing only its XML declaration.
        xml = source.read_text(encoding="utf-8-sig")
        xml = re.sub(r"^\s*<\?xml\s[^?]*\?>", "", xml, count=1)
        try:
            document = ET.fromstring("<esdeDocument>" + xml + "</esdeDocument>")
        except ET.ParseError as error:
            raise ValueError(f"{source}: incomplete/invalid XML ({error}); close ES-DE and retry") from None
        lists = document.findall("gameList")
        if len(lists) != 1:
            raise ValueError(f"{source}: expected exactly one <gameList>")
        tree = lists[0]
        counts["folders"] += len(tree.findall("folder"))
        before = len(rows)
        for index, element in enumerate(tree.findall("game")):
            where = f"{source}, game index {index}"
            raw = {}
            for child in element:
                # Unknown/repeated extension tags are preserved by content sync;
                # only the scalar import contract needs duplicate rejection here.
                if child.tag not in set(TEXT_FIELDS) | {"playcount", "playtime", "rating", "hidden", "broken"}:
                    continue
                if child.tag in raw:
                    raise ValueError(f"{where}: duplicate <{child.tag}>")
                if child.text is not None and child.text.strip():
                    raw[child.tag] = child.text
            if raw.get("path", "").rsplit("/", 1)[-1].startswith("._"):
                counts["sidecars"] += 1
                continue
            for required in ("path", "name"):
                if required not in raw:
                    raise ValueError(f"{where}: {required} is required; nothing sent")
            reason = addon_reason(directory.name, raw["path"])
            if reason:
                counts["addons"] += 1
            elif not rom_exists(roms, directory.name, raw["path"]):
                reason = "missing_rom"
                counts["missing_roms"] += 1
            if reason:
                if audit is not None:
                    audit.append({"system": directory.name, "path": raw["path"],
                                  "name": raw["name"], "reason": reason})
                continue
            game = {"system": directory.name}
            game.update({field: raw[field] for field in TEXT_FIELDS if field in raw})
            # Only XML -> JSON scalar typing; never units, dates or path conversion.
            for field in ("playcount", "playtime"):
                if field in raw:
                    if not re.fullmatch(r"[0-9]+", raw[field]):
                        raise ValueError(f"{where}: invalid {field}")
                    game[field] = int(raw[field])
            if "rating" in raw:
                rating = float(raw["rating"])
                if not math.isfinite(rating) or not 0 <= rating <= 1:
                    raise ValueError(f"{where}: invalid rating")
                game["rating"] = rating
            for field in ("hidden", "broken"):
                if field in raw:
                    if raw[field] not in ("true", "false"):
                        raise ValueError(f"{where}: invalid {field}")
                    game[field] = raw[field] == "true"
            identity = key(game)
            if identity in seen:
                raise ValueError(f"{where}: duplicate (system, path)")
            seen.add(identity)
            rows.append((game, fingerprint(raw)))
        counts["systems"] += int(len(rows) > before)
    if not files:
        raise ValueError(f"No live per-system gamelist.xml files found in {root}")
    print(f"Library: {len(rows)} games; " + "; ".join(f"{k}={v}" for k, v in counts.items()))
    return rows


def save_state(path, state):
    # Commit through a same-directory atomic rename; secret is never persisted.
    fd, temporary = tempfile.mkstemp(prefix=".esde-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(encode(state))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def load_state(path, context):
    fresh = {"version": 1, "context": context, "fingerprints": {}, "pending": None}
    def require(condition):
        if not condition:
            raise ValueError("Invalid state")

    def valid_fingerprints(values):
        return isinstance(values, dict) and all(
            isinstance(k, str) and isinstance(v, str) and re.fullmatch(r"[a-f0-9]{64}", v)
            for k, v in values.items())

    try:
        state = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(state, dict) and state.get("context") != context and state.get("pending"):
            raise PendingStateError("Configuration/filter changed with a pending batch; reconcile the old state before sending")
        require(state["version"] == 1 and state["context"] == context)
        require(valid_fingerprints(state["fingerprints"]))
        pending = state["pending"]
        if pending is not None:
            body = json.loads(pending["body"])
            require(body["action"] == "import_esde_games")
            require(isinstance(body["games"], list) and 1 <= len(body["games"]) <= 150)
            require(body["timezone"] == context["timezone"])
            require(valid_fingerprints(pending["fingerprints"]))
            require(set(pending["fingerprints"]) == {key(g) for g in body["games"]})
        return state
    except PendingStateError:
        raise
    except FileNotFoundError:
        print("No local state: full push on this run.")
    except (ValueError, KeyError, TypeError):
        print("Local state invalid or configuration changed: falling back to full push.")
    return fresh


@contextmanager
def state_lock(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(str(path) + ".lock", "a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError("Another push is using this state file") from None
        yield


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward the device secret to a redirect destination.


class RejectedBatch(Exception):
    pass


def post_batch(endpoint, secret, body, attempts, timeout):
    wire = body.encode("utf-8")
    opener = urllib.request.build_opener(NoRedirect())
    for attempt in range(attempts):
        request = urllib.request.Request(endpoint, data=wire, method="POST", headers={
            "Content-Type": "application/json", "x-esde-secret": secret,
        })
        try:
            with opener.open(request, timeout=timeout) as response:
                result = json.load(response)
            expected = len(json.loads(body)["games"])
            counters = ("created", "updated", "skipped", "flagged")
            if (not isinstance(result, dict) or result.get("status") != "ok"
                    or result.get("received") != expected
                    or any(type(result.get(k)) is not int or result[k] < 0 for k in counters)
                    or sum(result[k] for k in counters[:3]) != expected
                    or result["flagged"] > result["created"] + result["updated"]):
                raise ValueError("Unexpected success response; batch remains pending")
            print("Batch result: " + encode({k: result[k] for k in counters}))
            return
        except urllib.error.HTTPError as error:
            # Avoid printing arbitrary server text (which could echo headers).
            if error.code == 400:
                try:
                    details = json.loads(error.read()).get("errors", {})
                    print("HTTP 400: whole batch rejected; zero-based entry errors: "
                          + encode(details).replace(secret, "[REDACTED]"))
                except (ValueError, AttributeError):
                    print("HTTP 400: whole batch rejected (unreadable error body)")
                raise RejectedBatch("Fix the reported XML entries/configuration and run again") from None
            if error.code not in (408, 429) and not 500 <= error.code < 600:
                raise ValueError(f"HTTP {error.code}: stopped; batch retained unchanged") from None
            reason = f"HTTP {error.code}"
        except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.HTTPException):
            reason = "network error/timeout"
        except (ValueError, UnicodeError):
            reason = "invalid or incomplete success response"
        if attempt + 1 == attempts:
            raise ValueError(f"{reason}: retries exhausted; batch retained unchanged")
        delay = min(2 ** (attempt + 1), 30)
        print(f"{reason}; retrying identical batch in {delay}s ({attempt + 2}/{attempts})")
        time.sleep(delay)


def sync(args, root, endpoint, secret, state_path):
    roms = rom_location(root, getattr(args, "roms", None))
    context = {"gamelists": str(root), "endpoint": endpoint, "timezone": args.timezone,
               "roms": str(roms), "filter_version": FILTER_VERSION}
    state = load_state(state_path, context)
    audit = []
    rows = read_library(root, roms, audit)
    report = getattr(args, "report", None)
    if report:
        report.expanduser().write_text(encode({"eligible": len(rows), "excluded": audit}) + "\n", encoding="utf-8")

    def deliver():
        pending = state["pending"]
        try:
            post_batch(endpoint, secret, pending["body"], args.attempts, args.timeout)
        except RejectedBatch:
            # 400 guarantees no writes: discard rejected body so corrected XML can be read.
            state["pending"] = None
            save_state(state_path, state)
            raise
        state["fingerprints"].update(pending["fingerprints"])
        state["pending"] = None
        save_state(state_path, state)

    if state["pending"] and not args.dry_run:
        eligible = {key(g) for g, _ in rows}
        if not set(state["pending"]["fingerprints"]).issubset(eligible):
            raise ValueError("Pending batch contains now-excluded games; reconcile state before resuming")
        print("Resending saved pending batch unchanged after checking current ROM eligibility.")
        deliver()
    remote_keys = getattr(args, "remote_keys", None)
    changed = [(g, fp) for g, fp in rows
               if args.full or state["fingerprints"].get(key(g)) != fp
               or (remote_keys is not None and not g.get("hidden") and key(g) not in remote_keys)]
    batches = math.ceil(len(changed) / 150)
    print(f"Selected: {len(changed)} games in {batches} requests (max 150 each).")
    if args.dry_run:
        if state["pending"]:
            print("A saved pending batch will also be replayed first on an actual push.")
        print("Dry run: no network requests or local state writes.")
        return
    for offset in range(0, len(changed), 150):
        batch = changed[offset:offset + 150]
        number = offset // 150 + 1
        body = {"action": "import_esde_games", "timezone": args.timezone,
                "batch": number, "batches": batches, "games": [g for g, _ in batch]}
        state["pending"] = {"body": encode(body),
                            "fingerprints": {key(g): fp for g, fp in batch}}
        save_state(state_path, state)
        print(f"Sending batch {number}/{batches} ({len(batch)} games)")
        deliver()
    print("Push complete." if changed else "Already up to date.")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gamelists", required=True, type=Path, help="Live ES-DE/gamelists directory")
    parser.add_argument("--roms", type=Path, help="ROM root; defaults to the ROMs sibling of ES-DE")
    parser.add_argument("--report", type=Path, help="Write an exclusion audit JSON (also during dry-run)")
    parser.add_argument("--state", type=Path, default=Path.home() / ".local/state/esde-sync/state.json")
    parser.add_argument("--timezone", default="Europe/Oslo")
    parser.add_argument("--dry-run", action="store_true", help="Read/diff only; no credentials required")
    parser.add_argument("--full", action="store_true", help="Resend every eligible game")
    parser.add_argument("--attempts", type=int, choices=range(1, 6), default=3)
    parser.add_argument("--timeout", type=int, choices=range(1, 121), default=30)
    args = parser.parse_args(argv)
    try:
        base = os.environ.get("SUPABASE_URL", "").rstrip("/")
        if base and not re.fullmatch(r"https://[a-z0-9-]+\.supabase\.co", base):
            raise ValueError("SUPABASE_URL must be https://<project>.supabase.co")
        endpoint = base + "/functions/v1/esde-sync" if base else ""
        secret = os.environ.get("ESDE_SYNC_SECRET", "")
        if not args.dry_run and (not base or not secret):
            raise ValueError("Set SUPABASE_URL and ESDE_SYNC_SECRET in the environment")
        root, state_path = args.gamelists.expanduser().resolve(), args.state.expanduser().absolute()
        if args.dry_run:
            sync(args, root, endpoint, secret, state_path)
        else:
            with state_lock(state_path):
                sync(args, root, endpoint, secret, state_path)
        return 0
    except (OSError, ValueError, ET.ParseError, RejectedBatch) as error:
        message = str(error)
        secret = os.environ.get("ESDE_SYNC_SECRET", "")
        print("Error: " + (message.replace(secret, "[REDACTED]") if secret else message), file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Interrupted. A pending batch, if any, will be replayed on the next run.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())
