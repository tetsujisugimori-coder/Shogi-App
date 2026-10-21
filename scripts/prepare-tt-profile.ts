// Generate an isolated diagnostic source tree; never imported by product code.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import ts from 'typescript';
const [sourceArg, targetArg] = process.argv.slice(2);
assert.ok(sourceArg && targetArg);
const source = resolve(sourceArg), target = resolve(targetArg);
assert.notEqual(source,target); assert.equal(existsSync(join(target,'.git')),false);
mkdirSync(target,{recursive:true});
cpSync(join(source,'src'),join(target,'src'),{recursive:true});
for (const file of ['package.json','tsconfig.json']) cpSync(join(source,file),join(target,file));
const helper = `
function __ttMeasure<T>(name: string, fn: () => T): T {
  const start = performance.now();
  try { return fn(); } finally {
    const p = ((globalThis as any).__ttProfile ??= {});
    const entry = (p[name] ??= { calls: 0, ms: 0 });
    entry.calls++; entry.ms += performance.now() - start;
  }
}
`;
function replaceOnce(text: string, from: string, to: string) {
  assert.equal(text.split(from).length,2,from); return text.replace(from,to);
}
function wrapBodies(text: string, names: Record<string,string>) {
  const ast = ts.createSourceFile('diagnostic.ts',text,ts.ScriptTarget.Latest,true);
  const edits: {pos:number; text:string}[] = [];
  const found = new Set<string>();
  function visit(node: ts.Node) {
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name && node.body) {
      const name = node.name.getText(ast), label = names[name];
      if (label) {
        found.add(name);
        edits.push({pos:node.body.getStart(ast)+1,text:` return __ttMeasure('${label}', () => { `},
          {pos:node.body.end-1,text:' }); '});
      }
    }
    ts.forEachChild(node,visit);
  }
  visit(ast); assert.deepEqual([...found].sort(),Object.keys(names).sort());
  for (const e of edits.sort((a,b)=>b.pos-a.pos)) text = text.slice(0,e.pos)+e.text+text.slice(e.pos);
  return helper+text;
}
let tt = readFileSync(join(source,'src/domain/shogi/transpositionTable.ts'),'utf8').replaceAll('\r\n','\n');
tt = replaceOnce(tt,'const entry = this.entries.get(key);',"const entry = __ttMeasure('B-map-get', () => this.entries.get(key));");
tt = replaceOnce(tt,'entry.identity !== expected',"__ttMeasure('D-identity-equality', () => entry.identity !== expected)");
tt = replaceOnce(tt,'JSON.stringify(result).length',"__ttMeasure('G-payload-stringify', () => JSON.stringify(result).length)");
tt = replaceOnce(tt,'if (characters > MAX_ENTRY_CHARACTERS)',"if (__ttMeasure('F-size-check', () => characters > MAX_ENTRY_CHARACTERS))");
tt = replaceOnce(tt,'const existing = this.entries.get(key);',"__ttMeasure('I-fifo-capacity-map', () => { const existing = this.entries.get(key);");
tt = replaceOnce(tt,'this.statistics.maxPayloadCharacters = Math.max(this.statistics.maxPayloadCharacters, this.characters);',
  'this.statistics.maxPayloadCharacters = Math.max(this.statistics.maxPayloadCharacters, this.characters); });');
tt = wrapBodies(tt,{key:'A-coarse-key',probe:'E-probe-inclusive',store:'G-store-inclusive',transpositionIdentity:'C-core-identity'});
writeFileSync(join(target,'src/domain/shogi/transpositionTable.ts'),tt);
let ai = readFileSync(join(source,'src/domain/shogi/twoPlyAlphaBetaAi.ts'),'utf8').replaceAll('\r\n','\n');
ai = replaceOnce(ai,'identity = JSON.stringify([rootPlayer, isMaximizing, quiescenceOptions, moveOrdering,',
  "identity = __ttMeasure('C-full-identity', () => JSON.stringify([rootPlayer, isMaximizing, quiescenceOptions, moveOrdering,");
ai = replaceOnce(ai,'transpositionIdentity(state, remainingDepth + (quiescenceOptions?.maxTacticalDepth ?? 0))]);',
  'transpositionIdentity(state, remainingDepth + (quiescenceOptions?.maxTacticalDepth ?? 0))]));');
ai = replaceOnce(ai,'if (result.ttExact) transpositions!',"if (__ttMeasure('F-exact-store-check', () => result.ttExact)) transpositions!");
ai = wrapBodies(ai,{cloneSearchNodeResult:'H-clone-result'});
writeFileSync(join(target,'src/domain/shogi/twoPlyAlphaBetaAi.ts'),ai);
// Calibration runs separately from search and uses the actual generated helper.
writeFileSync(join(target,'calibrate.mjs'), helper.replaceAll('<T>','').replaceAll(': string','').replaceAll(': () => T','').replaceAll(': T','').replaceAll(' as any','') + `
const rows=[];
for(let trial=-1;trial<7;trial++) {
  const n=100000, order=trial%2===0?['plain','wrapped']:['wrapped','plain'];
  const row={trial,n}; let sink=0;
  for(const kind of order) { const start=performance.now();
    for(let i=0;i<n;i++) sink += kind==='wrapped'?__ttMeasure('empty',()=>1):1;
    row[kind+'Ms']=performance.now()-start;
  }
  row.sink=sink; rows.push(row);
}
console.log(JSON.stringify(rows,null,2));
`);
console.log(target);
