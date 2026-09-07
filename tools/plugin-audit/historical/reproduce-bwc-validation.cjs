// Historical reproduction: run only against the baseline commits in BASELINE.md.
const auditRoot=process.env.PLUGIN_AUDIT_ROOT || process.cwd();
// Execute an in-memory copy with only path classification normalized.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const root=path.join(auditRoot,'buildwithclaude'),file=path.join(root,'scripts/validate-subagents.js');
const source=fs.readFileSync(file,'utf8').replace("file.includes('/commands/')","file.split(path.sep).includes('commands')");
process.chdir(root);
const mod=new Module(file,module);mod.filename=file;mod.paths=Module._nodeModulePaths(path.dirname(file));mod._compile(source,file);
