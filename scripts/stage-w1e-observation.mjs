// Endpoint inventories are not a complete OS audit. Never follow reparse points.
import fs from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { hash } from './stage-w1b-preflight.mjs';
export function inventory(root, bodies=false, dir=root) {
  const result=[];
  for(const name of fs.readdirSync(dir).sort()) {
    const absolute=join(dir,name),s=fs.lstatSync(absolute),path=relative(root,absolute).replaceAll('\\','/');
    const row={path,absolute,size:s.size,type:s.isSymbolicLink()?'link':s.isDirectory()?'directory':s.isFile()?'file':'unsupported',observedAt:new Date().toISOString(),mtimeMs:s.mtimeMs,birthtimeMs:s.birthtimeMs};
    if(row.type==='link')row.target=fs.readlinkSync(absolute);
    if(row.type==='file'){const b=fs.readFileSync(absolute);row.sha256=hash(b);if(bodies)row.base64=b.toString('base64');}
    result.push(row);if(row.type==='directory')result.push(...inventory(root,bodies,absolute));
  }
  return result;
}
export function saveState(out,name,roots,extra={}) {
  const started=performance.now(),memoryBefore=process.memoryUsage();
  const trees=Object.fromEntries(Object.entries(roots).map(([key,p])=>[key,{root:resolve(p),entries:inventory(p,key==='temp'||key==='vite')} ]));
  const record={name,at:new Date().toISOString(),pid:process.pid,trees,...extra,interference:{elapsedMs:performance.now()-started,memoryBefore,memoryAfter:process.memoryUsage(),writes:'evidence output only; raw reads may update OS access metadata',limits:'non-atomic walk; endpoint timestamps are observation times, not exact creation/deletion times; no OS process attribution'}};
  fs.writeFileSync(join(out,name+'.json.gz'),gzipSync(JSON.stringify(record)),{flag:'wx'});return record;
}
