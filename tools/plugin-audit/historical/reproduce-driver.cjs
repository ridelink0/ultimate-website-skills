// Historical reproduction: run only against the baseline commits in BASELINE.md.
const auditRoot=process.env.PLUGIN_AUDIT_ROOT || process.cwd();
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const file=path.join(auditRoot,'claude-computer-use/server/driver.mjs');
const source=fs.readFileSync(file,'utf8').replace(/^import .*;\r?\n/gm,'').replace(/export class /g,'class ')+'\nthis.Driver=Driver;';
let builds=0;
const sandbox={ensureHost:()=>{builds++;throw Object.assign(new Error(builds===1?'temporary compiler failure':'second build attempt'),{code:'build_failed'});},setTimeout,clearTimeout,process};
vm.runInNewContext(source,sandbox,{filename:file});
(async()=>{const d=new sandbox.Driver();const errors=[];for(let i=0;i<2;i++){try{await d.start()}catch(e){errors.push(e.message)}}const result={attemptedStarts:2,ensureHostCalls:builds,errors,stuckRejectedStartupPromise:!!d.starting};fs.writeFileSync(path.join(auditRoot,'driver-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));})();
