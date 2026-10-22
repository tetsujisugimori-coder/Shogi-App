import { readFileSync, statSync } from 'node:fs';
import { MAX_BYTES, type Certificate } from './benchmarks/outcomeProof';
import { verifyProof } from './benchmarks/verifyOutcomeProof';

// Exit 0 = verified, 1 = rejected/incomplete, 2 = usage or unreadable input.
const [file,expected]=process.argv.slice(2);
try {
  if(!file||!expected) throw Error('usage: verify-outcome-proof FILE TRUSTED_REQUEST_SHA256');
  if(statSync(file).size>MAX_BYTES) throw Error('file exceeds 4 MiB');
  const result=verifyProof(JSON.parse(readFileSync(file,'utf8')) as Certificate,expected);
  console.log(JSON.stringify(result));
  console.error(`${result.valid?'VERIFIED':'REJECTED'}: ${result.reason} (${result.nodes} nodes)`);
  process.exitCode=result.valid?0:1;
} catch(e) {console.log(JSON.stringify({valid:false,outcome:null,reason:String(e)}));process.exitCode=2;}
