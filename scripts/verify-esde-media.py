#!/usr/bin/env python3
"""Offline safeguards for the coordinated handheld sync; requires Pillow."""
import argparse
from contextlib import redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from PIL import Image

spec = importlib.util.spec_from_file_location("sync", Path(__file__).with_name("sync-esde.py"))
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


class Tests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.base = Path(temp.name)
        self.root = self.base / "ES-DE/gamelists"
        self.roms = self.base / "ROMs"
        (self.root / "nes").mkdir(parents=True)
        (self.roms / "nes/sub").mkdir(parents=True)
        (self.roms / "nes/sub/game.nes").write_bytes(b"rom")
        (self.root / "nes/gamelist.xml").write_text('<gameList><game><path>./sub/game.nes</path><name>Game</name></game></gameList>')
        self.media = self.base / "ES-DE/downloaded_media"
        self.media.mkdir()
        self.args = argparse.Namespace(dry_run=False, covers_only=False, allow_large_delete=False,
            full=False, roms=self.roms, state=self.base / "state.json", timezone="Europe/Oslo", attempts=1, timeout=1)
        self.capture = redirect_stdout(io.StringIO())
        self.capture.__enter__()
        self.addCleanup(self.capture.__exit__, None, None, None)

    def test_missing_card_and_system_never_delete(self):
        active, systems = sync.snapshot(self.root, self.roms)
        variant = dict(id="v", esde_system="snes", esde_path="./x", updated_at="date")
        with self.assertRaisesRegex(ValueError, "Remote systems missing"):
            sync.deletion_plan({"v": variant}, active, systems)
        (self.roms / "nes").rename(self.roms / "unmounted")
        with self.assertRaisesRegex(ValueError, "System ROM directory unavailable"):
            sync.snapshot(self.root, self.roms)

    def test_deleted_rom_with_stale_xml_and_mass_guard(self):
        active, systems = sync.snapshot(self.root, self.roms)
        remote = {str(i): dict(id=str(i), esde_system="nes", esde_path=f"./deleted{i}.nes", updated_at="stamp") for i in range(100)}
        with self.assertRaisesRegex(ValueError, "safety limit"):
            sync.deletion_plan(remote, active, systems)
        self.assertEqual(len(sync.deletion_plan(remote, active, systems, True)), 100)
        self.assertEqual(sync.deletion_plan({"0": remote["0"]}, active, systems)[0]["updated_at"], "stamp")

    def test_nested_cover_compression_cache_and_source_unchanged(self):
        game = {"system": "nes", "path": "./sub/game.nes"}
        target = self.media / "nes/covers/sub/game.png"
        target.parent.mkdir(parents=True)
        Image.new("RGB", (2000, 3000), "red").save(target)
        original = target.read_bytes()
        self.assertEqual(sync.cover_path(self.media, game), target.resolve())
        content, digest = sync.optimized_cover(target, self.base / "cache")
        self.assertEqual(sync.optimized_cover(target, self.base / "cache"), (content, digest))
        with Image.open(io.BytesIO(content)) as picture:
            self.assertEqual(picture.format, "WEBP")
            self.assertLessEqual(max(picture.size), 640)
        self.assertEqual(target.read_bytes(), original)
        with self.assertRaises(ValueError):
            sync.cover_path(self.media, {"system": "nes", "path": "../../escape.nes"})

    def test_cover_only_never_imports_or_deletes(self):
        self.args.covers_only = True
        with patch.object(sync, "inventory", return_value=({}, "https://test/")), patch.object(sync.push, "sync") as imp, patch.object(sync, "request") as req:
            sync.synchronize(self.args, self.root, self.roms, self.media, "https://test.supabase.co", "secret")
        imp.assert_not_called()
        req.assert_not_called()

    def test_changed_library_blocks_deletion(self):
        active, signature = sync.snapshot(self.root, self.roms)
        with patch.object(sync, "snapshot", side_effect=[(active, signature), (active, {"nes": "changed"})]), patch.object(sync, "inventory", return_value=({}, "https://test/")), patch.object(sync.push, "sync"), patch.object(sync, "request") as req:
            with self.assertRaisesRegex(ValueError, "changed during sync"):
                sync.synchronize(self.args, self.root, self.roms, self.media, "https://test.supabase.co", "secret")
        req.assert_not_called()

    def test_failed_delete_is_saved_and_retry_cleans_it(self):
        remote = {"deleted": dict(id="v", esde_system="nes", esde_path="./deleted.nes", updated_at="stamp")}
        with patch.object(sync, "inventory", return_value=(remote, "https://test/")), patch.object(sync.push, "sync"), patch.object(sync, "request", side_effect=ValueError("network")):
            with self.assertRaisesRegex(ValueError, "network"):
                sync.synchronize(self.args, self.root, self.roms, self.media, "https://test.supabase.co", "secret")
        pending = self.base / "pending-deletions.json"
        saved = json.loads(pending.read_text())
        self.assertEqual(saved["entries"][0]["id"], "v")
        self.assertNotIn("secret", pending.read_text())
        with patch.object(sync, "inventory", return_value=({}, "https://test/")), patch.object(sync.push, "sync"), patch.object(sync, "request", return_value={"status": "ok", "deleted_variants": 0}) as req:
            sync.synchronize(self.args, self.root, self.roms, self.media, "https://test.supabase.co", "secret")
        req.assert_called_once()
        self.assertFalse(pending.exists())

    def test_dry_run_has_no_network_or_state(self):
        self.args.dry_run = True
        with patch.object(sync, "request") as req:
            sync.synchronize(self.args, self.root, self.roms, self.media, "", "")
        req.assert_not_called()
        self.assertFalse(self.args.state.exists())

    def test_empty_cover_reported_without_altering_original(self):
        empty = self.base / "empty.png"
        empty.touch()
        with self.assertRaisesRegex(sync.BadCover, "Unreadable cover"):
            sync.optimized_cover(empty, self.base / "cache")
        self.assertEqual(empty.stat().st_size, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
