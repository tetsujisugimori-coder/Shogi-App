// Explicit conversion; builder's installation environment is not execution TEMP.
import fs from 'node:fs';
import {resolve,join} from 'node:path';
import {read} from './stage-w1b-preflight.mjs';
const [buildArg,planArg]=process.argv.slice(2),plan=read(resolve(buildArg));
plan.environments=plan.targets.map((t,i)=>{const root=resolve(t.dir,'..'),temp=join(root,`${i}-temp`),cache=join(root,`${i}-npm-cache`);fs.mkdirSync(temp);fs.mkdirSync(cache);return {TEMP:temp,TMP:temp,npm_config_cache:cache};});
delete plan.environment;
fs.writeFileSync(resolve(planArg),JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
