"""Targeted checks for the new deployment tool; synthetic owned local fixture only."""
import argparse
import json
import os
import pathlib
import signal
import subprocess
import sys

REPO=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(REPO/'tools'))
import install_production as tool

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--fixture',type=pathlib.Path,required=True)
parser.add_argument('--package',type=pathlib.Path,required=True)
args=parser.parse_args()
target=tool.Target(args.fixture)
plan_file=REPO/'provenance/production-deployment-preflight-20261102.json'
plan=tool.load_plan(plan_file)
rows=tool.targets(plan,target)
checks=[]


def unchanged(before):
    tool.fail({r['relativeTarget']:tool.digest(r['file']) for r in rows}==before,'GUARD_CHANGED_CODE')


def refusal(action,code):
    try:
        action()
    except ValueError as error:
        tool.fail(str(error).startswith(code),'UNEXPECTED_REFUSAL '+str(error))
    else:
        raise ValueError('EXPECTED_REFUSAL '+code)


facts=tool.database(target,args.package)['facts']
client=tool.digest(args.fixture/'client-state.json')
baseline={r['relativeTarget']:tool.digest(r['file']) for r in rows}
holder=subprocess.Popen([str(target.node),'-e',"const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1],{readOnly:true});console.log('ready');setInterval(()=>{},1000)",str(target.data/'central.sqlite')],cwd=args.fixture,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,start_new_session=True)
try:
    tool.fail(holder.stdout.readline().strip()=='ready','READER_NOT_READY')
    refusal(lambda:tool.install(args.package,plan_file,target,target.backups/'must-refuse-open-db'),'DATABASE_STILL_OPEN')
    unchanged(baseline)
    tool.fail(not (target.backups/'must-refuse-open-db').exists(),'OPEN_DB_CREATED_BACKUP')
    checks.append('active ledger holder rejected before mutation')
finally:
    os.killpg(holder.pid,signal.SIGTERM)
    holder.wait(timeout=10)

configuration=target.root/'Plugin/NativeSync/config.env'
original_configuration=configuration.read_bytes()
lines=configuration.read_text().splitlines()
for i,line in enumerate(lines):
    if line.startswith('NativeSyncFullSources='):
        grants=json.loads(line.split('=',1)[1]);grants[0]['approvedScope']={'mode':'full'}
        lines[i]='NativeSyncFullSources='+json.dumps(grants,separators=(',',':'))
try:
    configuration.write_text('\n'.join(lines)+'\n')
    refusal(lambda:tool.install(args.package,plan_file,target,target.backups/'must-refuse-expanded-authority'),'CONFIGURATION_SCOPE_CHANGED')
    unchanged(baseline)
    tool.fail(not (target.backups/'must-refuse-expanded-authority').exists(),'CHANGED_SCOPE_CREATED_BACKUP')
    checks.append('new authority field rejected even when current limited topics are unchanged')
finally:
    configuration.write_bytes(original_configuration)

file=target.root/'Plugin/NativeSync/mobile/portal.js'
content=file.read_bytes()
file.write_bytes(content+b'\n// synthetic unknown post-install change\n')
edited={r['relativeTarget']:tool.digest(r['file']) for r in rows}
try:
    refusal(lambda:tool.rollback(plan_file,target,target.backups/'reinstalled',args.package),'TARGET_DIRTY')
    unchanged(edited)
    checks.append('dirty rollback refused before any target mutation')
finally:
    file.write_bytes(content)
tool.rollback(plan_file,target,target.backups/'reinstalled',args.package)

content=file.read_bytes()
file.write_bytes(content+b'\n// synthetic unapproved pre-install edit\n')
edited={r['relativeTarget']:tool.digest(r['file']) for r in rows}
try:
    refusal(lambda:tool.install(args.package,plan_file,target,target.backups/'must-refuse-dirty'),'TARGET_DIRTY')
    unchanged(edited)
    tool.fail(not (target.backups/'must-refuse-dirty').exists(),'DIRTY_INSTALL_CREATED_BACKUP')
    checks.append('dirty install refused before backup or target mutation')
finally:
    file.write_bytes(content)

bad=target.backups/'unreviewed-plan.json'
value=json.loads(plan_file.read_text());value['files'][0]['relativeTarget']='../../config.env'
bad.write_bytes(tool.encoded(value))
baseline={r['relativeTarget']:tool.digest(r['file']) for r in rows}
refusal(lambda:tool.install(args.package,bad,target,target.backups/'must-refuse-plan'),'UNREVIEWED_TARGET_PLAN')
unchanged(baseline)
checks.append('changed target mapping rejected by pinned plan digest')

# Abruptly exit after the second target rename, before the journal can record it.
# The injector exists only in this child test process, not the deployment CLI.
child=r'''
import pathlib,sys,os
sys.path.insert(0,sys.argv[1]);import install_production as t
fixture,package,plan,backup=map(pathlib.Path,sys.argv[2:]);target=t.Target(fixture)
original=os.replace;count=0
def interrupted(source,destination):
 global count
 original(source,destination)
 if pathlib.Path(destination).is_relative_to(target.root):
  count+=1
  if count==2:os._exit(86)
os.replace=interrupted
t.install(package,plan,target,backup)
'''
backup=target.backups/'interrupted'
result=subprocess.run([sys.executable,'-c',child,str(REPO/'tools'),str(args.fixture),str(args.package),str(plan_file),str(backup)],capture_output=True,text=True,timeout=60)
tool.fail(result.returncode==86,'INTERRUPTION_NOT_REACHED')
prepared=json.loads((backup/'INSTALL.json').read_text())
tool.fail(prepared['state']=='prepared' and len(prepared['writesCompleted'])==1,'INTERRUPTED_JOURNAL_INVALID')
tool.rollback(plan_file,target,backup,args.package)
tool.verify_phase(rows,'before')
checks.append('actual exit86 after unrecorded second rename recovered using before/after hashes')
tool.install(args.package,plan_file,target,target.backups/'final-guarded')
tool.verify_phase(rows,'after')
tool.fail(tool.database(target,args.package)['facts']==facts,'GUARDS_CHANGED_ACCEPTED_FACTS')
tool.fail(tool.digest(args.fixture/'client-state.json')==client,'GUARDS_CHANGED_CLIENT_CURSOR_OR_SESSION')
output={'result':'PASS','checks':checks,'candidateRuntimeUnchanged':True,'acceptedTableFactsUnchanged':True,'clientStateBytesUnchanged':True,'actualChildExit':86,'productionAccess':False}
(args.fixture/'evidence/installer-guards.json').write_bytes(tool.encoded(output))
print(json.dumps(output))
