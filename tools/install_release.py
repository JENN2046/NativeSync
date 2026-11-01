"""Install/restore code only in marked, disposable public-host test fixtures."""
import argparse,hashlib,json,pathlib,shutil,os
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else None
PREFIXES=('VCPChat/modules/services/nativeSync/','VCPChat/modules/nativeSyncSettings/','VCPToolBox/Plugin/NativeSync/')
INTEGRATIONS={'VCPToolBox/modules/requestExecutionContext.js','VCPToolBox/Plugin/AgentAssistant/delegationContinuity.js'}
def relative(name):
 p=pathlib.PurePosixPath(name)
 if not isinstance(name,str) or '\\' in name or p.is_absolute() or '..' in p.parts or p.as_posix()!=name or not (name.startswith(PREFIXES) or name in INTEGRATIONS) or p.name in ['config.env','state.json','settings.json'] or any(x in p.parts for x in ['AppData','UserData','.native-sync']):raise ValueError('UNSAFE_RELEASE_PATH')
 return pathlib.Path(*p.parts)
def safe(root,name):
 p=root/relative(name)
 for q in [p,*p.parents]:
  if q==root.parent:break
  if q.is_symlink():raise ValueError('SYMLINK_TARGET')
 if not p.resolve().is_relative_to(root.resolve()):raise ValueError('OUTSIDE_TARGET')
 if p.exists() and not p.is_file():raise ValueError('NON_FILE_TARGET')
 return p
def save_journal(backup,journal):
 temp=backup/'INSTALL.json.new';temp.write_text(json.dumps(journal,indent=2)+'\n');os.replace(temp,backup/'INSTALL.json')
def verify(package):
 package=package.resolve();m=json.loads((package/'MANIFEST.json').read_text());assert m['format']==1 and m['completePwa'],'Complete PWA release required'
 assert m.get('supportFiles'),'Support inventory required'
 for name,digest in m['supportFiles'].items():
  p=pathlib.PurePosixPath(name);f=package/pathlib.Path(*p.parts);assert not p.is_absolute() and '..' not in p.parts and '\\' not in name and p.as_posix()==name and f.resolve().is_relative_to(package) and not f.is_symlink(),'UNSAFE_SUPPORT_PATH';assert sha(f)==digest,'SUPPORT_HASH_MISMATCH'
 rows={}
 for row in m['files']:
  name=row['path'];assert name not in rows,'Duplicate manifest path';f=safe(package/'payload',name);assert sha(f)==row['sha256'] and f.stat().st_size==row['bytes'],'PAYLOAD_HASH_MISMATCH';rows[name]=row
 actual={p.relative_to(package/'payload').as_posix() for p in (package/'payload').rglob('*') if p.is_file() or p.is_symlink()};assert actual==set(rows),'UNLISTED_PAYLOAD'
 return m,rows
def fixture(root):
 root=root.resolve();assert (root/'.nativesync-isolated-test-root').read_text().strip()=='public-fixture-only','ISOLATED_FIXTURE_REQUIRED'
 assert not any(p in root.parts for p in ['runtime','runtime-data','AppData','UserData','state-private']),'Not a disposable host root'
 return root
