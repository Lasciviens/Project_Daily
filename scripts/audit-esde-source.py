#!/usr/bin/env python3
"""Read-only source inventory for a ten-game ES-DE completeness audit.

Does not connect to Supabase or modify the card. Writes the explicitly requested
JSON output only. Selection is deterministic and deliberately includes a broken
SNES cover; this is a coverage sample, not a random prevalence estimate.
"""
import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET

EXCLUDED = {'androidapps', 'androidgames', 'emulators', 'steam', 'CLEANUP'}
SYSTEMS = ['dreamcast', 'gba', 'gc', 'genesis', 'n64', 'nes', 'ps2', 'psp', 'snes', 'switch']
VIDEO = {'.mp4', '.flv', '.mkv', '.avi', '.webm', '.mov', '.m4v'}


def run(root):
    media = root / 'downloaded_media'
    if not media.is_dir():
        raise ValueError('Live downloaded_media directory required')
    totals = defaultdict(lambda: {'files': 0, 'bytes': 0, 'empty': 0})
    index = defaultdict(list)
    for path in sorted(media.rglob('*')):
        if not path.is_file() or path.is_symlink() or path.name.startswith('._'):
            continue
        parts = path.relative_to(media).parts
        if len(parts) < 3:
            continue
        system, category = parts[:2]
        size = path.stat().st_size
        counts = totals[category]
        counts['files'] += 1; counts['bytes'] += size; counts['empty'] += size == 0
        relative = Path(*parts[2:])
        index[(system, str(relative.with_suffix('')))].append({
            'category': category, 'relative_path': str(path.relative_to(media)),
            'bytes': size, 'video': category == 'videos' or path.suffix.lower() in VIDEO,
        })
    tags = Counter(); candidates = defaultdict(list); top_level = Counter()
    for source in sorted((root / 'gamelists').glob('*/gamelist.xml')):
        system = source.parent.name
        if system in EXCLUDED or source.is_symlink():
            continue
        text = re.sub(r'^\s*<\?xml\s[^?]*\?>', '', source.read_text(encoding='utf-8-sig'), count=1)
        document = ET.fromstring('<audit>' + text + '</audit>')
        top_level.update(element.tag for element in document)
        for element in document.findall('gameList/game'):
            raw = {child.tag: child.text for child in element}
            tags.update(raw.keys())
            if not raw.get('path') or raw.get('hidden') == 'true':
                continue
            relative = Path(raw['path'])
            rom = (root.parent / 'ROMs' / system / relative).resolve()
            system_root = (root.parent / 'ROMs' / system).resolve()
            if not rom.is_relative_to(system_root) or not rom.exists():
                continue
            if system == 'switch' and re.search(r'\[(?:DLC|UPD|UPDATE)\b|\[(0100[0-9a-f]{9}800)\]', relative.stem, re.I):
                continue
            assets = index.get((system, str(relative.with_suffix(''))), [])
            candidates[system].append({'system': system, 'path': raw['path'], 'name': raw.get('name'),
                'xml': raw, 'attributes': element.attrib, 'assets': assets})
    selected = []
    for system in SYSTEMS:
        choices = candidates[system]
        if not choices:
            raise ValueError(f'No sample candidate in {system}')
        def rank(game):
            assets = game['assets']
            empty_cover = any(a['category'] == 'covers' and not a['bytes'] for a in assets)
            nonvideo = sum(not a['video'] and bool(a['bytes']) for a in assets)
            favorite = game['xml'].get('favorite') == 'true'
            return (-(system == 'snes' and empty_cover), -favorite, -nonvideo, game['name'] or '')
        selected.append(sorted(choices, key=rank)[0])
    return {'source': str(root), 'selection': 'One per listed system, prefer favorite and rich media; SNES includes an empty cover',
        'media_totals_all_files': dict(totals), 'xml_tag_counts_all_game_entries': dict(tags),
        'xml_top_level_tags': dict(top_level), 'samples': selected}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--esde', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    result = run(args.esde.resolve())
    args.output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n')
    for sample in result['samples']:
        good = [a for a in sample['assets'] if not a['video'] and a['bytes']]
        print(sample['system'], sample['name'], 'valid-size non-video files:', len(good))
