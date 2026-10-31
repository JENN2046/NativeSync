"""Local-only entry point for NativeSync disposable installation checks."""
import argparse,hashlib,json,pathlib,shutil,subprocess,sys,socket,datetime
ROOT=pathlib.Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--profile',choices=['public','tencent-ce904c47'],default='public');p.add_argument('--config',type=pathlib.Path,default=ROOT/'.local/local-validation/CONFIG.json');p.add_argument('--prepare-only',action='store_true');a=p.parse_args();config=json.loads(a.config.read_text())
def local(name):
 value=config[name];assert '://' not in value,'Local filesystem paths required';path=pathlib.Path(value).resolve();assert path.exists(),name+' does not exist';return path
candidate=local('candidate');previous=local('previous');template=local('publicHosts');node=local('node');deps=local('dependencies');pwa=local('pwaDependencies');workspace=pathlib.Path(config['workspace']).resolve();assert workspace.is_relative_to(ROOT/'.local'),'Keep test installations in this checkout local workspace';workspace.mkdir(parents=True,exist_ok=True)
if a.profile=='tencent-ce904c47':
 snapshot=local('tencentCodeSnapshot');profile=ROOT/'compat/test-hosts/tencent-ce904c47';manifest=json.loads((profile/'MANIFEST.json').read_text());template=workspace/'templates/tencent-ce904c47'
 if not template.exists():
  shutil.copytree(local('publicHosts'),template,symlinks=True,ignore=shutil.ignore_patterns('nativeSync','NativeSync','mobile','.git','architecture-baseline-adapter.cjs'))
  for file in snapshot.rglob('*'):
   if file.is_file():target=template/'VCPToolBox'/file.relative_to(snapshot);target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(file,target)
  box=template/'VCPToolBox'
  for row in manifest['files']:assert hashlib.sha256((box/row['path']).read_bytes()).hexdigest()==row['beforeSha256'],'Snapshot before mismatch'
  subprocess.run(['git','init','--quiet','--initial-branch=codex/local-tencent-fixture'],cwd=box,check=True)
  subprocess.run(['git','apply','--check',str(profile/'NativeSync.patch')],cwd=box,check=True)
  subprocess.run(['git','apply',str(profile/'NativeSync.patch')],cwd=box,check=True)
 for row in manifest['files']:assert hashlib.sha256((template/'VCPToolBox'/row['path']).read_bytes()).hexdigest()==row['afterSha256'],'Prepared host changed'
 # Dependency directories are deliberately local; no server path is reused.
 for host in ['VCPToolBox','VCPChat']:
  link=template/host/'node_modules'
  if link.is_symlink():assert link.resolve()==deps,'Unexpected dependency link'
  elif not link.exists():link.symlink_to(deps,target_is_directory=True)
  else:raise ValueError('Expected a local dependency link')
assert (template/'.nativesync-isolated-test-root').read_text().strip()=='public-fixture-only'
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ');out=workspace/'runs'/a.profile/stamp;out.parent.mkdir(parents=True,exist_ok=True)
command=[sys.executable,str(ROOT/'tools/validate_release.py'),'--candidate',str(candidate),'--previous',str(previous),'--template-hosts',str(template),'--out',str(out),'--node',str(node),'--dependencies',str(deps),'--pwa-dependencies',str(pwa)]
plan={'execution':'local','machine':socket.gethostname(),'profile':a.profile,'template':str(template),'output':str(out),'installedHosts':str(out/'hosts'),'command':command,'remoteConnections':False}
if a.prepare_only:print(json.dumps(plan,ensure_ascii=False));raise SystemExit(0)
run=subprocess.run(command,cwd=ROOT);plan['exitCode']=run.returncode
if out.exists():(out/'LOCAL_EXECUTION.json').write_text(json.dumps(plan,indent=2,ensure_ascii=False)+'\n')
print(json.dumps(plan,ensure_ascii=False));raise SystemExit(run.returncode)
