"""Prepare/restore only new Source execution config keys in a stopped local root."""
import argparse,json,pathlib,sqlite3,os,stat,hashlib
from install_local import root_check

def digest(data):return hashlib.sha256(data).hexdigest()
def atomic(file,data):
    temp=file.with_name(file.name+'.source-compat-new');assert not temp.exists() and not temp.is_symlink()
    with temp.open('xb') as f:os.chmod(temp,stat.S_IMODE(file.stat().st_mode) if file.exists() else 0o600);f.write(data);f.flush();os.fsync(f.fileno())
    os.replace(temp,file);fd=os.open(file.parent,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(fd)
    finally:os.close(fd)
def encoded(value):return (json.dumps(value,indent=2,ensure_ascii=False)+'\n').encode()
def files(root):
    connection=root/'data/chat/.native-sync/connection.json';env=root/'VCPToolBox/config.env'
    for p in [connection,env]:assert p.is_file() and not p.is_symlink() and p.stat().st_nlink==1,'CONFIG_ALIAS'
    value=json.loads(connection.read_text());lines=env.read_text().splitlines(keepends=True);matches=[i for i,s in enumerate(lines) if s.startswith('NativeSyncFullSources=')];assert len(matches)==1,'EXACT_SOURCE_CONFIG_REQUIRED'
    index=matches[0];grants=json.loads(lines[index].split('=',1)[1]);return connection,env,value,lines,index,grants
def settled(root,value):
    state=json.loads((root/'data/chat/.native-sync/state.json').read_text());assert value['scopeMode']=='source' and state['source']['binding']['sourceId']==value['sourceId'],'SOURCE_BINDING_REQUIRED'
    assert not state['outbox'] and not state['inbox'] and not state.get('pending') and not state['localCommits'] and not state['drift'] and not state['source'].get('pendingCatalog'),'SOURCE_NOT_SETTLED'
    assert all(p['stage']=='complete' and not p.get('error') for p in state['source']['plans'].values()),'IMPORT_NOT_SETTLED'
    assert all(p['stage'] in ['published','aborted'] for p in state['source']['deletions'].values()),'DELETE_NOT_SETTLED'
    db=sqlite3.connect('file:'+str(root/'data/native-sync/central.sqlite')+'?mode=ro',uri=True)
    try:
        assert db.execute("SELECT count(*) FROM mobile_executions WHERE state IN ('preparing','queued','running','publishing','cancelling','waiting_approval','recovering','review_required','blocked_config')").fetchone()[0]==0,'EXECUTIONS_NOT_SETTLED'
        assert db.execute("SELECT count(*) FROM mobile_native_tasks WHERE state NOT IN ('completed','failed','cancelled','stopped')").fetchone()[0]==0,'NATIVE_TASKS_NOT_SETTLED'
    finally:db.close()
def prepare(root,receipt):
    root=root_check(root);assert not receipt.exists() and not receipt.is_relative_to(root),'NEW_EXTERNAL_RECEIPT_REQUIRED'
    connection,env,value,lines,index,grants=files(root);settled(root,value);assert value.get('executionMode')=='all-supported','ALL_SUPPORTED_MODE_REQUIRED'
    target=next(g for g in grants if g['sourceId']==value['sourceId']);assert target.get('executionMode')=='all-supported','SOURCE_EXECUTION_NOT_APPROVED'
    assert all(g is target or not any(k in g for k in ['executionMode','imageModels']) for g in grants),'OTHER_SOURCE_NEW_CAPABILITIES'
    removed={'connection':{'executionMode':value.pop('executionMode')},'grant':{k:target.pop(k) for k in ['executionMode','imageModels'] if k in target}}
    lines[index]='NativeSyncFullSources='+json.dumps(grants,separators=(',',':'),ensure_ascii=False)+'\n';after={str(connection.relative_to(root)):encoded(value),str(env.relative_to(root)):''.join(lines).encode()}
    row={'root':str(root),'sourceId':value['sourceId'],'state':'prepared','removed':removed,'files':{name:{'beforeSha256':digest((root/name).read_bytes()),'afterSha256':digest(data)} for name,data in after.items()},'databaseStateOrScopeRestored':False}
    receipt.parent.mkdir(parents=True,exist_ok=True);atomic(receipt,encoded(row))
    for name,data in after.items():assert digest((root/name).read_bytes())==row['files'][name]['beforeSha256'],'CONFIG_CHANGED';atomic(root/name,data)
    return row
def restore(receipt):
    row=json.loads(receipt.read_text());assert row['state']=='prepared';root=root_check(pathlib.Path(row['root']))
    for name,hashes in row['files'].items():assert digest((root/name).read_bytes())==hashes['afterSha256'],'CONFIG_CHANGED'
    connection,env,value,lines,index,grants=files(root);assert value['sourceId']==row['sourceId'];target=next(g for g in grants if g['sourceId']==row['sourceId'])
    assert not any(k in value for k in row['removed']['connection']) and not any(k in target for k in row['removed']['grant']),'NEW_KEYS_ALREADY_CHANGED'
    value.update(row['removed']['connection']);target.update(row['removed']['grant']);lines[index]='NativeSyncFullSources='+json.dumps(grants,separators=(',',':'),ensure_ascii=False)+'\n'
    atomic(connection,encoded(value));atomic(env,''.join(lines).encode());row['state']='restored';atomic(receipt,encoded(row));return row
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('operation',choices=['prepare','restore']);p.add_argument('--root',type=pathlib.Path);p.add_argument('--receipt',required=True,type=pathlib.Path);a=p.parse_args()
    result=prepare(a.root.resolve(),a.receipt.resolve()) if a.operation=='prepare' else restore(a.receipt.resolve());print(json.dumps({'state':result['state'],'root':result['root'],'sourceId':result['sourceId'],'databaseStateOrScopeRestored':False}))
