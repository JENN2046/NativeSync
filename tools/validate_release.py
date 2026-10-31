"""Verify assembly/isolated install/code rollback with synthetic retained facts."""
import argparse,hashlib,json,pathlib,shutil,subprocess,sys,os
from install_release import install,rollback,verify
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
p=argparse.ArgumentParser();p.add_argument('--candidate',required=True,type=pathlib.Path);p.add_argument('--previous',required=True,type=pathlib.Path);p.add_argument('--template-hosts',required=True,type=pathlib.Path);p.add_argument('--out',required=True,type=pathlib.Path);p.add_argument('--node',required=True);p.add_argument('--dependencies',required=True);p.add_argument('--pwa-dependencies',required=True);a=p.parse_args();r=pathlib.Path(__file__).resolve().parents[1];out=a.out.resolve();assert not out.exists();out.mkdir(parents=True);candidate=a.candidate.resolve();previous=a.previous.resolve();template=a.template_hosts.resolve();hosts=out/'hosts';assert (template/'.nativesync-isolated-test-root').read_text().strip()=='public-fixture-only'
# Public host source only, retaining existing dependency links. No runtime data.
assert not (template/'VCPChat/AppData').exists();shutil.copytree(template,hosts,symlinks=True,ignore=shutil.ignore_patterns('nativeSync','NativeSync','mobile','architecture-baseline-adapter.cjs'))
for f in (previous/'payload').rglob('*'):
 if f.is_file():target=hosts/f.relative_to(previous/'payload');target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(f,target)
_,new=verify(candidate);_,old=verify(previous);names=set(new)|set(old);before={n:sha(hosts/n) if (hosts/n).is_file() else None for n in names};data=out/'synthetic-data';checks=[]
def baseline():assert {n:sha(hosts/n) if (hosts/n).is_file() else None for n in names}==before,'Code not fully restored'
def probe(stage):
 env={'PATH':str(pathlib.Path(a.node).parent)+':/usr/bin:/bin','LANG':'C.UTF-8','TZ':'UTC','HOME':str(out)};x=subprocess.run([a.node,str(r/'tests/fixtures/releaseLifecycleProbe.cjs'),str(hosts),str(data),stage],env=env,text=True,capture_output=True,timeout=15);(out/(stage+'-probe.txt')).write_text(x.stdout+x.stderr);assert x.returncode==0,x.stdout+x.stderr;return json.loads(x.stdout)
seed=probe('seed');state=sha(data/'desktop-state-v3.json');(hosts/'VCPToolBox/Plugin/NativeSync/config.env').write_text('SYNTHETIC_CONFIG_MUST_SURVIVE=1\n');configuration=sha(hosts/'VCPToolBox/Plugin/NativeSync/config.env')
# All preflight failures must leave the code set untouched.
first=sorted(new)[0];saved=(hosts/first).read_bytes();(hosts/first).write_bytes(saved+b'\n// synthetic local edit\n')
try:
 try:install(candidate,hosts,out/'dirty-backup',previous);raise RuntimeError('Dirty target accepted')
 except AssertionError as e:assert 'TARGET_DIRTY' in str(e)
