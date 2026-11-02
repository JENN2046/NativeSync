"""One local old/new/rollback/reinstall flow using public production code only."""
import argparse
import datetime
import hashlib
import importlib.util
import json
import os
import pathlib
import re
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import tarfile
import time
import urllib.request

REPO=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(REPO/'tools'))
import install_production as installer


def write(file,value):
    file.parent.mkdir(parents=True,exist_ok=True)
    file.write_text(json.dumps(value,indent=2)+'\n')
    file.chmod(0o600)


def free_port():
    with socket.socket() as probe:
        probe.bind(('127.0.0.1',0))
        return probe.getsockname()[1]


def synthetic_tool_configuration(host):
    # Public code requires these files even when no tools are invoked. Generate
    # empty, disabled test configuration instead of copying deployed settings.
    values={
        'jev_tool_call_exp.json':{'version':1,'virtualToolName':'JEV','maxExpandedCalls':0,'categories':{}},
        'jev_third_party_catalog.json':{'version':1,'categories':{},'forbiddenParameterNames':[],'denyPlugins':[],'limits':{}},
        'dynamic_tool_bridge.config.json':{'version':1,'enabled':False,'useRagEmbeddings':False,'manualOverrides':{},'smallModel':{'enabled':False}},
        'dynamic_tool_catalog.json':{'version':1,'updatedAt':'synthetic','snapshotId':0,'plugins':{}},
        'dynamic_tool_categories.json':{'version':1,'updatedAt':'synthetic','items':{}},
    }
    for name,value in values.items():
        file=host/'ToolConfigs'/name
        if not file.exists():
            write(file,value)
    file=host/'TVStxt/JevToolCallDecision.txt'
    if not file.exists():
        file.parent.mkdir(parents=True,exist_ok=True)
        file.write_text('## THIRD_PARTY_PROTOCOL\nSYNTHETIC_TOOLS_DISABLED\n')


