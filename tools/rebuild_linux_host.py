"""Rebuild a sealed public host code tree into a new directory; never start it."""
import argparse, hashlib, json, os, pathlib, shutil, subprocess, tarfile

def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def safe(name):
    p=pathlib.PurePosixPath(name);assert not p.is_absolute() and '..' not in p.parts and '\\' not in name,'UNSAFE_ARCHIVE_PATH';return p
def rebuild(seal,out):
    assert not out.exists() and not out.is_symlink(),'NEW_REBUILD_DIRECTORY_REQUIRED';out.mkdir(parents=True)
    manifest=json.loads((seal/'HOST_CODE_MANIFEST.json').read_text());profile=json.loads((seal/'linux-full.json').read_text())
    assert manifest['kind']=='nativesync-sealed-public-linux-host'
    for host,anchor in manifest['anchors'].items():
        target=out/host;target.mkdir();archive=seal/host/'public-anchor.tar.gz';patch=seal/host/'host-baseline.patch'
        assert digest(archive)==anchor['publicAnchorSha256'] and digest(patch)==anchor['patchSha256'],'SEALED_INPUT_CHANGED'
        with tarfile.open(archive,'r:gz') as tar:
            for member in tar:
                name=safe(member.name);assert member.isfile(),'REGULAR_CODE_ONLY';f=target/name;f.parent.mkdir(parents=True,exist_ok=True)
                with tar.extractfile(member) as src,f.open('xb') as dest:shutil.copyfileobj(src,dest)
                f.chmod(member.mode & 0o777)
        if patch.stat().st_size:
            subprocess.run(['git','apply','--whitespace=nowarn','--check',str(patch)],cwd=target,check=True)
            subprocess.run(['git','apply','--whitespace=nowarn',str(patch)],cwd=target,check=True)
    for row in manifest['files']:
        f=out/safe(row['path']);assert f.is_file() and digest(f)==row['sha256'],'HOST_CODE_MISMATCH '+row['path']
        assert bool(f.stat().st_mode & 0o111)==(row['mode']=='100755'),'HOST_MODE_MISMATCH '+row['path']
    candidate=seal/'candidate';assert digest(candidate/'MANIFEST.json')==manifest['runtimePayloadManifestSha256']
    payload=json.loads((candidate/'MANIFEST.json').read_text())
    for row in payload['files']:
        name=safe(row['path']);source=candidate/'payload'/name;assert digest(source)==row['sha256'];target=out/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,target)
    for patch in payload['hostPatches']:
        assert digest(out/'VCPChat'/safe(patch['path']))==patch['afterSha256'],'HOST_COMPAT_MISMATCH'
    for row in profile['files']:assert digest(out/safe(row['path']))==row['sha256'],'LINUX_FULL_PROFILE_MISMATCH '+row['path']
    report={'result':'PASS','hosts':manifest['anchors'],'hostPublicFilesVerified':len(manifest['files']),'runtimeFilesVerified':len(payload['files']),'linuxFullRequirementsVerified':len(profile['files']),'sourceHostRequiredDuringRestore':False,'networkUsed':False,'dependenciesInstalled':False,'runtimeStarted':False,'configurationOrRuntimeDataRestored':False}
    (out/'RESTORE_RESULT.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report),flush=True)
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--seal',type=pathlib.Path,default=pathlib.Path(__file__).resolve().parent);p.add_argument('--out',type=pathlib.Path,required=True);a=p.parse_args();rebuild(a.seal.resolve(),a.out.resolve())
