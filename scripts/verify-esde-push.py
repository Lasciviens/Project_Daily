#!/usr/bin/env python3
"""Offline regression checks; no dependencies, network or production writes."""
import argparse
from contextlib import redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error
import xml.etree.ElementTree as ET

spec = importlib.util.spec_from_file_location("push", Path(__file__).with_name("push-esde-library.py"))
push = importlib.util.module_from_spec(spec)
spec.loader.exec_module(push)


class PushTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "gamelists"
        self.root.mkdir()
        self.roms = Path(self.temp.name) / "ROMs"
        self.roms.mkdir()
        self.state = Path(self.temp.name) / "state.json"
        self.args = argparse.Namespace(timezone="Europe/Oslo", full=False, dry_run=False,
                                       attempts=1, timeout=2, roms=self.roms)
        self.output = io.StringIO()
        self.capture = redirect_stdout(self.output)
        self.capture.__enter__()
        self.addCleanup(self.capture.__exit__, None, None, None)

    def xml(self, text, system="nes", prefix=""):
        target = self.root / system / "gamelist.xml"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text('<?xml version="1.0"?>' + prefix + '<gameList>' + text + '</gameList>')
        for g in ET.fromstring('<gameList>' + text + '</gameList>').findall('game'):
            rom = self.roms / system / g.findtext('path')
            rom.parent.mkdir(parents=True, exist_ok=True)
            rom.touch()
        return target

    def game(self, i=0, extra=""):
        return f'<game><path>./folder/{i}.zip</path><name>Game {i}</name>{extra}</game>'

    def run_sync(self):
        push.sync(self.args, self.root, "https://example.supabase.co/functions/v1/esde-sync",
                  "test-secret", self.state)

    def test_contract_and_exclusions(self):
        self.xml(self.game(extra='<genre>Racing, Driving</genre><releasedate>19940202T000000</releasedate>'
                          '<lastplayed>20260519T210643</lastplayed><rating>0.9</rating>'
                          '<playcount>0</playcount><hidden>false</hidden><broken>true</broken>'
                          '<desc>  A &amp; B\nC  </desc><publisher/><favorite>true</favorite>')
                 + '<folder><path>./directory</path></folder>'
                 + '<game><path>./sub/._sidecar.zip</path></game>'
                 + '<game><path>./extensionless</path><name>Folder game</name></game>',
                 prefix='<alternativeEmulator><label>Example</label></alternativeEmulator>')
        for system in push.EXCLUDED:
            self.xml(self.game(), system)
        self.xml(self.game(), "CLEANUP/dated/nes")
        rows = push.read_library(self.root, self.roms)
        self.assertEqual(len(rows), 2)
        g = rows[0][0]
        self.assertEqual(g["path"], "./folder/0.zip")
        self.assertEqual(g["genre"], "Racing, Driving")
        self.assertEqual(g["releasedate"], "19940202T000000")
        self.assertEqual(g["lastplayed"], "20260519T210643")
        self.assertEqual(g["rating"], 0.9)
        self.assertEqual(g["playcount"], 0)
        self.assertIs(g["hidden"], False)
        self.assertIs(g["broken"], True)
        self.assertEqual(g["desc"], "  A & B\nC  ")
        for missing in ("playtime", "publisher", "favorite"):
            self.assertNotIn(missing, g)
        self.assertNotEqual(push.fingerprint({}), push.fingerprint({"playcount": "0"}))

    def test_full_incremental_and_state_loss(self):
        self.xml(''.join(self.game(i) for i in range(1125)))
        with patch.object(push, "post_batch") as post:
            self.run_sync()
            self.assertEqual([len(json.loads(c.args[2])["games"]) for c in post.call_args_list],
                             [150] * 7 + [75])
            self.assertEqual(len(json.loads(self.state.read_text())["fingerprints"]), 1125)
            post.reset_mock()
            self.run_sync()
            post.assert_not_called()
            self.xml(self.game(extra='<playtime>17</playtime>'))
            self.run_sync()
            self.assertEqual(len(json.loads(post.call_args.args[2])["games"]), 1)
            post.reset_mock()
            self.state.unlink()
            self.run_sync()
            post.assert_called_once()
        self.assertNotIn("test-secret", self.state.read_text())

    def test_partial_success_and_identical_pending_replay(self):
        self.xml(''.join(self.game(i) for i in range(151)))
        with patch.object(push, "post_batch", side_effect=[None, ValueError("offline")]) as post:
            with self.assertRaises(ValueError):
                self.run_sync()
            failed_body = post.call_args.args[2]
        saved = json.loads(self.state.read_text())
        self.assertEqual(len(saved["fingerprints"]), 150)
        self.assertEqual(saved["pending"]["body"], failed_body)
        self.xml(''.join(self.game(i, '<playtime>1</playtime>' if i == 150 else '') for i in range(151)))
        with patch.object(push, "post_batch") as post:
            self.run_sync()
            self.assertEqual(post.call_args_list[0].args[2], failed_body)
            self.assertEqual(len(post.call_args_list), 2)
            self.assertEqual(json.loads(post.call_args_list[1].args[2])["games"][0]["playtime"], 1)

    def test_rejection_does_not_checkpoint(self):
        self.xml(self.game())
        with patch.object(push, "post_batch", side_effect=push.RejectedBatch("bad")):
            with self.assertRaises(push.RejectedBatch):
                self.run_sync()
        state = json.loads(self.state.read_text())
        self.assertEqual(state["fingerprints"], {})
        self.assertIsNone(state["pending"])
        with patch.object(push, "post_batch") as post:
            self.run_sync()
            post.assert_called_once()

    def test_each_stat_change_full_and_destination_change(self):
        with patch.object(push, "post_batch") as post:
            for extra in ('', '<playcount>0</playcount>', '<playcount>1</playcount>',
                          '<playtime>1</playtime>', '<lastplayed>20260519T210643</lastplayed>'):
                self.xml(self.game(extra=extra))
                post.reset_mock()
                self.run_sync()
                post.assert_called_once()
            post.reset_mock()
            self.args.full = True
            self.run_sync()
            post.assert_called_once()
            self.args.full = False
            post.reset_mock()
            push.sync(self.args, self.root, "https://other.supabase.co/functions/v1/esde-sync",
                      "test-secret", self.state)
            post.assert_called_once()

    def test_dry_run_and_invalid_xml_never_send(self):
        target = self.xml(self.game())
        self.args.dry_run = True
        with patch.object(push, "post_batch") as post:
            self.run_sync()
            post.assert_not_called()
        self.assertFalse(self.state.exists())
        target.write_text('<gameList><game><genre>cut off')
        self.args.dry_run = False
        with patch.object(push, "post_batch") as post:
            with self.assertRaisesRegex(ValueError, "incomplete/invalid XML"):
                self.run_sync()
            post.assert_not_called()

    def test_required_fields_duplicates_and_corrupt_state(self):
        for text in ('<game><path>./x</path></game>', self.game() + self.game()):
            self.xml(text)
            with self.assertRaises(ValueError):
                    push.read_library(self.root, self.roms)
        self.xml(self.game())
        for invalid in ('{', 'null', '{"version":1,"fingerprints":[]}'):
            self.state.write_text(invalid)
            with patch.object(push, "post_batch") as post:
                self.run_sync()
                post.assert_called_once()

    def test_http_retry_auth_and_response_validation(self):
        body = push.encode({"action": "import_esde_games", "games": [{"name": "A"}]})
        success = dict(status="ok", received=1, created=1, updated=0, skipped=0, flagged=0)
        with patch.object(push.urllib.request, "build_opener") as build, patch.object(push.time, "sleep"):
            opener = build.return_value
            opener.open.side_effect = [urllib.error.HTTPError("url", 500, "error", {}, None),
                                       io.BytesIO(push.encode(success).encode())]
            push.post_batch("https://example.supabase.co/functions/v1/esde-sync", "test-secret", body, 2, 1)
            requests = [c.args[0] for c in opener.open.call_args_list]
            self.assertEqual(requests[0].data, requests[1].data)
            self.assertEqual(requests[0].get_header("X-esde-secret"), "test-secret")
            self.assertEqual(requests[0].get_method(), "POST")
            opener.open.side_effect = [io.BytesIO(b'{"status":"ok"}')]
            with self.assertRaises(ValueError):
                push.post_batch("url", "test-secret", body, 1, 1)

    def test_400_logs_index_and_does_not_retry(self):
        with patch.object(push.urllib.request, "build_opener") as build:
            build.return_value.open.side_effect = urllib.error.HTTPError(
                "url", 400, "bad", {}, io.BytesIO(b'{"errors":{"3":"path is required"}}'))
            with self.assertRaises(push.RejectedBatch):
                push.post_batch("https://example.supabase.co", "test-secret", '{}', 3, 1)
            build.return_value.open.assert_called_once()
        self.assertIn('"3":"path is required"', self.output.getvalue())

    def test_lock_blocks_overlapping_push(self):
        with push.state_lock(self.state):
            with self.assertRaisesRegex(ValueError, "Another push"):
                with push.state_lock(self.state):
                    self.fail("second lock acquired")

    def test_missing_roms_and_explicit_switch_addons(self):
        paths = ["./Base Game.nsp", "./Game [DLC-01] [123].nsp",
                 "./Game [Update].nsp", "./Sonic Mania Encore DLC.nsp",
                 "./Sonic Mania Update 131072.nsp", "./99 DLCs/extra.nsp",
                 "./DLC Quest.nsp", "./Upgrade.nsp", "./Game [Base+Update].nsp",
                 "./Missing.nsp", "./Game [UPD].nsz"]
        text = ''.join(f'<game><path>{p}</path><name>Same display title</name></game>' for p in paths)
        self.xml(text, 'switch')
        (self.roms / 'switch/Missing.nsp').unlink()
        audit = []
        rows = push.read_library(self.root, self.roms, audit)
        self.assertEqual([g['path'] for g, _ in rows],
                         [paths[i] for i in [0, 6, 7, 8]])
        self.assertEqual(sum(x['reason'] == 'missing_rom' for x in audit), 1)
        self.assertEqual(len(audit), 7)
        self.assertIsNone(push.addon_reason('nes', './Game [DLC].zip'))
        self.assertEqual(push.addon_reason('switch', './Game [0100C1F0051B6800][v131072].nsp'), 'update_title_id')
        self.assertIsNone(push.addon_reason('switch', './Game [0100C1F0051B6000][v0].nsp'))
        self.assertIsNone(push.addon_reason('switch', './Game [Base+Update] [0100C1F0051B6800].nsp'))
        self.assertIsNone(push.addon_reason('switch', './Game [0100C1F0051B6000] [0100C1F0051B6800].nsp'))

    def test_missing_card_stops_before_pending_replay(self):
        self.xml(self.game())
        with patch.object(push, 'post_batch', side_effect=ValueError('offline')):
            with self.assertRaises(ValueError):
                self.run_sync()
        saved = self.state.read_bytes()
        self.roms.rename(self.roms.with_name('disconnected'))
        with patch.object(push, 'post_batch') as post:
            with self.assertRaisesRegex(ValueError, 'ROM directory missing'):
                self.run_sync()
            post.assert_not_called()
        self.assertEqual(saved, self.state.read_bytes())

    def test_filtered_pending_is_never_replayed(self):
        self.xml(self.game())
        with patch.object(push, 'post_batch', side_effect=ValueError('offline')):
            with self.assertRaises(ValueError):
                self.run_sync()
        (self.roms / 'nes/folder/0.zip').unlink()
        saved = self.state.read_bytes()
        with patch.object(push, 'post_batch') as post:
            with self.assertRaisesRegex(ValueError, 'now-excluded games'):
                self.run_sync()
            post.assert_not_called()
        self.assertEqual(saved, self.state.read_bytes())

    def test_old_filter_pending_is_not_silently_discarded(self):
        self.xml(self.game())
        with patch.object(push, 'post_batch', side_effect=ValueError('offline')):
            with self.assertRaises(ValueError):
                self.run_sync()
        state = json.loads(self.state.read_text())
        del state['context']['filter_version']
        self.state.write_text(json.dumps(state))
        with patch.object(push, 'post_batch') as post:
            with self.assertRaisesRegex(ValueError, 'filter changed'):
                self.run_sync()
            post.assert_not_called()

    def test_traversal_rejected_and_directory_games_kept(self):
        self.xml(self.game())
        self.assertRaises(ValueError, push.rom_exists, self.roms, 'nes', '../outside.zip')
        self.assertTrue(push.rom_exists(self.roms, 'nes', './folder'))


if __name__ == "__main__":
    unittest.main(verbosity=2)
