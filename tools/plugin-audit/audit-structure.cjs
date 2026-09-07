const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=process.env.PLUGIN_AUDIT_ROOT || process.cwd();
const reports=[];
for(const ent of fs.readdirSync(root,{withFileTypes:true}).filter(e=>e.isDirectory()&&fs.existsSync(path.join(root,e.name,'.git')))){
 const dir=path.join(root,ent.name),files=cp.execFileSync('git',['ls-files'],{cwd:dir,encoding:'utf8'}).trim().split(/\r?\n/);
 const report={repo:ent.name,commit:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:dir,encoding:'utf8'}).trim(),files:files.length,plugins:0,marketplaces:0,json:0,js:0,issues:[]};
 const checkPath=(manifest,base,key,value)=>{if(typeof value!=='string'||!value.startsWith('./')||/[\*${}]/.test(value))return;const target=path.resolve(base,value);if(!fs.existsSync(target))report.issues.push({kind:'missing-path',file:manifest,key,value});};
 for(const rel of files){
  const abs=path.join(dir,rel);
  if(/\.json$/.test(rel)){
   let doc;try{doc=JSON.parse(fs.readFileSync(abs,'utf8'));report.json++;}catch(e){report.issues.push({kind:'invalid-json',file:rel,message:e.message});continue;}
   if(/(^|\/)\.claude-plugin\/plugin\.json$|(^|\/)\.codex-plugin\/plugin\.json$/.test(rel)){
    report.plugins++;
    const base=path.dirname(path.dirname(abs));
    for(const key of ['commands','agents','skills','hooks','mcpServers','lspServers'])for(const value of Array.isArray(doc[key])?doc[key]:[doc[key]])checkPath(rel,base,key,value);
    for(const [key,value] of Object.entries(doc.interface||{}))checkPath(rel,base,'interface.'+key,value);
   }
   if(/(^|\/)marketplace\.json$/.test(rel)&&Array.isArray(doc.plugins)){
    report.marketplaces++;
    const base=path.basename(path.dirname(abs))==='.claude-plugin'?path.dirname(path.dirname(abs)):path.dirname(abs);
    const seen=new Set();for(const p of doc.plugins){checkPath(rel,base,'source:'+p.name,p.source);if(seen.has(p.name))report.issues.push({kind:'duplicate-plugin',file:rel,name:p.name});seen.add(p.name);}
   }
  }
  if(/\.(mjs|cjs|js)$/.test(rel)){
   const r=cp.spawnSync(process.execPath,['--check',abs],{encoding:'utf8',timeout:10000,windowsHide:true});report.js++;
   if(r.status!==0)report.issues.push({kind:'js-syntax',file:rel,message:(r.stderr||String(r.error)).slice(0,1000)});
  }
 }
 reports.push(report);console.log(JSON.stringify(report));
}
fs.writeFileSync(path.join(root,'structure-results.json'),JSON.stringify(reports,null,2));
