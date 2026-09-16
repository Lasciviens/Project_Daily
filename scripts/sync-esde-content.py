#!/usr/bin/env python3
"""Manual RP6 sync of complete game metadata and original images; no PDF/video."""
import argparse
import base64
from collections import Counter, defaultdict
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
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

spec = importlib.util.spec_from_file_location('basic', Path(__file__).with_name('sync-esde.py'))
basic = importlib.util.module_from_spec(spec)
spec.loader.exec_module(basic)
push = basic.push
IMAGES = {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'}
VIDEOS = {'.mp4', '.flv', '.mkv', '.avi', '.webm', '.mov', '.m4v', '.mpg', '.mpeg'}
MAX_IMAGE = 20000000


def readable_files(directory):
    def failed(error):
        raise error
    for current, directories, files in os.walk(directory, followlinks=False, onerror=failed):
        directories.sort()
        for name in directories:
            if (Path(current) / name).is_symlink():
                raise ValueError('Symlink media directory requires review before reconciliation')
        for name in sorted(files):
            path = Path(current) / name
            if path.is_symlink():
                raise ValueError('Symlink media file requires review before reconciliation')
            yield path


def inventory(endpoint, secret):
    rows = {}
    for page in range(10000):
        response = basic.request(endpoint, secret, {'action': 'inventory', 'page': page})
        if not isinstance(response.get('variants'), list) or type(response.get('more')) is not bool:
            raise ValueError('Invalid content inventory')
        for row in response['variants']:
            identity = push.encode([row['esde_system'], row['esde_path']])
            if identity in rows:
                raise ValueError('Inventory changed during pagination; retry')
            rows[identity] = row
        if not response['more']:
            return rows
    raise ValueError('Inventory too large')


def documents(root, active):
    result = {}
    for system in sorted({game['system'] for game in active.values()}):
        raw = (root / system / 'gamelist.xml').read_text(encoding='utf-8-sig')
        raw = re.sub(r'^\s*<\?xml\s[^?]*\?>', '', raw, count=1)
        parser = ET.XMLParser(target=ET.TreeBuilder(insert_comments=True, insert_pis=True))
        document = ET.fromstring('<esdeDocument>' + raw + '</esdeDocument>', parser=parser)
        gamelist = document.find('gameList')
        if gamelist is None:
            raise ValueError('Missing gameList')
        serialize = lambda element: ET.tostring(element, encoding='unicode')
        context = {'system': system, 'gamelist_attributes': gamelist.attrib,
                   'system_elements': [serialize(e) for e in document if e.tag != 'gameList'],
                   'folder_and_other_elements': [serialize(e) for e in gamelist if e.tag != 'game']}
        for game in gamelist.findall('game'):
            identity = push.encode([system, game.findtext('path')])
            if identity in active:
                value = push.encode({'game': serialize(game), 'context': context})
                if len(value.encode()) > 1000000:
                    raise ValueError(f'Source metadata exceeds supported limit: {system}')
                result[identity] = (value, hashlib.sha256(value.encode()).hexdigest())
    if set(result) != set(active):
        raise ValueError('XML changed during source scan; close ES-DE and retry')
    return result


def asset_manifest(media, active):
    if not media.is_dir():
        raise ValueError(f'Media directory unavailable: {media}')
    by_stem = defaultdict(list)
    for identity, game in active.items():
        by_stem[(game['system'], str(Path(game['path']).with_suffix('')))].append(identity)
    manifest = {identity: {} for identity in active}
    ignored = Counter()
    for system in sorted({g['system'] for g in active.values()}):
        directory = media / system
        if directory.is_symlink() or not directory.is_dir():
            raise ValueError(f'Media system unavailable: {directory}; restore it before syncing')
        for path in readable_files(directory):
            # Never traverse a symlink out of the media tree.
            if path.is_symlink() or not path.is_file() or path.name.startswith('._'):
                continue
            if not path.resolve().is_relative_to(directory.resolve()):
                raise ValueError('Media path escapes system')
            parts = path.relative_to(directory).parts
            if len(parts) < 2:
                ignored['root_files'] += 1; continue
            category = parts[0]
            suffix = path.suffix.lower()
            if category.lower() == 'videos' or suffix in VIDEOS:
                ignored['video'] += 1; continue
            if suffix == '.pdf':
                ignored['pdf'] += 1; continue
            if suffix not in IMAGES or not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', category):
                ignored['unsupported'] += 1; continue
            identities = by_stem.get((system, str(Path(*parts[1:]).with_suffix(''))), [])
            if not identities:
                ignored['unmatched_or_excluded_game'] += 1; continue
            if len(identities) > 1:
                # ES-DE itself shares media for exact same relative stems with
                # different ROM extensions. Keep that association for each variant.
                ignored['shared_exact_stem'] += 1
            stat = path.stat()
            for identity in identities:
                manifest[identity][str(path.relative_to(media))] = {
                    'path': path, 'category': category, 'size': stat.st_size, 'mtime_ns': stat.st_mtime_ns}
    return manifest, ignored


def upload(endpoint, secret, metadata, content):
    header = base64.b64encode(push.encode(metadata).encode()).decode('ascii')
    opener = urllib.request.build_opener(push.NoRedirect())
    for attempt in range(3):
        try:
            req = urllib.request.Request(endpoint + '?action=asset', data=content, method='POST', headers={
                'x-esde-secret': secret, 'x-esde-asset': header, 'Content-Type': 'application/octet-stream'})
            with opener.open(req, timeout=90) as response:
                result = json.load(response)
            if result.get('status') != 'ok' or result.get('saved') is not True:
                raise ValueError('Image acknowledgement missing; rerun to resume')
            return
        except urllib.error.HTTPError as error:
            if error.code not in (408, 429) and not 500 <= error.code < 600:
                raise basic.APIError(error.code) from None
            reason = f'HTTP {error.code}'
        except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.HTTPException):
            reason = 'Network interrupted'
        if attempt == 2:
            raise ValueError(reason + '; rerun to resume image sync')
        print(reason + '; retrying the same image', flush=True)
        time.sleep(2 ** (attempt + 1))