def install(package,root,backup,previous,fault_after=None):
 root=fixture(root);package=package.resolve();manifest,new=verify(package);_,old=verify(previous.resolve());backup=backup.resolve()
 assert not backup.exists() and not backup.is_relative_to(root) and not root.is_relative_to(backup),'Backup must be new and outside host roots'
 # Existing host integration requirements are evidence from public snapshots.
 for row in json.loads((package/'compat/VCPChat-host-requirements.json').read_text()):assert sha(root/'VCPChat'/row['path'])==row['sha256'],'VCPCHAT_HOST_REQUIREMENT_MISMATCH'
 aa=json.loads((package/'compat/host-patches/MANIFEST.json').read_text())['files'][-1];assert sha(root/'VCPToolBox'/aa['path'])==aa['afterSha256'],'AA_HOST_REQUIREMENT_MISMATCH'
 names=sorted(set(new)|{n for n in old if n not in new and '/mobile-dist/' not in n});plan=[]
 for name in names:
  f=safe(root,name);before=sha(f);expected=old.get(name,{}).get('sha256');after=new.get(name,{}).get('sha256');assert before==expected,'TARGET_DIRTY '+name
  if before!=after:plan.append({'path':name,'before':before,'after':after})
 backup.mkdir(parents=True);(backup/'files').mkdir();journal={'format':1,'state':'prepared','root':str(root),'manifestSha256':sha(package/'MANIFEST.json'),'plan':plan}
 for row in plan:
  if row['before'] is not None:
   target=backup/'files'/relative(row['path']);target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(safe(root,row['path']),target)
 save=lambda:save_journal(backup,journal);save()
 temporary=[]
 try:
  for i,row in enumerate(plan,1):
   target=safe(root,row['path']);assert sha(target)==row['before'],'TARGET_CHANGED_DURING_INSTALL'
   if row['after'] is None:target.unlink()
   else:
    target.parent.mkdir(parents=True,exist_ok=True);tmp=target.with_name(target.name+'.nativesync-new');assert not tmp.exists() and not tmp.is_symlink(),'TEMP_EXISTS';temporary.append(tmp);shutil.copyfile(package/'payload'/relative(row['path']),tmp);assert sha(tmp)==row['after'];os.replace(tmp,target)
   if fault_after==i:raise RuntimeError('INJECTED_INSTALL_FAILURE')
  journal['state']='installed';save()
 except BaseException:
  rollback(backup,allow_partial=True)
  for temp in temporary:
   if temp.exists() and not temp.is_symlink():temp.unlink()
  raise
 return journal
def rollback(backup,allow_partial=False):
 backup=backup.resolve();journal=json.loads((backup/'INSTALL.json').read_text());allow_partial=allow_partial or journal['state'] in ['prepared','rolling-back'];root=fixture(pathlib.Path(journal['root']));assert journal['state'] in (['prepared','installed','rolling-back'] if allow_partial else ['installed']),'Not an installed code backup'
 # Validate the whole rollback before changing any path. Do not overwrite a
 # concurrent edit made after installation or a corrupted backup.
 for row in journal['plan']:
  f=safe(root,row['path']);allowed={row['before'],row['after']} if allow_partial else {row['after']};assert sha(f) in allowed,'TARGET_DIRTY_DURING_ROLLBACK'
  if row['before'] is not None:assert sha(safe(backup/'files',row['path']))==row['before'],'BACKUP_CORRUPT'
 journal['state']='rolling-back';save_journal(backup,journal)
 for row in reversed(journal['plan']):
  target=safe(root,row['path'])
  if row['before'] is None:
   if target.exists():target.unlink()
  else:
   target.parent.mkdir(parents=True,exist_ok=True);temp=target.with_name(target.name+'.nativesync-restore');assert not temp.exists() and not temp.is_symlink(),'RESTORE_TEMP_EXISTS';shutil.copyfile(backup/'files'/relative(row['path']),temp);assert sha(temp)==row['before'];os.replace(temp,target)
 journal['state']='rolled-back';save_journal(backup,journal);return journal
if __name__=='__main__':
 p=argparse.ArgumentParser();sub=p.add_subparsers(dest='action',required=True);v=sub.add_parser('verify');v.add_argument('--package',required=True,type=pathlib.Path);i=sub.add_parser('install');i.add_argument('--package',required=True,type=pathlib.Path);i.add_argument('--previous',required=True,type=pathlib.Path);i.add_argument('--isolated-hosts',required=True,type=pathlib.Path);i.add_argument('--backup',required=True,type=pathlib.Path);b=sub.add_parser('rollback');b.add_argument('--backup',required=True,type=pathlib.Path);a=p.parse_args()
 try:
  if a.action=='verify':m,rows=verify(a.package);print(json.dumps({'verified':True,'files':len(rows),'profile':m['profile']}))
  elif a.action=='install':print(json.dumps(install(a.package,a.isolated_hosts,a.backup,a.previous)))
  else:print(json.dumps(rollback(a.backup)))
 except (AssertionError,ValueError,OSError) as e:p.exit(1,str(e)+'\n')