def prepare(archive,run,dependencies,puppeteer):
    run.mkdir(mode=0o700,parents=True)
    with tarfile.open(archive,'r:gz') as tar:
        for member in tar:
            rel=pathlib.PurePosixPath(member.name)
            installer.fail(member.isfile() and not rel.is_absolute() and '..' not in rel.parts,'UNSAFE_PUBLIC_ARCHIVE')
            destination=run/str(rel)
            destination.parent.mkdir(parents=True,exist_ok=True)
            destination.write_bytes(tar.extractfile(member).read())
            destination.chmod(member.mode&0o777)
    manifest=json.loads((run/'PUBLIC_SOURCE_MANIFEST.json').read_text())
    installer.fail(manifest['configurationOrDatabasesIncluded'] is False,'PUBLIC_CODE_ONLY_REQUIRED')
    for name,digest in manifest['files'].items():
        installer.fail(installer.digest(run/name)==digest,'PUBLIC_SOURCE_HASH_MISMATCH')
    host=run/'host'
    (host/'node_modules').symlink_to(dependencies.resolve(),target_is_directory=True)
    for p in (host/'Plugin').glob('*/plugin-manifest.json'):
        if p.parent.name not in ['NativeSync','AgentAssistant']:
            p.rename(p.with_name(p.name+'.block'))
    for name in ['logs','evidence','tls','data','home','agents','knowledge','store','tvs']:
        (run/name).mkdir(exist_ok=True)
    # All credentials, agent configuration, scopes and history are newly synthetic.
    key=secrets.token_urlsafe(32)
    ports=set()
    while len(ports)<3:
        ports.add(free_port())
    backend,provider,proxy=sorted(ports)
    source={'sourceId':'synthetic-prod-source','deviceId':'synthetic-legacy-device','scope':{'mode':'limited','topics':[{'ownerType':'agent','ownerId':'synthetic-owner','topicId':t} for t in ['legacy-a','legacy-b']]}}
    topic={'key':'synthetic-mobile','ownerType':'agent','ownerId':'synthetic-owner','topicId':'legacy-a','agentAlias':'SyntheticLegacy','model':'nativesync-prod-stub'}
    native={'NativeSyncEnabled':'true','NativeMobileEnabled':'true','NativeSyncDataDir':str(run/'data'),'NativeMobileOrigin':'https://127.0.0.1:'+str(proxy),'NativeMobileBackendUrl':'https://127.0.0.1:'+str(proxy),'NativeMobilePwaDir':str(host/'apps/mobile/dist'),'NativeMobileConfigSync':'true','NativeMobileAttachments':'false','NativeMobileKeyExchangeEnabled':'false','NativeSyncFullSources':json.dumps([source],separators=(',',':')),'NativeMobileTopics':json.dumps([topic],separators=(',',':'))}
    file=host/'Plugin/NativeSync/config.env';file.write_text(''.join(k+'='+v+'\n' for k,v in native.items()));file.chmod(0o600)
    config={'HOST':'127.0.0.1','PORT':str(backend),'API_URL':'http://127.0.0.1:'+str(provider),'API_Key':key,'Key':key,'VCP_Key':key,'AdminUsername':'synthetic-local','AdminPassword':secrets.token_urlsafe(24),'DebugMode':'false','RAGMemoRefresh':'false','AGENT_DIR_PATH':str(run/'agents'),'TVSTXT_DIR_PATH':str(run/'tvs'),'KNOWLEDGEBASE_ROOT_PATH':str(run/'knowledge'),'KNOWLEDGEBASE_STORE_PATH':str(run/'store'),'KNOWLEDGEBASE_FULL_SCAN_ON_STARTUP':'false','WhitelistEmbeddingModel':'synthetic-no-embedding','TDB_KNOWLEDGE_ENABLED':'false'}
    (host/'config.env').write_text(''.join(k+'='+v+'\n' for k,v in config.items()));(host/'config.env').chmod(0o600)
    write(host/'agent_map.json',{'SyntheticLegacy':'synthetic.txt'})
    (run/'agents/synthetic.txt').write_text('[[VCPToolUse=Forbidden]]\nSYNTHETIC_NATIVE_ALIAS_CONTEXT')
    write(host/'toolApprovalConfig.json',{'enabled':False,'fuzzyToolMatching':False})
    write(host/'Plugin/AgentAssistant/config.json',{'agents':[]})
    synthetic_tool_configuration(host)
    subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','2','-subj','/CN=NativeSync Local Production Fixture','-addext','subjectAltName=IP:127.0.0.1','-addext','basicConstraints=critical,CA:TRUE','-keyout',str(run/'tls/key.pem'),'-out',str(run/'tls/cert.pem')],check=True,capture_output=True)
    (run/'tls/key.pem').chmod(0o600)
    pub=subprocess.run(['openssl','x509','-in',str(run/'tls/cert.pem'),'-pubkey','-noout'],capture_output=True,check=True).stdout
    der=subprocess.run(['openssl','pkey','-pubin','-outform','DER'],input=pub,capture_output=True,check=True).stdout
    import base64
    private={'key':key,'backendPort':backend,'providerPort':provider,'proxyPort':proxy,'source':source,'puppeteer':str(puppeteer.resolve()),'spki':base64.b64encode(hashlib.sha256(der).digest()).decode()}
    write(run/'private.json',private)
    write(run/'ISOLATED.json',{'kind':'nativesync-production-public-fixture','node':str(run/'bin/node'),'configProjectionSha256':installer.canonical_hash(installer.config_projection(host))})
    return private


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--public-host-archive',type=pathlib.Path,required=True)
    parser.add_argument('--package',type=pathlib.Path,required=True)
    parser.add_argument('--dependencies',type=pathlib.Path,required=True)
    parser.add_argument('--puppeteer',type=pathlib.Path,required=True)
    parser.add_argument('--run',type=pathlib.Path)
    parser.add_argument('--prepare-only',action='store_true')
    parser.add_argument('--resume',action='store_true',help='Continue a failed local fixture without resetting data.')
    args=parser.parse_args()
    run=args.run or installer.FIXTURES/datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    installer.fail(run.absolute().parent==installer.FIXTURES,'LOCAL_TEST_ROOT_REQUIRED')
    if not args.resume:
        installer.fail(not run.exists(),'NEW_LOCAL_FIXTURE_REQUIRED')
        cfg=prepare(args.public_host_archive,run,args.dependencies,args.puppeteer)
    else:
        cfg=json.loads((run/'private.json').read_text())
    target=installer.Target(run)
    plan=REPO/'provenance/production-deployment-preflight-20261102.json'
    installer.protect_host(installer.load_plan(plan),target)
    if args.prepare_only:
        print(json.dumps({'prepared':str(run)}))
        return
    node=str(target.node)
    env={'PATH':str(run/'bin')+':/usr/bin:/bin','HOME':str(run/'home'),'LANG':'C.UTF-8','CHOKIDAR_USEPOLLING':'true','CHOKIDAR_INTERVAL':'1000','NODE_EXTRA_CA_CERTS':str(run/'tls/cert.pem')}
    support=None;backend=None
    def start_support():
        with (run/'logs/support.log').open('ab') as log:
            return subprocess.Popen([node,str(REPO/'tests/fixtures/productionSupport.cjs'),str(run)],cwd=run,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
    def start(stage):
        nonlocal backend
        with (run/'logs'/('backend-'+stage+'.log')).open('ab') as log:
            backend=subprocess.Popen([node,'server.js'],cwd=target.root,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
        deadline=time.monotonic()+45
        while time.monotonic()<deadline:
            installer.fail(backend.poll() is None,'BACKEND_EXITED '+stage)
            try:
                request=urllib.request.Request('http://127.0.0.1:'+str(cfg['backendPort'])+'/v1/models',headers={'Authorization':'Bearer '+cfg['key']})
                with urllib.request.urlopen(request,timeout=1) as response:
                    if response.status==200:return
            except OSError:
                pass
            time.sleep(.2)
        raise ValueError('BACKEND_NOT_READY '+stage)
    def stop():
        nonlocal backend
        if backend and backend.poll() is None:
            installer.fail(pathlib.Path(os.readlink('/proc/'+str(backend.pid)+'/cwd'))==target.root,'OWNED_BACKEND_REQUIRED')
            os.killpg(backend.pid,signal.SIGTERM)
            backend.wait(timeout=40)
            installer.fail(backend.returncode==0,'BACKEND_UNCLEAN_EXIT')
        backend=None
    def flow(stage):
        with (run/'logs'/('flow-'+stage+'.log')).open('w') as output:
            r=subprocess.run([node,str(REPO/'tests/fixtures/productionFlow.cjs'),str(run),stage],cwd=run,env=env,stdout=output,stderr=subprocess.STDOUT,timeout=90)
        installer.fail(r.returncode==0,'FLOW_FAILED '+stage)
        print(json.dumps({'stage':stage,'result':'PASS'}),flush=True)
    try:
        support=start_support()
        progress_file=run/'validation-progress.json'
        completed=json.loads(progress_file.read_text()) if progress_file.exists() else []
        for stage in ['old','new','rollback','reinstalled']:
            if stage in completed:
                continue
            if stage=='new':
                receipt=target.backups/'installed/INSTALL.json'
                if not receipt.exists():
                    installer.install(args.package,plan,target,target.backups/'installed')
                else:
                    installer.fail(json.loads(receipt.read_text())['state']=='installed','INTERRUPTED_TEST_INSTALL_REQUIRES_RECOVERY')
            elif stage=='rollback':
                if json.loads((target.backups/'installed/INSTALL.json').read_text())['state']!='rolled-back':
                    installer.rollback(plan,target,target.backups/'installed',args.package)
            elif stage=='reinstalled':
                receipt=target.backups/'reinstalled/INSTALL.json'
                if not receipt.exists():
                    installer.install(args.package,plan,target,target.backups/'reinstalled')
                else:
                    installer.fail(json.loads(receipt.read_text())['state']=='installed','INTERRUPTED_TEST_INSTALL_REQUIRES_RECOVERY')
            start(stage);flow(stage);stop()
            completed.append(stage);write(progress_file,completed)
        result={'result':'PASS','publicArchiveSha256':installer.digest(args.public_host_archive),'candidateManifestSha256':installer.MANIFEST_SHA,'toolSha256':installer.digest(REPO/'tools/install_production.py'),'nodeBinarySha256':installer.digest(run/'bin/node'),'flows':{stage:json.loads((run/'evidence'/('flow-'+stage+'.json')).read_text()) for stage in ['old','new','rollback','reinstalled']},'productionWrites':False,'privateDataCopied':False,'scope':'Actual public production host + original Node, local installed dependencies, fresh synthetic database/configuration, real Chrome and loopback provider; no production or Android acceptance'}
        write(run/'RESULT.json',result)
        print(json.dumps({'result':'PASS','run':str(run)}))
    finally:
        stop()
        if support and support.poll() is None:
            os.killpg(support.pid,signal.SIGTERM);support.wait(timeout=10)


if __name__=='__main__':
    main()
