// Historical reproduction: run only against the baseline commits in BASELINE.md.
const auditRoot=process.env.PLUGIN_AUDIT_ROOT || process.cwd();
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),cp=require('node:child_process'),url=require('node:url');
const root=auditRoot,echo=path.join(__dirname,'installer-argv.cjs');
fs.writeFileSync(echo,'console.log(JSON.stringify(process.argv.slice(2)))');
const rows=[];
for(const repo of ['atelier','cinematic-web-design']){
 const script=path.join(root,repo,'scripts/install.mjs');
 const source=fs.readFileSync(script,'utf8').replace(/^#!.*\r?\n/,'').replace(/^import .*;\r?\n/gm,'').replaceAll('import.meta.url',JSON.stringify(url.pathToFileURL(script).href));
 const calls=[];const logs=[];
 const intended='C:\\Audit Fixtures\\my plugin';
 const fakeProcess={...process,argv:[process.execPath,script,'--source',intended]};
 vm.runInNewContext(source,{
  process:fakeProcess,console:{log:s=>logs.push(s)},...path,
  homedir:()=>path.join(root,'fake-install-home'),fileURLToPath:url.fileURLToPath,
  existsSync:()=>false,readFileSync:()=>{throw new Error('unexpected read')},writeFileSync:()=>{throw new Error('unexpected write')},copyFileSync:()=>{throw new Error('unexpected copy')},
  spawnSync:(bin,args,opts)=>{if(args[0]==='--version')return {status:0,stdout:'fixture-cli'};
   const r=cp.spawnSync('node',[echo,...args],{...opts,windowsHide:true});calls.push({expected:args,actual:JSON.parse(r.stdout.trim()),shell:opts.shell});return r;},
 },{filename:script});
 rows.push({repo,calls});
}
fs.writeFileSync(path.join(root,'installer-results.json'),JSON.stringify(rows,null,2));console.log(JSON.stringify(rows,null,2));
