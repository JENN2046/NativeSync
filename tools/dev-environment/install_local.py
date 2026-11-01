"""Code-only candidate install for the fixed owned local VCP development roots."""
import argparse,hashlib,importlib.util,json,os,pathlib,shutil,sys
REPO=pathlib.Path(__file__).resolve().parents[2]
DEV=pathlib.Path('/home/jenn/NativeSync-Dev')
RUNS=pathlib.Path('/var/tmp')/('nativesync-full-runtime-'+str(os.getuid()))/'runs'
helper=pathlib.Path(__file__).resolve().parent/'install_release.py'
if not helper.exists():helper=REPO/'tools/install_release.py'
spec=importlib.util.spec_from_file_location('release_install',helper);release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else None
def write(p,v):
    temp=p.with_name(p.name+'.new');temp.write_text(json.dumps(v,indent=2)+'\n');os.replace(temp,p)
def root_check(root):
    assert not root.is_symlink(),'ROOT_ALIAS';root=root.resolve()
    if root!=DEV:
        assert root.parent==RUNS,'OWNED_LOCAL_ROOT_REQUIRED'
        assert json.loads((root/'ISOLATED.json').read_text())['kind']=='nativesync-full-local-runtime'
    for pid in json.loads((root/'data/processes.json').read_text()).values():
        try:
            proc=pathlib.Path('/proc')/str(pid)
            if proc.joinpath('stat').read_text().rsplit(')',1)[1].split()[0]=='Z':continue
            cwd=pathlib.Path(os.readlink(proc/'cwd'))
            assert not cwd.is_relative_to(root),'STOP_OWNED_PROCESSES_BEFORE_INSTALL'
        except FileNotFoundError:pass
    return root
def target(root,name):
    p=pathlib.PurePosixPath(name)
    assert not p.is_absolute() and '..' not in p.parts and '\\' not in name,'UNSAFE_PATH'
    assert name.startswith(('VCPChat/modules/services/nativeSync/','VCPChat/modules/nativeSyncSettings/','VCPToolBox/Plugin/NativeSync/')) or name in ['VCPToolBox/modules/requestExecutionContext.js','VCPToolBox/Plugin/AgentAssistant/delegationContinuity.js','VCPChat/modules/renderer/nativeExecutionStatus.js'],'PATH_NOT_OWNED'
    f=root/name
    for q in [f,*f.parents]:
        if q==root:break
        assert not q.is_symlink(),'TARGET_ALIAS'
    assert not f.exists() or f.is_file(),'NON_FILE_TARGET'
    return f
