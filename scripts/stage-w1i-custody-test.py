import hashlib, importlib.util, json, pathlib, tempfile, unittest, zipfile
spec=importlib.util.spec_from_file_location('custody',pathlib.Path(__file__).with_name('stage-w1i-custody-check.py')); c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
class Tests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='w1i-synthetic-'); self.addCleanup(self.tmp.cleanup);self.root=pathlib.Path(self.tmp.name)
 def make(self, files=None, manifest=True, mutate=None):
  files=files or {'raw.txt':b'synthetic stdout\n','empty.stderr':b''};m={'schema':'w1i-custody/1','files':[{'path':k,'size':len(v),'sha256':hashlib.sha256(v).hexdigest()} for k,v in files.items()]}
  if mutate:mutate(m)
  p=self.root/('case'+str(len(list(self.root.iterdir())))+'.zip')
  with zipfile.ZipFile(p,'w') as z:
   for k,v in files.items():z.writestr(k,v)
   if manifest:z.writestr('AUDIT-MANIFEST.json',json.dumps(m))
  return p
 def verify(self,p,**kw):return c.check_zip(p,p.stat().st_size,hashlib.sha256(p.read_bytes()).hexdigest(),**kw)
 def test_normal(self):
  p=self.make();self.assertEqual(self.verify(p,original=p)['integrity'],'PASS')
 def test_retrieval_missing(self):
  with self.assertRaisesRegex(c.Rejected,'RETRIEVAL_MISSING'):c.check_zip(self.root/'absent',1,'0'*64)
 def test_sha(self):
  p=self.make()
  with self.assertRaisesRegex(c.Rejected,'SHA_MISMATCH'):c.check_zip(p,p.stat().st_size,'0'*64)
 def test_size(self):
  p=self.make()
  with self.assertRaisesRegex(c.Rejected,'SIZE_MISMATCH'):c.check_zip(p,1,hashlib.sha256(p.read_bytes()).hexdigest())
 def test_manifest_missing(self):
  with self.assertRaisesRegex(c.Rejected,'MANIFEST_MISSING'):self.verify(self.make(manifest=False))
 def test_manifest_content(self):
  with self.assertRaisesRegex(c.Rejected,'MANIFEST_CONTENT'):self.verify(self.make(mutate=lambda m:m['files'][0].update(sha256='0'*64)))
 def test_manifest_set(self):
  with self.assertRaisesRegex(c.Rejected,'MANIFEST_SET'):self.verify(self.make(mutate=lambda m:m['files'].pop()))
 def test_manifest_duplicate(self):
  with self.assertRaisesRegex(c.Rejected,'MANIFEST_DUPLICATE'):self.verify(self.make(mutate=lambda m:m['files'].append(m['files'][0])))
 def test_manifest_empty(self):
  with self.assertRaisesRegex(c.Rejected,'MANIFEST_INVALID'):self.verify(self.make(mutate=lambda m:m.update(files=[])))
 def test_dangerous_path(self):
  with self.assertRaisesRegex(c.Rejected,'UNSAFE_ENTRY'):self.verify(self.make(files={'../escape':b'x'}))
 def test_dot_component(self):
  with self.assertRaisesRegex(c.Rejected,'UNSAFE_ENTRY'):self.verify(self.make(files={'./raw.txt':b'x'}))
 def test_empty_component(self):
  with self.assertRaisesRegex(c.Rejected,'UNSAFE_ENTRY'):self.verify(self.make(files={'a//raw.txt':b'x'}))
 def test_crc(self):
  p=self.make();b=p.read_bytes();p.write_bytes(b.replace(b'synthetic stdout',b'synthetic stdouX',1))
  with self.assertRaises((zipfile.BadZipFile,c.Rejected)):self.verify(p)
 def test_byte_mismatch(self):
  p=self.make();other=self.root/'other';other.write_bytes(b'other')
  with self.assertRaisesRegex(c.Rejected,'BYTE_MISMATCH'):self.verify(p,original=other)
 def test_receipt_normal(self):
  r={k:'PASS' for k in ['authorization','save','direct_retrieval','content','manifest','source_bytes']}; self.assertEqual(c.receipt_gate(r)['status'],'PASS');self.assertFalse(c.receipt_gate(r)['permit'])
 def test_save_failure(self):self.assertEqual(c.receipt_gate({'save':'FAIL'})['status'],'FAIL')
 def test_permission_blocked(self):self.assertEqual(c.receipt_gate({'authorization':'BLOCKED'})['status'],'BLOCKED')
 def test_retrieval_not_tested(self):self.assertEqual(c.receipt_gate({'save':'PASS'})['status'],'PARTIAL')
 def test_unknown_not_promoted(self):self.assertEqual(c.receipt_gate({'content':'UNKNOWN'})['status'],'PARTIAL')
 def test_public_normal(self):self.assertTrue(c.public_text_check('synthetic PASS: code/entry.mjs'))
 def test_public_workspace(self):self.assertFalse(c.public_text_check('/'+'workspace/synthetic/raw'))
 def test_public_windows(self):self.assertFalse(c.public_text_check('C:'+'\\Users\\synthetic\\raw'))
 def test_public_secret(self):self.assertFalse(c.public_text_check('ghp_'+'x'*36))
if __name__=='__main__':unittest.main(verbosity=2)
