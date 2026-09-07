const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=process.env.PLUGIN_AUDIT_ROOT || process.cwd();
const yaml=require(path.join(root,'buildwithclaude/node_modules/js-yaml'));
const rows=[];
for(const repo of JSON.parse(fs.readFileSync(path.join(root,'structure-results.json'),'utf8'))){
 const dir=path.join(root,repo.repo),files=cp.execFileSync('git',['ls-files'],{cwd:dir,encoding:'utf8'}).trim().split(/\r?\n/);
 const row={repo:repo.repo,checked:0,absent:0,errors:[]};
 for(const file of files.filter(f=>/(^|\/)SKILL\.md$/.test(f)||/(^|\/)(agents|commands)\/.+\.md$/.test(f))){
  const s=fs.readFileSync(path.join(dir,file),'utf8');const match=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(s);
  if(!match){row.absent++;continue;}row.checked++;
  try{yaml.safeLoad(match[1]);}catch(e){row.errors.push({file,line:e.mark?.line===undefined?null:e.mark.line+2,error:e.reason||e.message});}
 }
 rows.push(row);
 console.log(JSON.stringify({repo:row.repo,checked:row.checked,absent:row.absent,errors:row.errors.length,examples:row.errors.slice(0,3)}));
}
fs.writeFileSync(path.join(root,'frontmatter-results.json'),JSON.stringify(rows,null,2));