finally:(hosts/first).write_bytes(saved)
baseline();checks.append('dirty-target refused before changes')
tampered=out/'tampered-package';shutil.copytree(candidate,tampered,ignore=shutil.ignore_patterns('assembled'));f=tampered/'payload'/first;f.write_bytes(f.read_bytes()+b'\n// synthetic tamper\n')
try:install(tampered,hosts,out/'tamper-backup',previous);raise RuntimeError('Tampered payload accepted')
except AssertionError as e:assert 'HASH_MISMATCH' in str(e)
baseline();checks.append('tampered payload refused before changes')
try:install(candidate,hosts,out/'failed-backup',previous,fault_after=2);raise RuntimeError('Missing injection')
except RuntimeError as e:assert str(e)=='INJECTED_INSTALL_FAILURE'
baseline();checks.append('mid-install exception restores old code')
# Actual process loss after the second atomic file replacement. Recovery uses
# the durable prepared install plan and rechecks every before/after digest.
child="""import sys,os,pathlib
sys.path.insert(0,sys.argv[1]);from install_release import install
original=os.replace;count=0
def interrupted(*args):
 global count
 original(*args)
 if pathlib.Path(args[1]).name!='INSTALL.json':count+=1
 if count==2:os._exit(76)
os.replace=interrupted
install(*map(pathlib.Path,sys.argv[2:]))
"""
x=subprocess.run([sys.executable,'-c',child,str(r/'tools'),str(candidate),str(hosts),str(out/'crash-backup'),str(previous)],capture_output=True,text=True,timeout=15);assert x.returncode==76,x.stderr;rollback(out/'crash-backup');baseline();checks.append('actual child exit76 recovered from prepared plan')
installation=install(candidate,hosts,out/'installed-backup',previous);upgraded=probe('candidate');assert sha(data/'desktop-state-v3.json')==state;assert sha(hosts/'VCPToolBox/Plugin/NativeSync/config.env')==configuration
checks.append('installed candidate retains original message/receipt/review job; no automatic dispatch')
static=subprocess.run([a.node,str(r/'tests/fixtures/releaseStaticProbe.cjs'),str(hosts),str(data),str(candidate)],env={'PATH':str(pathlib.Path(a.node).parent)+':/usr/bin:/bin','HOME':str(out)},capture_output=True,text=True,timeout=15);(out/'static-probe.txt').write_text(static.stdout+static.stderr);assert static.returncode==0,static.stdout+static.stderr;checks.append('all eight installed PWA files served by actual MobilePortal with matching digests')
# A dirty rollback must be refused atomically, then work after the edit is removed.
changed=installation['plan'][0]['path'];saved=(hosts/changed).read_bytes();(hosts/changed).write_bytes(saved+b'\n// post-install edit\n')
try:
 try:rollback(out/'installed-backup');raise RuntimeError('Dirty rollback accepted')
 except AssertionError as e:assert 'TARGET_DIRTY_DURING_ROLLBACK' in str(e)
finally:(hosts/changed).write_bytes(saved)
rollback(out/'installed-backup');baseline();restored=probe('rollback');assert sha(data/'desktop-state-v3.json')==state;assert sha(hosts/'VCPToolBox/Plugin/NativeSync/config.env')==configuration
checks.append('code rollback keeps post-upgrade messages, old task identity, config and v3 state')
install(candidate,hosts,out/'reinstalled-backup',previous)
# Integration executes the installed package. It must not overlay source files.
cmd=[sys.executable,str(r/'tools/run_full_feature.py'),'--hosts',str(hosts),'--node',a.node,'--dependencies',a.dependencies,'--output',str(out/'integration'),'--release',str(candidate),'--assembly',str(candidate/'assembled'),'--pwa-dependencies',a.pwa_dependencies]
with (out/'integration-driver.txt').open('w') as log:x=subprocess.run(cmd,cwd=r,stdout=log,stderr=subprocess.STDOUT,timeout=300)
result=json.loads((out/'integration/RESULT.json').read_text());assert x.returncode==0 and result['result']=='PASS',str(out/'integration-driver.txt')
for name,row in new.items():assert sha(hosts/name)==row['sha256'],'Installed release changed during testing'
checks.append('full selected integration uses unchanged installed payload')
receipt={'result':'PASS','checks':checks,'seed':seed,'upgraded':upgraded,'rolledBack':restored,'integration':result['total'],'installedManifestSha256':sha(candidate/'MANIFEST.json'),'desktopStateBytesPreserved':True,'configurationBytesPreserved':True,'hostCoreObserved':{str(f.relative_to(hosts)):sha(f) for f in [hosts/'VCPToolBox/server.js',hosts/'VCPToolBox/Plugin.js']},'productionAccess':False,'scope':'public host fixtures with synthetic SQLite and loopback providers; no physical Windows/browser/device acceptance'}
(out/'RESULT.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt,ensure_ascii=False))
