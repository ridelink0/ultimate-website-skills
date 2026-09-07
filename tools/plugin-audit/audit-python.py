import ast,json,pathlib,subprocess,os
root=pathlib.Path(os.environ.get('PLUGIN_AUDIT_ROOT', pathlib.Path.cwd()))
result=[]
for repo in sorted(root.iterdir()):
    if not (repo/'.git').is_dir():continue
    files=subprocess.check_output(['git','ls-files'],cwd=repo,text=True).splitlines()
    errors=[];count=0
    for rel in files:
        if not rel.endswith('.py'):continue
        count+=1
        try:ast.parse((repo/rel).read_text(encoding='utf-8-sig'),filename=rel)
        except Exception as e:errors.append({'file':rel,'error':str(e)})
    result.append({'repo':repo.name,'checked':count,'errors':errors})
(root/'python-results.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps(result))
