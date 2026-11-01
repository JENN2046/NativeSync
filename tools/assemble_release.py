"""Offline assembly of a local candidate; never installs to a running host."""
import argparse,hashlib,json,pathlib,shutil,subprocess,zipfile,os
ROOT=pathlib.Path(__file__).resolve().parents[1]
sha=lambda b:hashlib.sha256(b).hexdigest()
def write_json(path,value):path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(value,indent=2,ensure_ascii=False)+'\n')
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT,stderr=subprocess.DEVNULL)
def build(out,node,deps,ref=None,skip_pwa=False):
 out=out.resolve();deps=deps.resolve();assert not out.exists(),'Output must be new'
 assert out!=ROOT and not out.is_relative_to(ROOT/'overlays') and not ROOT.is_relative_to(out),'Unsafe output'
 out.mkdir(parents=True);assembly=out/'assembled';assembly.mkdir();scope=json.loads((ROOT/'release/scope.json').read_text())
 # Baseline is fixed in the reviewed scope; no arbitrary ref/recipe substitution.
 if ref:
  assert ref==scope['codeRollbackBaseline'],'Unsupported rollback ref'
  scope={**scope,'profile':'native-sync-r21-v3-code-rollback-baseline','includes':['architecture recovery at '+ref],'excludes':['shared contract extraction','server storage-integrity changes','all execution prototypes','production configuration and data']}
 names=(git('ls-tree','-r','--name-only',ref,'overlays').decode().splitlines() if ref else git('ls-files','--cached','--others','--exclude-standard','--','overlays').decode().splitlines())
 inputs={}
 for name in sorted(set(names)):
  source=ROOT/name
  if not ref and not source.exists():continue
  assert not source.is_symlink(),'Source symlinks are not release inputs'
  data=git('show',ref+':'+name) if ref else source.read_bytes();target=assembly/pathlib.Path(name).relative_to('overlays');target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data);inputs[name]=sha(data)
 lock=json.loads((assembly/'VCPToolBox/apps/mobile/package-lock.json').read_text())
 for name in ['vite','vue','@vitejs/plugin-vue','rolldown']:
  actual=json.loads((deps/name/'package.json').read_text())['version'];assert actual==lock['packages']['node_modules/'+name]['version'],name+' lock mismatch'
 if not ref:
  inputs['packages/sync-contracts/src/contracts.mjs']=sha((ROOT/'packages/sync-contracts/src/contracts.mjs').read_bytes())
  subprocess.run([node,str(ROOT/'tools/build_contracts.mjs'),'--out',str(assembly),'--dependencies',str(deps),'--mode','write'],check=True,cwd=ROOT)
  subprocess.run([node,str(ROOT/'tools/build_contracts.mjs'),'--out',str(assembly),'--dependencies',str(deps),'--mode','check'],check=True,cwd=ROOT)
 if not skip_pwa:
  pwa=assembly/'VCPToolBox/apps/mobile';os.symlink(deps,pwa/'node_modules',target_is_directory=True)
  with (out/'pwa-build.txt').open('w') as log:subprocess.run([node,str(deps/'vite/bin/vite.js'),'build','--configLoader','runner'],cwd=pwa,stdout=log,stderr=subprocess.STDOUT,check=True,env={'PATH':str(pathlib.Path(node).parent)+':/usr/bin:/bin','HOME':str(out),'LANG':'C.UTF-8','TZ':'UTC'})
 payload=out/'payload';files=[]
 for f in sorted(assembly.rglob('*')):
  if not f.is_file() or f.is_symlink() or 'node_modules' in f.parts:continue
  name=f.relative_to(assembly).as_posix()
  if name.startswith(tuple(scope['runtimePrefixes'])) or name in scope['integrationModules']:
   assert not f.name.endswith('.env') and f.name!='config.env','Runtime configuration is never packaged'
   target=payload/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(f,target)
 if not skip_pwa:
  for f in sorted((assembly/'VCPToolBox/apps/mobile/dist').rglob('*')):
   if f.is_file():target=payload/'VCPToolBox/Plugin/NativeSync/mobile-dist'/f.relative_to(assembly/'VCPToolBox/apps/mobile/dist');target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(f,target)
 for f in sorted(payload.rglob('*')):
  if f.is_file():
   name=f.relative_to(payload).as_posix();oldname='overlays/'+name
   try:old=git('show',scope['codeRollbackBaseline']+':'+oldname)
   except subprocess.CalledProcessError:old=None
   files.append({'path':name,'sha256':sha(f.read_bytes()),'bytes':f.stat().st_size,'baselineSourceSha256':sha(old) if old is not None else None})
 assert files and not any('executionLifecycle' in r['path'] or 'executionDecisions.generated' in r['path'] for r in files),'Experimental execution adapter in payload'
 if not ref:
  for name in ['VCPChat-startup-diagnostics','VCPChat-linux-pdf','VCPChat-group-parameters']:
   for ext in ['json','patch']:
    f=ROOT/'compat/host-patches'/(name+'.'+ext);inputs[f.relative_to(ROOT).as_posix()]=sha(f.read_bytes())
 for name,digest in inputs.items():
  if not ref:assert sha((ROOT/name).read_bytes())==digest,'Source changed while building'
 fingerprint=sha(json.dumps(inputs,sort_keys=True,separators=(',',':')).encode())
 manifest={'format':1,'profile':scope['profile'],'kind':'rollback-baseline' if ref else 'candidate','sourceCommit':ref or git('rev-parse','HEAD').decode().strip(),'sourceInputsSha256':fingerprint,'sourceDirty':False if ref else bool(git('status','--porcelain')),'completePwa':not skip_pwa,'node':subprocess.check_output([node,'--version'],text=True).strip(),'buildRecipeSha256':sha(b''.join((ROOT/p).read_bytes() for p in ['tools/assemble_release.py','tools/build_contracts.mjs','release/scope.json','tools/check_sync_storage.cjs','tools/install_release.py','tools/dev-environment/install_local.py'])),'buildDependencies':{name:lock['packages']['node_modules/'+name]['version'] for name in ['vite','vue','@vitejs/plugin-vue','rolldown']},'scope':scope,'files':files,'productionTargetVerified':False,'dataRestoreSupported':False}
 if not ref:
  manifest['hostProfiles']=['linux-full-local']
  manifest['hostPatches']=[{**json.loads((ROOT/'compat/host-patches'/(n+'.json')).read_text()),'patch':'compat/host-patches/'+n+'.patch','patchSha256':sha((ROOT/'compat/host-patches'/(n+'.patch')).read_bytes())} for n in ['VCPChat-startup-diagnostics','VCPChat-linux-pdf','VCPChat-group-parameters']]
 write_json(out/'MANIFEST.json',manifest);write_json(out/'SOURCE_INPUTS.json',inputs)
 shutil.copytree(ROOT/'compat',out/'compat');shutil.copytree(ROOT/'LICENSES',out/'LICENSES');shutil.copyfile(ROOT/'NOTICE.md',out/'NOTICE.md')
 if not ref:(out/'diagnostics').mkdir();shutil.copyfile(ROOT/'tools/check_sync_storage.cjs',out/'diagnostics/check_sync_storage.cjs')
 (out/'tools').mkdir();shutil.copyfile(ROOT/'tools/install_release.py',out/'tools/install_release.py')
 if not ref:shutil.copyfile(ROOT/'tools/dev-environment/install_local.py',out/'tools/install_local.py')
 write_json(out/'SCOPE.json',scope)
 if (ROOT/'docs/release-assembly-20261031.md').exists():shutil.copyfile(ROOT/'docs/release-assembly-20261031.md',out/'INSTALL.md')
 if not ref:shutil.copyfile(ROOT/'docs/local-stable-install-20261031.md',out/'LOCAL_INSTALL.md')
 if not ref:shutil.copyfile(ROOT/'docs/desktop-sync-settings-20261031.md',out/'SETTINGS.md')
 if not ref:shutil.copyfile(ROOT/'docs/attachments-local-20261031.md',out/'ATTACHMENTS.md')
 if not ref:shutil.copyfile(ROOT/'docs/groups-local-20261101.md',out/'GROUPS.md')
 manifest['supportFiles']={f.relative_to(out).as_posix():sha(f.read_bytes()) for f in sorted(out.rglob('*')) if f.is_file() and not f.is_symlink() and not f.is_relative_to(out/'assembled') and not f.is_relative_to(payload) and f.name not in ['MANIFEST.json','pwa-build.txt']}
 write_json(out/'MANIFEST.json',manifest)
 print(json.dumps({'output':str(out),'files':len(files),'sourceInputsSha256':fingerprint,'kind':manifest['kind'],'completePwa':not skip_pwa}),flush=True)
 return manifest

def archive(out,dest):
 # assembled/ is disposable build/test material, never part of the install zip.
 with zipfile.ZipFile(dest,'w',zipfile.ZIP_DEFLATED) as z:
  for f in sorted(out.rglob('*')):
   if not f.is_file() or f.is_symlink() or f.is_relative_to(out/'assembled') or f.name=='pwa-build.txt':continue
   info=zipfile.ZipInfo(f.relative_to(out).as_posix(),date_time=(2026,10,31,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16;z.writestr(info,f.read_bytes())
 print(json.dumps({'archive':str(dest),'sha256':sha(dest.read_bytes())}),flush=True)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--out',required=True,type=pathlib.Path);p.add_argument('--node',required=True);p.add_argument('--pwa-dependencies',required=True,type=pathlib.Path);p.add_argument('--baseline-ref');p.add_argument('--skip-pwa',action='store_true');p.add_argument('--zip',type=pathlib.Path);a=p.parse_args();build(a.out,a.node,a.pwa_dependencies,a.baseline_ref,a.skip_pwa)
 if a.zip:archive(a.out.resolve(),a.zip.resolve())
