"""Isolated, matched-host Batch1 integration. No production data or real provider."""
import argparse,pathlib,subprocess,json,re,hashlib,shutil
ap=argparse.ArgumentParser();ap.add_argument('--hosts',required=True);ap.add_argument('--node',required=True);ap.add_argument('--output',required=True);ap.add_argument('--dependencies',required=True);a=ap.parse_args();repo=pathlib.Path(__file__).resolve().parents[1];hosts=pathlib.Path(a.hosts).resolve();out=pathlib.Path(a.output).resolve();deps=pathlib.Path(a.dependencies).resolve()
assert (hosts/'.nativesync-isolated-test-root').read_text().strip()=='public-fixture-only';assert not any(s in hosts.parts for s in ['runtime','runtime-data','AppData','UserData','state-private']);assert not (hosts/'VCPChat/AppData').exists();assert not out.exists();out.mkdir(parents=True)
node=str(pathlib.Path(a.node).resolve());version=subprocess.check_output([node,'--version'],text=True).strip();assert version.startswith('v24.')
names=subprocess.check_output(['git','ls-files','overlays'],cwd=repo,text=True).splitlines();before={n:hashlib.sha256((repo/n).read_bytes()).hexdigest() for n in names}
for n in names:
 f=repo/n;t=hosts/f.relative_to(repo/'overlays');t.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(f,t)
for f in (repo/'tests/host-fixtures').glob('*.test.cjs'):shutil.copyfile(f,hosts/'VCPToolBox/tests'/f.name)
env={'PATH':str(pathlib.Path(node).parent)+':/usr/bin:/bin','HOME':str(out),'LANG':'C.UTF-8','TZ':'UTC','NATIVESYNC_TEST_HOSTS':str(hosts),'VCP_R21_BOX_SOURCE':str(hosts/'VCPToolBox'),'VCP_R21_AA_DEPENDENCIES':str(deps),'NODE_V8_COVERAGE':str(out/'module-coverage')}
selection=[(repo/'tests'/n,None) for n in ['scope-transition.test.cjs','source-execution-wiring.test.cjs','m2-continuity.test.cjs','m2-process-recovery.test.cjs','m3-multi-agent.test.cjs','reuse-audit.test.cjs']]
selection += [(hosts/'VCPToolBox/tests'/n,None) for n in ['native-sync-mobile-recovery.test.cjs','native-sync-attachments.test.cjs','native-sync-attachment-routes.test.cjs','native-sync-groupchat.test.cjs','native-sync-aa-continuity.test.cjs','native-sync-aa-native-chain.test.cjs','native-sync-native-approval.test.cjs']]
selection += [(hosts/'VCPChat/tests/native-sync-attachments.test.cjs',None)]
selection += [(hosts/'VCPChat/tests/native-sync-full-source.test.cjs','F1 source coordinator|F2 directory precedes')]
rows=[]
for i,(f,pattern) in enumerate(selection):
 cmd=[node,'--test','--test-reporter=tap']+(['--test-name-pattern='+pattern] if pattern else [])+[str(f)];r=subprocess.run(cmd,env=env,cwd=f.parent,capture_output=True,text=True,timeout=100);tap=f'{i+1}-{f.name}.tap';(out/tap).write_text(r.stdout+r.stderr);counts={k:int(v) for k,v in re.findall(r'^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$',r.stdout,re.M)};row={'file':str(f),'pattern':pattern,'tap':tap,'command':cmd,'exitCode':r.returncode,'counts':counts};rows.append(row);print(json.dumps(row),flush=True)
after={n:hashlib.sha256((repo/n).read_bytes()).hexdigest() for n in names};assert before==after
totals={k:sum(r['counts'].get(k,0) for r in rows) for k in ['tests','pass','fail','cancelled','skipped','todo']};passed=totals['tests']==totals['pass']>0 and all(r['exitCode']==0 for r in rows) and all(totals[k]==0 for k in ['fail','cancelled','skipped','todo'])
result={'result':'PASS' if passed else 'FAIL','node':version,'rows':rows,'total':totals,'sourceFingerprintUnchanged':True,'scope':'real modules plus synthetic loopback HTTP/SQLite/AppData and native AA process; no actual PWA browser/Electron/phone','realProviderCalls':0,'productionServiceOrDataAccessed':False,'sameSourceControlledExpansion':'tested separately from unsupported new-source handover','legacyNewSourceCounterexample':'historical preserved, not reclassified as passing this route'}
(out/'RESULT.json').write_text(json.dumps(result,indent=2));(out/'SOURCE_FINGERPRINTS.json').write_text(json.dumps({'before':before,'after':after},indent=2));print(json.dumps({'result':result['result'],'total':totals}));raise SystemExit(0 if passed else 1)
