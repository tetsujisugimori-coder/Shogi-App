import {readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,relative} from 'node:path';
const root=process.argv[2], output=process.argv[3];
function walk(dir) { return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]); }
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const files=walk(root).filter(p=>relative(root,p).replaceAll('\\','/')!=='evidence-manifest.json').sort().map(p=>({path:relative(root,p).replaceAll('\\','/'),sha256:hash(p)}));
const scripts=['scripts/stage-w1-run.ps1','scripts/stage-w1-summary.mjs','scripts/stage-w1-summary-check.mjs','scripts/stage-w1-resource-summary.mjs','scripts/stage-w1-manifest.mjs'].map(path=>({path,sha256:createHash('sha256').update(readFileSync(path,'utf8').replaceAll('\r\n','\n')).digest('hex'),normalization:'UTF-8, CRLF to LF'}));
writeFileSync(output,JSON.stringify({generatedAt:new Date().toISOString(),algorithm:'SHA-256',sourceHeads:{old:'e1ccb1a2412e7faa86c2c1f60fdad1dca154023a',new:'2a8a57b6ff207831c77ce62d27d3151eba7c1dc3'},conditions:'See experiment-plan.json, abba/plan.json, environment.json and each run.json',method:'node scripts/stage-w1-manifest.mjs <evidence-directory> <new-output-outside-evidence>; verify listed entries individually; ignore evidence-manifest.json when comparing lists',note:'Evidence files hashed byte-for-byte; scripts hashed with CRLF normalized to LF. Manifest excludes itself on initial creation; generation timestamps vary.',files,scripts},null,2)+'\n',{flag:'wx'});
