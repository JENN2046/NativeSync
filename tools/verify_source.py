import pathlib,json,hashlib,re,subprocess,sys
ROOT=pathlib.Path(__file__).resolve().parents[1]
m=json.loads((ROOT/'provenance/source-manifest.json').read_text(encoding='utf-8'))
successorFile=ROOT/'provenance/limited-source-changes.json'
successor=json.loads(successorFile.read_text()) if successorFile.exists() else {'files':[]}
changed={r['path']:r for r in successor['files']}
for row in m['files']:
 f=ROOT/row['path'];assert f.is_file(),row['path'];r=changed.get(row['path']);assert not r or r['baselineSha256']==row['sha256'],row['path']
 assert hashlib.sha256(f.read_bytes()).hexdigest()==(r['candidateSha256'] if r else row['sha256']),row['path']
for row in successor['files']:
 assert hashlib.sha256((ROOT/row['path']).read_bytes()).hexdigest()==row['candidateSha256'],row['path']
tracked=subprocess.run(['git','ls-files','-z'],cwd=ROOT,capture_output=True,check=True).stdout.decode().split(chr(0))
if not any(tracked):
 files=[p for p in ROOT.rglob('*') if p.is_file() and not any(x in p.relative_to(ROOT).parts for x in ['.git','node_modules','dist','.local','.artifacts','__pycache__'])]
else:
 extra=subprocess.run(['git','ls-files','--others','--exclude-standard','-z'],cwd=ROOT,capture_output=True,check=True).stdout.decode().split(chr(0))
 files=[ROOT/p for p in sorted(set(tracked+extra)) if p]
bad=[]
patterns=[r'gh[pousr]_[A-Za-z0-9]{24,}',r'github_pat_[A-Za-z0-9_]{24,}',r'sk-(?:proj-)?[A-Za-z0-9_-]{24,}',r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',r'nswin_[0-9a-f]{8}-[0-9a-f-]{27,}']
for f in files:
 rel=f.relative_to(ROOT)
 if any(x in rel.parts for x in ['AppData','UserData','.native-sync','runtime-data','state-private','node_modules','dist']) or f.name in ['config.env','settings.json','provider.env','state.json'] or f.suffix in ['.db','.sqlite','.sqlite3','.exe','.dll','.tap','.log'] or (f.name.startswith('.env') and not f.name.endswith('.example')):bad.append(str(rel)+': forbidden runtime/generated file');continue
 try:text=f.read_text(encoding='utf-8-sig')
 except UnicodeDecodeError:continue
 if any(re.search(p,text) for p in patterns):bad.append(str(rel)+': potential credential or real runtime identity')
assert not bad, bad
print(json.dumps({'importedFilesVerified':len(m['files']),'reviewedFiles':len(files),'forbiddenOrSecretFindings':0,'productionWrites':0,'publicReleaseClaimed':False}))