def install(package,previous,root,backup):
    root=root_check(root);new_m,new=release.verify(package);old_m,old=release.verify(previous)
    assert not backup.exists() and not backup.is_relative_to(root),'NEW_EXTERNAL_BACKUP_REQUIRED'
    assert 'linux-full-local' in new_m.get('hostProfiles',[]),'LOCAL_PROFILE_NOT_DECLARED'
    profile=json.loads((package/'compat/dev-hosts/linux-full.json').read_text())
    for row in profile['files']:
        p=pathlib.PurePosixPath(row['path']);assert not p.is_absolute() and '..' not in p.parts
        assert sha(root/row['path'])==row['sha256'],'FULL_HOST_REQUIREMENT_MISMATCH '+row['path']
    # Explicit support patch, with its own before/after hashes; never arbitrary diff.
    patchmeta=package/'compat/host-patches/VCPChat-startup-diagnostics.json';patch=None
    if patchmeta.exists():patch=json.loads(patchmeta.read_text())
    plans=[]
    for name in sorted(set(new)|set(old)):
        f=target(root,name);before=sha(f);expected=old.get(name,{}).get('sha256');after=new.get(name,{}).get('sha256')
        assert before==expected,'TARGET_DIRTY '+name
        if before!=after:plans.append({'path':name,'before':before,'after':after,'source':str(package/'payload'/name) if after else None})
    if patch:
        name='VCPChat/'+patch['path'];f=target(root,name);before=sha(f)
        assert before in [patch['beforeSha256'],patch['afterSha256']],'HOST_PATCH_TARGET_DIRTY'
        if before==patch['beforeSha256']:
            # Check/apply only to a temporary code-only copy, before mutating target.
            import tempfile,subprocess
            with tempfile.TemporaryDirectory(prefix='nativesync-host-patch-') as temp:
                stage=pathlib.Path(temp);out=stage/patch['path'];out.parent.mkdir(parents=True);shutil.copyfile(f,out)
                subprocess.run(['git','apply',str(package/'compat/host-patches/VCPChat-startup-diagnostics.patch')],cwd=stage,check=True)
                assert sha(out)==patch['afterSha256'],'PATCH_RESULT_MISMATCH'
                content=out.read_bytes()
            plans.append({'path':name,'before':before,'after':patch['afterSha256'],'patchContent':content})
    backup.mkdir(parents=True);(backup/'files').mkdir();(backup/'new-files').mkdir()
    for row in plans:
        f=target(root,row['path']);oldfile=backup/'files'/row['path'];oldfile.parent.mkdir(parents=True,exist_ok=True)
        if row['before'] is not None:shutil.copyfile(f,oldfile)
        if row['after'] is not None:
            newfile=backup/'new-files'/row['path'];newfile.parent.mkdir(parents=True,exist_ok=True)
            if 'patchContent' in row:newfile.write_bytes(row.pop('patchContent'))
            else:shutil.copyfile(row['source'],newfile)
    journal={'format':1,'root':str(root),'state':'prepared','packageManifestSha256':sha(package/'MANIFEST.json'),'previousManifestSha256':sha(previous/'MANIFEST.json'),'plan':plans,'dataTouched':False}
    write(backup/'INSTALL.json',journal)
    try:
        for row in plans:
            f=target(root,row['path']);assert sha(f)==row['before'],'TARGET_CHANGED_DURING_INSTALL'
            if row['after'] is None:f.unlink()
            else:
                temp=f.with_name(f.name+'.nativesync-new');assert not temp.exists(),'TEMP_EXISTS';shutil.copyfile(backup/'new-files'/row['path'],temp);assert sha(temp)==row['after'];os.replace(temp,f)
        journal['state']='installed';write(backup/'INSTALL.json',journal)
    except BaseException:
        rollback(backup);raise
    return journal
def rollback(backup):
    journal=json.loads((backup/'INSTALL.json').read_text());root=root_check(pathlib.Path(journal['root']))
    # Preflight the whole set before restoring any file; includes interrupted install.
    for row in journal['plan']:
        assert sha(target(root,row['path'])) in [row['before'],row['after']],'DIRTY_ROLLBACK_TARGET'
        if row['before'] is not None:assert sha(backup/'files'/row['path'])==row['before'],'DIRTY_BACKUP'
    for row in reversed(journal['plan']):
        f=target(root,row['path'])
        if sha(f)==row['before']:continue
        if row['before'] is None:f.unlink()
        else:
            temp=f.with_name(f.name+'.nativesync-restore');assert not temp.exists();shutil.copyfile(backup/'files'/row['path'],temp);os.replace(temp,f)
    journal['state']='rolled-back';write(backup/'INSTALL.json',journal);return journal
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('operation',choices=['install','rollback']);p.add_argument('--root',type=pathlib.Path,default=DEV);p.add_argument('--package',type=pathlib.Path);p.add_argument('--previous',type=pathlib.Path);p.add_argument('--backup',type=pathlib.Path,required=True);a=p.parse_args()
    result=rollback(a.backup.resolve()) if a.operation=='rollback' else install(a.package.resolve(),a.previous.resolve(),a.root,a.backup.resolve());print(json.dumps({'state':result['state'],'root':result['root'],'changedFiles':len(result['plan']),'dataTouched':False}))