def checked_image(asset):
    from PIL import Image
    path = asset['path']
    if not asset['size'] or asset['size'] > MAX_IMAGE:
        raise basic.BadCover('empty' if not asset['size'] else 'over_20_MB')
    before = path.stat()
    if (before.st_size, before.st_mtime_ns) != (asset['size'], asset['mtime_ns']):
        raise ValueError('Image changed during sync; retry')
    content = path.read_bytes()
    after = path.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns) or len(content) != before.st_size:
        raise ValueError('Image changed while reading; retry')
    # Validate before upload, preserving original bytes rather than recompressing.
    try:
        with Image.open(io.BytesIO(content)) as image:
            if image.format not in {'PNG', 'JPEG', 'WEBP', 'GIF', 'BMP'}:
                raise basic.BadCover('unsupported_image_format')
            image.verify()
    except (OSError, ValueError, Image.DecompressionBombError) as error:
        raise basic.BadCover('invalid_image') from error
    return content, hashlib.sha256(content).hexdigest()


def run(args, root, roms, media, base, secret):
    active, signature = basic.snapshot(root, roms)
    source = {} if args.media_only else documents(root, active)
    if args.metadata_only:
        manifest, ignored = {identity: {} for identity in active}, Counter()
    else:
        manifest, ignored = asset_manifest(media, active)
    total_files = sum(len(v) for v in manifest.values())
    total_bytes = sum(a['size'] for v in manifest.values() for a in v.values())
    print(f'Complete metadata: {len(source)} games; matching image files: {total_files}; '
          f'original bytes: {total_bytes / 1048576:.1f} MiB; PDF/video excluded.', flush=True)
    if args.dry_run:
        print('Local scan only. No upload, deletion or state writes. Image decoding happens during sync.')
        return
    endpoint = base + '/functions/v1/esde-content-sync'
    # Ensure server prerequisites work before the legacy importer changes anything.
    remote = inventory(endpoint, secret)
    if not args.media_only and not args.metadata_only:
        basic.synchronize(args, root, roms, media, base, secret)
    elif args.metadata_only:
        args.remote_keys = set(remote)
        push.sync(args, root, base + '/functions/v1/esde-sync', secret, args.state)
    else:
        args.covers_only = True
        basic.synchronize(args, root, roms, media, base, secret)
    current, current_signature = basic.snapshot(root, roms)
    if current != active or current_signature != signature:
        raise ValueError('Library changed; close ES-DE and retry')
    remote = inventory(endpoint, secret)
    counts = Counter(); bad = []; missing_games = []

    def sync_game(item):
        identity, game = item
        result = Counter(); problems = []
        row = remote.get(identity)
        if not row:
            return result, problems, {'system': game['system'], 'path': game['path']}
        if not args.media_only:
            value, sha = source[identity]
            if row['esde_source_hash'] != sha:
                response = basic.request(endpoint, secret, {'action': 'source', 'variant_id': row['id'], 'source_json': value, 'sha256': sha})
                if response.get('saved') is not True:
                    raise ValueError('Metadata acknowledgement missing')
                result['metadata_saved'] += 1
            else:
                result['metadata_unchanged'] += 1
        if not args.metadata_only:
            for key, asset in manifest[identity].items():
                try:
                    content, sha = checked_image(asset)
                except basic.BadCover as error:
                    problems.append({'path': key, 'reason': str(error)})
                    continue
                existing = (row.get('esde_assets') or {}).get(key, {})
                if existing.get('sha256') == sha and existing.get('size') == len(content):
                    result['images_unchanged'] += 1; continue
                upload(endpoint, secret, {'variant_id': row['id'], 'category': asset['category'],
                       'key': key, 'sha256': sha, 'size': len(content)}, content)
                result['images_uploaded'] += 1; result['bytes_uploaded'] += len(content)
        return result, problems, None

    report_path = args.state.parent / 'content-report.json'
    completed = False
    try:
        items = list(active.items())
        with ThreadPoolExecutor(max_workers=3) as pool:
            # Bound the queue: errors stop after at most three in-flight games.
            for offset in range(0, len(items), 3):
                for result, problems, missing in pool.map(sync_game, items[offset:offset + 3]):
                    counts.update(result); bad.extend(problems)
                    if missing:
                        missing_games.append(missing)
                if offset % 30 == 0:
                    print(f'Content {min(offset + 3,len(items))}/{len(items)}; '
                          f'metadata={counts["metadata_saved"]}; images={counts["images_uploaded"]}; '
                          f'unchanged={counts["images_unchanged"]}; invalid={len(bad)}', flush=True)
        if not args.metadata_only:
            latest, latest_signature = basic.snapshot(root, roms)
            latest_manifest, _ = asset_manifest(media, latest)
            if latest != active or latest_signature != signature or latest_manifest != manifest:
                raise ValueError('Source changed; no image references removed. Retry.')
            removal_batches = []
            remote_asset_count = sum(len(row.get('esde_assets') or {}) for row in remote.values())
            for identity, row in remote.items():
                if identity not in manifest:
                    continue
                entries = []
                for key, asset in (row.get('esde_assets') or {}).items():
                    if key not in manifest[identity]:
                        category = asset['category']
                        if not (media / row['esde_system'] / category).is_dir():
                            raise ValueError('Media category unavailable; image removal stopped')
                        entries.append({'key': key, 'sha256': asset['sha256']})
                removal_batches.append((row['id'], entries))
            if sum(len(entries) for _, entries in removal_batches) > max(25, remote_asset_count // 4) and not args.allow_large_delete:
                raise ValueError('Image reference removal exceeds safety limit; inspect source before --allow-large-delete')
            for variant_id, entries in removal_batches:
                for start in range(0, len(entries), 150):
                    result = basic.request(endpoint, secret, {'action': 'prune', 'variant_id': variant_id, 'entries': entries[start:start + 150]})
                    counts['references_removed'] += result['removed']
        completed = True
    finally:
        push.save_state(report_path, {'completed': completed, 'counts': dict(counts), 'ignored': dict(ignored),
                                     'invalid_images': bad, 'games_not_imported': missing_games})
    print('Content sync complete. ' + push.encode(dict(counts)), flush=True)
    print(f'Invalid/empty images: {len(bad)}; games not imported: {len(missing_games)}. Report: {report_path}', flush=True)
    for item in bad[:3]:
        print(f'  {item["reason"]}: {item["path"]}', flush=True)


def main(argv=None):
    config = json.loads((basic.CONFIG / 'config.json').read_text()) if (basic.CONFIG / 'config.json').exists() else {}
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--gamelists', type=Path, default=config.get('gamelists'))
    parser.add_argument('--roms', type=Path, default=config.get('roms'))
    parser.add_argument('--media', type=Path, default=config.get('media'))
    parser.add_argument('--state', type=Path, default=Path.home() / '.local/state/esde-sync/state.json')
    parser.add_argument('--secret-file', type=Path, default=basic.CONFIG / 'secret')
    parser.add_argument('--timezone', default='Europe/Oslo')
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--media-only', action='store_true')
    group.add_argument('--metadata-only', action='store_true')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--full', action='store_true')
    parser.add_argument('--allow-large-delete', action='store_true')
    args = parser.parse_args(argv)
    args.attempts, args.timeout, args.covers_only = 3, 60, False
    secret = ''
    try:
        if not args.gamelists:
            raise ValueError('Run widget setup first')
        root = args.gamelists.expanduser().resolve()
        roms = push.rom_location(root, args.roms)
        media = (args.media or root.parent / 'downloaded_media').expanduser().resolve()
        base = os.environ.get('SUPABASE_URL', config.get('url', '')).rstrip('/')
        if args.dry_run:
            run(args, root, roms, media, base, '')
            return 0
        if not re.fullmatch(r'https://[a-z0-9-]+\.supabase\.co', base):
            raise ValueError('Invalid Supabase URL')
        secret = os.environ.get('ESDE_SYNC_SECRET', '')
        if not secret and args.secret_file.exists():
            if args.secret_file.stat().st_mode & 0o077:
                raise ValueError('Secret file must have mode 600')
            secret = args.secret_file.read_text().strip()
        if not secret:
            raise ValueError('Device secret missing; run widget setup')
        from PIL import Image
        args.state = args.state.expanduser().absolute()
        with push.state_lock(args.state):
            run(args, root, roms, media, base, secret)
        return 0
    except (OSError, ValueError, ImportError, ET.ParseError, push.RejectedBatch) as error:
        message = str(error)
        print('Error: ' + (message.replace(secret, '[REDACTED]') if secret else message), file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print('Stopped. Run again; acknowledged files will be skipped.', file=sys.stderr)
        return 130


if __name__ == '__main__':
    sys.exit(main())
