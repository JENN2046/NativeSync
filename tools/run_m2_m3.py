"""Targeted synthetic M2/M3 runner. Exit 2 means the explicitly preserved M3 upgrade gap."""
import argparse,pathlib,subprocess,json,hashlib,re,shutil
ap=argparse.ArgumentParser();ap.add_argument('--hosts',required=True);ap.add_argument('--node',required=True);ap.add_argument('--output',required=True);a=ap.parse_args()
repo=pathlib.Path(__file__).resolve().parents[1];hosts=pathlib.Path(a.hosts).resolve();out=pathlib.Path(a.output).resolve()
assert (hosts/'.nativesync-isolated-test-root').read_text().strip()=='public-fixture-only'
assert not any(x in hosts.parts for x in ['runtime','runtime-data','AppData','UserData','state-private']);assert not (hosts/'VCPChat/AppData').exists();assert not out.exists();out.mkdir(parents=True)
node=str(pathlib.Path(a.node).resolve());version=subprocess.check_output([node,'--version'],text=True).strip();assert version.startswith('v24.')
def fingerprints():return {str(f.relative_to(repo)):hashlib.sha256(f.read_bytes()).hexdigest() for f in (repo/'overlays').rglob('*') if f.is_file()}
before=fingerprints()
for f in (repo/'overlays').rglob('*'):
 if f.is_file():target=hosts/f.relative_to(repo/'overlays');target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(f,target)
env={'PATH':str(pathlib.Path(node).parent)+':/usr/bin:/bin','HOME':str(out),'LANG':'C.UTF-8','TZ':'UTC','NATIVESYNC_TEST_HOSTS':str(hosts),'VCP_R21_BOX_SOURCE':str(hosts/'VCPToolBox'),'NODE_V8_COVERAGE':str(out/'module-coverage')}
files=['m2-continuity.test.cjs','m2-process-recovery.test.cjs','m3-multi-agent.test.cjs','known-gaps/m3-existing-source-expansion.test.cjs'];results=[]
for i,name in enumerate(files):
 command=[node,'--test','--test-reporter=tap',str(repo/'tests'/name)];r=subprocess.run(command,env=env,cwd=repo,capture_output=True,text=True,timeout=180);tap=f'{i+1}-{pathlib.Path(name).name}.tap';(out/tap).write_text(r.stdout+r.stderr)
 counts={k:int(v) for k,v in re.findall(r'^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$',r.stdout,re.M)};named=len(re.findall(r'^# Subtest:',r.stdout,re.M));gap=i==3
 expected=bool(r.returncode==1 and counts.get('tests')==1 and counts.get('fail')==1 and named==1 and 'SOURCE_BINDING_CHANGED' in r.stdout and 'SyntaxError:' not in r.stdout) if gap else bool(r.returncode==0 and counts.get('tests')==counts.get('pass')==named and named>0)
 expected=expected and all(counts.get(k)==0 for k in ['cancelled','skipped','todo'])
 row={'file':name,'command':command,'tap':tap,'exitCode':r.returncode,'counts':counts,'namedTests':named,'expectedResultMatched':expected,'capabilityGap':gap};results.append(row);print(json.dumps(row),flush=True)
after=fingerprints();assert before==after
supported={k:sum(r['counts'].get(k,0) for r in results[:3]) for k in ['tests','pass','fail','cancelled','skipped','todo']};valid=all(r['expectedResultMatched'] for r in results)
summary={'result':'PARTIAL_KNOWN_M3_UPGRADE_BLOCKED' if valid else 'FAIL','node':version,'rows':results,'supportedSuite':supported,'requiredUpgradeProbe':results[3]['counts'],'M2':'PASS' if all(r['expectedResultMatched'] for r in results[:2]) else 'FAIL','M3FreshExplicitScope':'PASS' if results[2]['expectedResultMatched'] else 'FAIL','M3ExistingBindingUpgrade':'BLOCKED','noProductChangesDuringRun':True,'scope':'temporary synthetic AppData/SQLite; native Queue/Adapter/SourceSync/HTTP/MobilePortal; mock phone over loopback trusted-TLS-termination context, no browser/Electron/model','productionAccess':False,'providerCalls':0,'toolCalls':0,'AAStarts':0,'realPhoneActions':0}
(out/'RESULT.json').write_text(json.dumps(summary,indent=2));(out/'SOURCE_FINGERPRINTS.json').write_text(json.dumps({'before':before,'after':after},indent=2));print(json.dumps({'result':summary['result'],'supportedSuite':supported,'requiredUpgradeProbe':results[3]['counts']}));raise SystemExit(2 if valid else 1)
