#!/usr/bin/env python3
"""Offline content-sync contract checks; temporary fixtures only."""
import argparse
from contextlib import redirect_stdout
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from PIL import Image

spec = importlib.util.spec_from_file_location('content_sync', Path(__file__).with_name('sync-esde-content.py'))
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)


class ContentTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        self.base = Path(temp.name).resolve(); self.root = self.base/'ES-DE/gamelists'
        self.roms = self.base/'ROMs'; self.media = self.base/'ES-DE/downloaded_media'
        (self.root/'nes').mkdir(parents=True); (self.roms/'nes/sub').mkdir(parents=True)
        (self.roms/'nes/sub/game.nes').touch(); (self.media/'nes').mkdir(parents=True)
        self.xml = self.root/'nes/gamelist.xml'
        self.xml.write_text('<alternativeEmulator><label>custom</label></alternativeEmulator><gameList x="y"><folder><path>./sub</path></folder><game id="42"><path>./sub/game.nes</path><name>Game</name><favorite>true</favorite><future a="b">raw &amp; value</future><future/><playcount>0</playcount></game></gameList>')
        self.active, _ = module.basic.snapshot(self.root,self.roms)
        self.identity = next(iter(self.active))
        self.args = argparse.Namespace(dry_run=False,media_only=False,metadata_only=False,
            state=self.base/'state.json',roms=self.roms,full=False,timezone='Europe/Oslo',
            attempts=1,timeout=1,covers_only=False,allow_large_delete=False)
        self.row = {'id':'variant','esde_system':'nes','esde_path':'./sub/game.nes','esde_source_hash':None,'esde_assets':{}}
        self.capture=redirect_stdout(io.StringIO());self.capture.__enter__();self.addCleanup(self.capture.__exit__,None,None,None)

    def asset(self, category='fanart', extension='png'):
        path=self.media/'nes'/category/'sub'/('game.'+extension);path.parent.mkdir(parents=True,exist_ok=True)
        Image.new('RGB',(19,13),'blue').save(path,'PNG')
        return path

    def run_content(self):
        module.run(self.args,self.root,self.roms,self.media,'https://example.supabase.co','test-secret')

    def test_all_xml_attributes_repeated_unknowns_and_context(self):
        text,sha=module.documents(self.root,self.active)[self.identity];data=json.loads(text)
        self.assertIn('id="42"',data['game']);self.assertEqual(data['game'].count('<future'),2)
        self.assertIn('<favorite>true</favorite>',data['game']);self.assertIn('<playcount>0</playcount>',data['game'])
        self.assertEqual(data['context']['gamelist_attributes'],{'x':'y'})
        self.assertIn('alternativeEmulator',data['context']['system_elements'][0])
        self.assertIn('<folder>',data['context']['folder_and_other_elements'][0])
        self.xml.write_text(self.xml.read_text().replace('favorite>true','favorite>false'))
        self.assertNotEqual(module.documents(self.root,self.active)[self.identity][1],sha)

    def test_all_categories_original_bytes_pdf_video_excluded(self):
        for category in ['covers','3dboxes','backcovers','fanart','marquees','miximages','physicalmedia','screenshots','titlescreens','future-category']:
            self.asset(category)
        self.asset('videos')
        for extension in ['pdf','mp4','flv']:
            p=self.media/'nes/fanart/sub'/('game.'+extension);p.write_bytes(b'not an image')
        manifest,ignored=module.asset_manifest(self.media,self.active)
        self.assertEqual(len(manifest[self.identity]),10);self.assertEqual(ignored['pdf'],1);self.assertEqual(ignored['video'],3)
        item=next(iter(manifest[self.identity].values()));content,sha=module.checked_image(item)
        self.assertEqual(content,item['path'].read_bytes());self.assertEqual(sha,hashlib.sha256(content).hexdigest())

    def test_shared_exact_stem_and_nested_match(self):
        self.asset();other=module.push.encode(['nes','./sub/game.zip'])
        active=dict(self.active);active[other]={'system':'nes','path':'./sub/game.zip'}
        manifest,ignored=module.asset_manifest(self.media,active)
        self.assertEqual(set(manifest[self.identity]),set(manifest[other]));self.assertEqual(ignored['shared_exact_stem'],1)

    def test_empty_invalid_and_changed_images(self):
        path=self.asset();manifest,_=module.asset_manifest(self.media,self.active);item=next(iter(manifest[self.identity].values()))
        path.write_bytes(b'%PDF-fake')
        with self.assertRaisesRegex(ValueError,'changed'):module.checked_image(item)
        manifest,_=module.asset_manifest(self.media,self.active);item=next(iter(manifest[self.identity].values()))
        with self.assertRaises(module.basic.BadCover):module.checked_image(item)
        path.write_bytes(b'');manifest,_=module.asset_manifest(self.media,self.active)
        with self.assertRaisesRegex(module.basic.BadCover,'empty'):module.checked_image(next(iter(manifest[self.identity].values())))

    def test_missing_media_aborts_before_network(self):
        (self.media/'nes').rmdir()
        with patch.object(module,'inventory') as inv:
            with self.assertRaisesRegex(ValueError,'Media system unavailable'):self.run_content()
        inv.assert_not_called()

    def test_first_run_then_unchanged_has_no_content_writes(self):
        path=self.asset();sha=hashlib.sha256(path.read_bytes()).hexdigest()
        with patch.object(module,'inventory',return_value={self.identity:self.row}),patch.object(module.basic,'synchronize'),patch.object(module.basic,'request',return_value={'status':'ok','saved':True}) as req,patch.object(module,'upload') as up:
            self.run_content();req.assert_called_once();up.assert_called_once()
        self.row['esde_source_hash']=module.documents(self.root,self.active)[self.identity][1]
        self.row['esde_assets']={'nes/fanart/sub/game.png':{'sha256':sha,'size':path.stat().st_size,'category':'fanart'}}
        with patch.object(module,'inventory',return_value={self.identity:self.row}),patch.object(module.basic,'synchronize'),patch.object(module.basic,'request') as req,patch.object(module,'upload') as up:
            self.run_content();req.assert_not_called();up.assert_not_called()

    def test_metadata_only_does_not_upload_or_prune_assets(self):
        self.args.metadata_only=True;self.asset()
        self.row['esde_assets']={'nes/fanart/deleted.png':{'sha256':'a'*64,'category':'fanart'}}
        with patch.object(module,'inventory',return_value={self.identity:self.row}),patch.object(module.push,'sync'),patch.object(module.basic,'request',return_value={'status':'ok','saved':True}) as req,patch.object(module,'upload') as up:
            self.run_content();self.assertEqual(req.call_args.args[2]['action'],'source');req.assert_called_once();up.assert_not_called()

    def test_dry_run_does_not_write_state_or_contact_server(self):
        self.args.dry_run=True;self.asset()
        with patch.object(module,'inventory') as inv:self.run_content()
        inv.assert_not_called();self.assertFalse((self.base/'content-report.json').exists())


if __name__=='__main__':unittest.main(verbosity=2)
