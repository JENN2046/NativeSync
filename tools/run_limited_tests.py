import argparse,pathlib,subprocess,os,shutil,json,re,hashlib
parser=argparse.ArgumentParser(description='Isolated NativeSync targeted regressions, zero provider calls')
parser.add_argument('--hosts',required=True);parser.add_argument('--node',required=True);parser.add_argument('--output',required=True)
a=parser.parse_args();repo=pathlib.Path(__file__).resolve().parents[1];hosts=pathlib.Path(a.hosts).resolve();out=pathlib.Path(a.output).resolve()
assert (hosts/'.nativesync-isolated-test-root').read_text().strip()=='public-fixture-only','Require an explicitly prepared public-only test host root'
assert not any(x in hosts.parts for x in ['runtime','runtime-data','AppData','UserData','state-private']), 'Never overlay production or real data'
assert not (hosts/'VCPChat/AppData').exists(),'Test host must not contain real AppData'
assert not out.exists(),'Use a new output directory'
out.mkdir(parents=True)
node=str(pathlib.Path(a.node).resolve());version=subprocess.check_output([node,'--version'],text=True).strip();assert version.startswith('v24.'),version
products=list((repo/'overlays').rglob('*'))
def fingerprints():return {str(f.relative_to(repo)):hashlib.sha256(f.read_bytes()).hexdigest() for f in products if f.is_file()}
before=fingerprints()
for f in products:
 if f.is_file():
  target=hosts/f.relative_to(repo/'overlays');target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(f,target)
env={'PATH':str(pathlib.Path(node).parent)+':/usr/bin:/bin','HOME':str(out),'LANG':'C.UTF-8','TZ':'UTC','NODE_V8_COVERAGE':str(out/'module-coverage'),'NATIVESYNC_TEST_HOSTS':str(hosts),'VCP_R21_BOX_SOURCE':str(hosts/'VCPToolBox')}
tests=[repo/'tests/known-gaps/first-batch-existing-protocol.test.cjs',hosts/'VCPChat/tests/native-sync-full-source.test.cjs',hosts/'VCPChat/tests/native-sync-full-source-crash.test.cjs',repo/'tests/snapshot-prompt.test.cjs']
rows=[]
for i,f in enumerate(tests):
 cmd=[node,'--test','--test-reporter=tap',str(f)]
 r=subprocess.run(cmd,env=env,capture_output=True,text=True,timeout=180)
 name=f'{i+1}-{f.name}.tap';(out/name).write_text(r.stdout+r.stderr)
 counts={k:int(v) for k,v in re.findall(r'^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$',r.stdout,re.M)}
 rows.append({'file':str(f),'command':cmd,'tap':name,'exitCode':r.returncode,'counts':counts,'namedTests':len(re.findall(r'^# Subtest:',r.stdout,re.M))})
 print(json.dumps(rows[-1]),flush=True)
after=fingerprints();assert before==after,'Product source changed during tests'
totals={k:sum(r['counts'].get(k,0) for r in rows) for k in ['tests','pass','fail','cancelled','skipped','todo']}
passed=all(r['exitCode']==0 and r['counts'].get('tests')==r['counts'].get('pass') and r['namedTests']==r['counts'].get('tests') for r in rows) and totals['tests']>0 and all(totals[k]==0 for k in ['fail','cancelled','skipped','todo'])
(out/'SOURCE_FINGERPRINTS.json').write_text(json.dumps({'before':before,'after':after},indent=2))
(out/'RESULT.json').write_text(json.dumps({'node':version,'rows':rows,'total':totals,'sourceUnchanged':before==after,'result':'PASS' if passed else 'FAIL','providerCalls':0,'toolCalls':0,'AAStarts':0,'productionWrites':0,'evidenceLevel':'real Queue/Adapter/HTTP/SQLite with synthetic AppData and execution facts; no native-model invocation or phone acceptance'},indent=2))
print(json.dumps({'total':totals,'result':'PASS' if passed else 'FAIL'}));raise SystemExit(0 if passed else 1)
