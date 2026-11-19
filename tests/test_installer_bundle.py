"""Released installer preparation is inert until apply and verifies all bytes."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
import zipfile

ROOT=Path(__file__).parents[1]
spec=importlib.util.spec_from_file_location('installer_bundle',ROOT/'profiles/process-macos/installer_bundle.py')
installer=importlib.util.module_from_spec(spec);spec.loader.exec_module(installer)

class Response(io.BytesIO):
    def geturl(self):return 'https://release-assets.githubusercontent.com/installer.zip'

class InstallerBundleTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name).resolve()
        self.cache=self.root/'cache'
        self.controller=ROOT/'profiles/process-macos/process_mac.py'
        (self.root/'process_mac.py').write_bytes(self.controller.read_bytes())
        self.profile={'schema':'hub.process-macos-release.v1','wheels':[]}
        files={'process_mac.py':self.controller.read_bytes()}
        for i in range(15):
            name=f'fixture-{i}.whl';raw=b'fixture wheel'
            self.profile['wheels'].append(dict(name=f'fixture-{i}',filename=name,sha256=self.sha(raw),bytes=len(raw)))
            files['wheels/'+name]=raw
        files['profile.json']=json.dumps(self.profile).encode()
        (self.root/'release.v1.json').write_bytes(files['profile.json'])
        manifest={'schema':'hub.process-macos-bundle.v1','files':{k:self.sha(v) for k,v in files.items()}}
        files['bundle.json']=json.dumps(manifest).encode()
        self.files=files;self.descriptor=self.root/'installer.v1.json'
        self.pack(files)
    def sha(self,raw):return hashlib.sha256(raw).hexdigest()
    def pack(self,files):
        stream=io.BytesIO()
        with zipfile.ZipFile(stream,'w') as z:
            for name,raw in files.items():z.writestr(name,raw)
        self.raw=stream.getvalue()
        self.value=dict(schema='hub.released-installer.v1',url='https://github.com/ZenithResearch/zenith-hub-lightweight/releases/download/test/installer.zip',archiveSha256=self.sha(self.raw),archiveBytes=len(self.raw),bundleSha256=self.sha(files['bundle.json']),profileSha256=self.sha(files['profile.json']))
        self.descriptor.write_text(json.dumps(self.value))
    def test_verified_download_then_cache_reuse(self):
        calls=[]
        def fetch(*args,**kwargs):calls.append(args);return Response(self.raw)
        target=installer.ensure(self.descriptor,self.cache,opener=fetch)
        self.assertEqual(target.name,self.value['bundleSha256'])
        self.assertEqual(len(calls),1)
        again=installer.ensure(self.descriptor,self.cache,opener=lambda *a,**k:self.fail('cached installer downloaded'))
        self.assertEqual(again,target)
        self.assertFalse((self.root/'installation').exists())
    def test_wrong_archive_is_rejected_before_extraction(self):
        with self.assertRaisesRegex(installer.InstallerError,'archive digest'):
            installer.ensure(self.descriptor,self.cache,opener=lambda *a,**k:Response(b'x'*len(self.raw)))
        self.assertFalse((self.cache/self.value['bundleSha256']).exists())
    def test_archive_traversal_is_rejected(self):
        self.pack(dict(self.files,**{'../escaped':b'bad'}))
        with self.assertRaisesRegex(installer.InstallerError,'Unsafe installer archive'):
            installer.ensure(self.descriptor,self.cache,opener=lambda *a,**k:Response(self.raw))
        self.assertFalse((self.root/'escaped').exists())
    def test_foreign_origin_is_rejected_before_network(self):
        self.value['url']='https://example.invalid/installer.zip';self.descriptor.write_text(json.dumps(self.value))
        with self.assertRaisesRegex(installer.InstallerError,'origin'):
            installer.ensure(self.descriptor,self.cache,opener=lambda *a,**k:self.fail('network'))
    def test_changed_cache_is_preserved_and_rejected(self):
        target=installer.ensure(self.descriptor,self.cache,opener=lambda *a,**k:Response(self.raw))
        (target/'wheels/fixture-0.whl').write_bytes(b'changed')
        with self.assertRaises(ValueError):installer.ensure(self.descriptor,self.cache,opener=lambda *a,**k:self.fail('network'))
        self.assertEqual((target/'wheels/fixture-0.whl').read_bytes(),b'changed')

if __name__=='__main__':unittest.main()
