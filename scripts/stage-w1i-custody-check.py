"""Offline W1i receipt verifier. No saving, network, permission or experiment actions."""
import hashlib, json, pathlib, re, zipfile

class Rejected(ValueError): pass

def check_zip(path, expected_size, expected_sha, original=None):
    p = pathlib.Path(path)
    if not p.is_file(): raise Rejected('RETRIEVAL_MISSING')
    b = p.read_bytes()
    if type(expected_size) is not int or expected_size <= 0 or len(b) != expected_size: raise Rejected('SIZE_MISMATCH')
    if not isinstance(expected_sha,str) or not re.fullmatch('[0-9a-f]{64}',expected_sha) or hashlib.sha256(b).hexdigest() != expected_sha: raise Rejected('SHA_MISMATCH')
    if original is not None and b != pathlib.Path(original).read_bytes(): raise Rejected('BYTE_MISMATCH')
    with zipfile.ZipFile(p) as z:
        names=z.namelist()
        if len(names)!=len(set(names)): raise Rejected('DUPLICATE_ENTRY')
        for n in names:
            q=pathlib.PurePosixPath(n)
            if not n or any(part in ('', '.', '..') for part in n.split('/')) or n.startswith('/') or '\\' in n or ':' in n or '..' in q.parts or n.endswith('/'): raise Rejected('UNSAFE_ENTRY')
            if (z.getinfo(n).external_attr >> 16) & 0o170000 == 0o120000: raise Rejected('SYMLINK_ENTRY')
        if z.testzip() is not None: raise Rejected('CRC_MISMATCH')
        if 'AUDIT-MANIFEST.json' not in names: raise Rejected('MANIFEST_MISSING')
        try: m=json.loads(z.read('AUDIT-MANIFEST.json'))
        except (ValueError,UnicodeError) as e: raise Rejected('MANIFEST_INVALID') from e
        if not isinstance(m,dict) or m.get('schema')!='w1i-custody/1' or not isinstance(m.get('files'),list) or not m['files']: raise Rejected('MANIFEST_INVALID')
        expected={}
        for f in m['files']:
            if not isinstance(f,dict) or not isinstance(f.get('path'),str) or type(f.get('size')) is not int or f['size']<0 or not isinstance(f.get('sha256'),str) or not re.fullmatch('[0-9a-f]{64}',f['sha256']): raise Rejected('MANIFEST_INVALID')
            if f['path'] in expected: raise Rejected('MANIFEST_DUPLICATE')
            expected[f['path']]=f
        if set(expected)!=set(names)-{'AUDIT-MANIFEST.json'}: raise Rejected('MANIFEST_SET')
        for n,f in expected.items():
            raw=z.read(n)
            if len(raw)!=f['size'] or hashlib.sha256(raw).hexdigest()!=f['sha256']: raise Rejected('MANIFEST_CONTENT')
    return {'integrity':'PASS','entries':len(names),'files':len(expected),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'all_byte':'PASS' if original else 'NOT_TESTED','permanent_retention':'UNKNOWN','permit':False}

def receipt_gate(receipt):
    # A reported success does not prove an authenticated owner, ACL or retention.
    required=['authorization','save','direct_retrieval','content','manifest','source_bytes']
    if not isinstance(receipt,dict): raise Rejected('RECEIPT_INVALID')
    states=[]
    for k in required:
        v=receipt.get(k,'NOT_TESTED')
        if v not in ('PASS','FAIL','BLOCKED','UNKNOWN','NOT_TESTED'): raise Rejected('RECEIPT_INVALID')
        states.append(v)
    status='FAIL' if 'FAIL' in states else 'BLOCKED' if 'BLOCKED' in states else 'PASS' if set(states)=={'PASS'} else 'PARTIAL'
    return {'status':status,'permit':False,'independence':'LIMITED_SHARED_OWNER'}

def public_text_check(text):
    # Deliberately a bounded publication lint, not a universal secret detector.
    patterns=[r'/workspace/', r'/home/[^/\s]+/', r'[A-Za-z]:[\\/]Users[\\/]',r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY',r'gh[pousr]_[A-Za-z0-9]{30,}',r'Bearer\s+[A-Za-z0-9_.-]{25,}']
    return not any(re.search(p,text) for p in patterns)
