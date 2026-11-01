"""Run only the isolated haltedTopics protocol experiment, preserving each run."""
import argparse, datetime, hashlib, json, os, pathlib, re, shutil, subprocess

REPO=pathlib.Path(__file__).resolve().parents[2]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,v):p.write_text(json.dumps(v,indent=2,ensure_ascii=False)+'\n')
def run(product,candidate,out,node,pattern=None):
    assert product!=pathlib.Path('/home/jenn/NativeSync-Dev') and not out.is_relative_to(product),'ISOLATED_REBUILT_CODE_REQUIRED'
    assert json.loads((product/'RESTORE_RESULT.json').read_text())['result']=='PASS','VERIFIED_REBUILD_REQUIRED'
    assert not out.exists(),'NEW_RESULT_DIRECTORY_REQUIRED';out.mkdir(parents=True)
    manifest=json.loads((candidate/'MANIFEST.json').read_text());profile=json.loads((candidate/'compat/dev-hosts/linux-full.json').read_text())
    def inputs():
        result={}
        for row in [*manifest['files'],*profile['files']]:
            value=sha(product/row['path']);assert value==row['sha256'],'PRODUCT_OR_HOST_DRIFT '+row['path'];result[row['path']]=value
        return result
    before=inputs();source=REPO/'experiments/halted-topics';snapshot=out/'inputs';snapshot.mkdir()
    sources={}
    for p in [*sorted(source.glob('*.cjs')),pathlib.Path(__file__).resolve()]:
        shutil.copyfile(p,snapshot/p.name);sources[str(p.relative_to(REPO))]=sha(p)
    provenance={'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=REPO,text=True).strip(),'experimentalSources':sources,'productRoot':str(product),'productManifestSha256':sha(candidate/'MANIFEST.json'),'productAndHostInputs':before,'testNamePattern':pattern,'node':subprocess.check_output([node,'--version'],text=True).strip(),'productionPayloadModified':False}
    write(out/'PROVENANCE.json',provenance)
    args=[node,'--test','--test-concurrency=1','--test-reporter=tap']
    if pattern:args+=['--test-name-pattern='+pattern]
    args+=[str(source/'validation.test.cjs')]
    env={k:v for k,v in os.environ.items() if k in ['PATH','HOME','LANG']};env.update({'HALTED_EXPERIMENT_PRODUCT':str(product),'HALTED_EXPERIMENT_ROOT':str(out)})
    with (out/'validation.tap').open('w') as log:completed=subprocess.run(args,cwd=REPO,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=90)
    text=(out/'validation.tap').read_text();count=lambda label:int(re.search(r'^# '+label+r' (\d+)$',text,re.M)[1])
    assert before==inputs(),'PRODUCT_CODE_CHANGED_DURING_EXPERIMENT'
    result={'result':'PASS' if completed.returncode==0 and count('tests') else 'FAIL','tests':count('tests'),'pass':count('pass'),'fail':count('fail'),'exitCode':completed.returncode,'provenanceSha256':sha(out/'PROVENANCE.json'),'tapSha256':sha(out/'validation.tap'),'productPayloadAndHostBytesUnchanged':True,'fullApplicationOrPhysicalPowerLossAcceptance':False}
    write(out/'RESULT.json',result);print(json.dumps(result));return completed.returncode
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--product-root',required=True,type=pathlib.Path);p.add_argument('--candidate',required=True,type=pathlib.Path);p.add_argument('--out',required=True,type=pathlib.Path);p.add_argument('--node',required=True);p.add_argument('--test-name-pattern');a=p.parse_args();raise SystemExit(run(a.product_root.resolve(),a.candidate.resolve(),a.out.resolve(),a.node,a.test_name_pattern))
