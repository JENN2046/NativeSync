"""Full local VCP bootstrap/browser recovery verification; no remote access."""
import argparse, datetime, hashlib, json, os, pathlib, secrets, shutil, subprocess, sys

REPO = pathlib.Path(__file__).resolve().parents[2]
DEV = pathlib.Path('/home/jenn/NativeSync-Dev')
RUNS = pathlib.Path('/var/tmp')/('nativesync-full-runtime-'+str(os.getuid()))/'runs'
NODE = '/home/jenn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'
def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p, value):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n')
def prepare(root, package):
    root.mkdir(mode=0o700, parents=True)
    write(root/'ISOLATED.json', {'kind':'nativesync-full-local-runtime','source':str(DEV)})
    manifests = json.loads((DEV/'matched-overlays.json').read_text())
    payload = json.loads((package/'MANIFEST.json').read_text())
    from importlib.machinery import SourceFileLoader
    SourceFileLoader('release_check',str(REPO/'tools/install_release.py')).load_module().verify(package)
    provenance = {'commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=REPO,text=True).strip(),'package':str(package),'repo':str(REPO),'previous':str(REPO/'.local/release-assembly/delivery-a'),'payloadManifestSha256':digest(package/'MANIFEST.json'),'hosts':{},'files':{}}
    excluded_roots = {'AppData','UserData','Agents','AgentGroups','Agent','dailynote','DebugLog','logs','Log','VectorStore','VCPAsyncResults','VCPAsyncTaskArchives','.git','node_modules','tests','state','data','image'}
    # Only Git-listed public code/resources and the known public matched layer.
    # Runtime/config exclusions happen before opening file contents.
    def public(name):
        p=pathlib.PurePosixPath(name);n=p.name.lower()
        return not any(x in excluded_roots for x in p.parts) and not n.endswith(('.env','.pem','.key','.sqlite','.db','.log','.p12')) and not n.startswith('.env') and n not in {'config.json','settings.json','connection.json','agent_map.json','toolapprovalconfig.json','multimodal-config.json'} and not any('secret' in x.lower() for x in p.parts)
    for host in ['VCPToolBox','VCPChat']:
        src=DEV/host;target=root/host
        names=set(subprocess.check_output(['git','ls-files','-z'],cwd=src).decode().split('\0'))
        names.update(n[len(host)+1:] for n in manifests['publicMatchedSnapshot'] if n.startswith(host+'/'))
        names.update(row['path'][len(host)+1:] for row in payload['files'] if row['path'].startswith(host+'/'))
        if host=='VCPToolBox': names.update(['modules/nativeConversationTransport.js','modules/pluginRuntimeEnvSandbox.js'])
        for name in sorted(names):
            if not name or not public(name): continue
            f=src/name
            if not f.exists() and name.endswith('/plugin-manifest.json'): f=f.with_name('plugin-manifest.json.block');name+='.block'
            if not f.is_file() or f.is_symlink(): continue
            dest=target/name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(f,dest)
            provenance['files'][host+'/'+name]=digest(dest)
        (target/'node_modules').symlink_to(DEV/'.dependencies'/host/'node_modules',target_is_directory=True)
        provenance['hosts'][host]=subprocess.check_output(['git','rev-parse','HEAD'],cwd=src,text=True).strip()
    # Install exactly the selected payload, not whichever overlay happens to exist.
    for row in payload['files']:
        dest=root/row['path'];dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(package/'payload'/row['path'],dest)
        provenance['files'][row['path']]=digest(dest)
    # Apply the narrow renderer fix from the selected package if needed.
    meta=package/'compat/host-patches/VCPChat-startup-diagnostics.json'
    if meta.exists():
        m=json.loads(meta.read_text());f=root/'VCPChat'/m['path']
        if digest(f)==m['beforeSha256']:subprocess.run(['git','apply',str(package/'compat/host-patches/VCPChat-startup-diagnostics.patch')],cwd=root/'VCPChat',check=True)
        assert digest(f)==m['afterSha256'],'Unrecognized desktop renderer'
        provenance['files']['VCPChat/'+m['path']]=digest(f)
    # Already-built public admin assets, no private config or runtime data.
    admin=DEV/'VCPToolBox/AdminPanel-Vue/dist'
    if admin.exists():shutil.copytree(admin,root/'VCPToolBox/AdminPanel-Vue/dist',dirs_exist_ok=True)
    for folder in ['logs','evidence','config/tls','data/chat','data/backend/agents','data/backend/knowledge','data/backend/store','data/backend/tvs','bin']:(root/folder).mkdir(parents=True,exist_ok=True)
    # New credentials AND new certificate for every isolated run.
    key=secrets.token_urlsafe(32)
    write(root/'config/local-credentials.json',{'serverKey':key,'adminUser':'local-dev','adminPassword':secrets.token_urlsafe(24)})
    os.chmod(root/'config/local-credentials.json',0o600)
    subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','7','-subj','/CN=NativeSync isolated local test','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1','-addext','basicConstraints=critical,CA:TRUE','-keyout',str(root/'config/tls/localhost-key.pem'),'-out',str(root/'config/tls/localhost-cert.pem')],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    os.chmod(root/'config/tls/localhost-key.pem',0o600)
    cases=['normal','offline','lost-response','reply-intent','reply-applied','effect','aa','startup']
    topics=[];selected=[];approved=[];now=int(datetime.datetime.now().timestamp()*1000)
    for case in cases:
        owner='ns-'+case;model='nativesync-'+case
        topics.append({'key':case,'ownerType':'agent','ownerId':owner,'topicId':'test-topic','agentAlias':'NSDEV','model':model})
        d={'itemId':owner,'itemType':'agent','topicId':'test-topic'};selected.append(d)
        h=root/'data/chat/UserData'/owner/'topics/test-topic/history.json';write(h,[]);approved.append({**d,'rawFileSha256':digest(h)})
        prompt='本地合成测试。'+('允许本轮指定测试工具。' if case in ['effect','aa'] else '[[VCPToolUse=Forbidden]]')
        write(root/'data/chat/Agents'/owner/'config.json',{'id':owner,'name':'NS '+case,'systemPrompt':prompt,'model':model,'maxOutputTokens':1024,'contextTokenLimit':32000,'temperature':0,'topics':[{'id':'test-topic','name':case,'createdAt':now}],'useThemeColorsInChat':True})
    write(root/'data/chat/settings.json',{'vcpServerUrl':'https://127.0.0.1:17653/v1/chat/completions','vcpApiKey':key,'userName':'本机合成测试','uiMode':'next','ChatDataServiceEnabled':False,'enableDistributedServer':False,'lastOpenAgentId':'ns-normal','lastOpenTopicId':'test-topic'})
    write(root/'data/chat/.native-sync/connection.json',{'version':1,'enabled':True,'historySelectionApproved':True,'deviceId':'isolated-'+secrets.token_hex(8),'scopeMode':'selected','topics':selected,'approvedHistory':approved,'serverUrl':'https://127.0.0.1:17653','credentialSource':'existing-vcp-settings','publishCatalog':True,'publishExecutionConfigs':True,'syncAttachments':False})
    credentials=json.loads((root/'config/local-credentials.json').read_text())
    values={'HOST':'127.0.0.1','PORT':'17650','ADMIN_PORT':'17651','API_URL':'http://127.0.0.1:17652','API_Key':key,'Key':key,'VCP_Key':key,'AdminUsername':credentials['adminUser'],'AdminPassword':credentials['adminPassword'],'DebugMode':'false','RAGMemoRefresh':'false','AGENT_DIR_PATH':str(root/'data/backend/agents'),'TVSTXT_DIR_PATH':str(root/'data/backend/tvs'),'KNOWLEDGEBASE_ROOT_PATH':str(root/'data/backend/knowledge'),'KNOWLEDGEBASE_STORE_PATH':str(root/'data/backend/store'),'KNOWLEDGEBASE_FULL_SCAN_ON_STARTUP':'false','WhitelistEmbeddingModel':'nativesync-local-embedding','NativeSyncEnabled':'true','NativeSyncDataDir':str(root/'data/native-sync'),'NativeMobileEnabled':'true','NativeMobileOrigin':'https://127.0.0.1:17653','NativeMobileTopics':json.dumps(topics,separators=(',',':')),'NativeMobileConfigSync':'true','NativeMobileAttachments':'false','NativeMobileBackendUrl':'https://127.0.0.1:17653','NativeMobileKeyExchangeEnabled':'true','NativeMobilePwaDir':str(root/'VCPToolBox/Plugin/NativeSync/mobile-dist')}
    (root/'VCPToolBox/config.env').write_text(''.join(k+'='+v+'\n' for k,v in values.items()));os.chmod(root/'VCPToolBox/config.env',0o600)
    write(root/'VCPToolBox/agent_map.json',{'NSDEV':'Development.txt'});(root/'data/backend/agents/Development.txt').write_text('本机隔离开发 Agent。')
    write(root/'VCPToolBox/toolApprovalConfig.json',{'enabled':False,'fuzzyToolMatching':False})
    write(root/'VCPToolBox/Plugin/AgentAssistant/config.json',{'delegationMaxRounds':2,'delegationTimeout':20000,'agents':[{'baseName':'ISOLATED_AA','chineseName':'IsolatedAA','modelId':'nativesync-aa-child','systemPrompt':'本机只读合成委托','maxOutputTokens':128}]})
    # Only a local fsync marker is allowed as the synthetic external effect.
    plugin=root/'VCPToolBox/Plugin/IsolatedEffect';plugin.mkdir(parents=True,exist_ok=True)
    write(plugin/'plugin-manifest.json',{'name':'IsolatedEffect','pluginType':'hybridservice','entryPoint':{'script':'effect.cjs'},'communication':{'protocol':'direct'},'configSchema':{}})
    (plugin/'effect.cjs').write_text("const fs=require('fs'),path=require('path');exports.processToolCall=async()=>{const r=path.resolve(__dirname,'../../..');if(!fs.existsSync(r+'/ISOLATED.json'))throw Error('ISOLATION_REQUIRED');const fd=fs.openSync(r+'/evidence/effect.txt','a',0o600);fs.writeSync(fd,'effect\\n');fs.fsyncSync(fd);fs.closeSync(fd);if(JSON.parse(fs.readFileSync(r+'/control.json')).fault==='external-effect')process.exit(78);return {status:'success',result:'isolated marker saved'};};")
    for name in ['dev.py','desktop-stop.cjs','desktop-ready.cjs','verify-desktop-diagnostics.cjs','full-support.cjs','full-preload.cjs','full-browser.cjs']:
        shutil.copyfile(REPO/'tools/dev-environment'/name,root/'bin'/name)
    write(root/'control.json',{})
    provenance['verificationFiles']={n:digest(root/'bin'/n) for n in ['dev.py','desktop-stop.cjs','full-browser.cjs','full-support.cjs','full-preload.cjs']}
    write(root/'PROVENANCE.json',provenance)
    return provenance

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--package',type=pathlib.Path,default=REPO/'.local/release-assembly/stable-local-delivery');p.add_argument('--cases',default='normal,offline,lost-response,startup,reply-intent,reply-applied,effect,aa,install');p.add_argument('--resume',type=pathlib.Path);p.add_argument('--prepare-only',action='store_true');a=p.parse_args()
    selected=a.cases.split(',');allowed={'normal','offline','lost-response','startup','reply-intent','reply-applied','effect','aa','install'}
    if not selected or len(set(selected))!=len(selected) or any(n not in allowed for n in selected):p.error('Unknown or repeated case')
    root=a.resume.resolve() if a.resume else RUNS/datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    assert root.is_relative_to(RUNS)
    if not a.resume:prepare(root,a.package.resolve())
    print(json.dumps({'root':str(root),'phase':'prepared','cases':a.cases}),flush=True)
    if a.prepare_only:return
    assert json.loads((root/'ISOLATED.json').read_text())['kind']=='nativesync-full-local-runtime'
    # The caller has authorized stopping this dedicated local instance only.
    subprocess.run([str(DEV/'stop')],check=True)
    try:
        env={k:v for k,v in os.environ.items() if k in ['HOME','PATH','USER','DISPLAY','WAYLAND_DISPLAY','XAUTHORITY','XDG_RUNTIME_DIR','DBUS_SESSION_BUS_ADDRESS','LANG']}
        env.update({'PATH':str(pathlib.Path(NODE).parent)+':/usr/bin:/bin','NODE_EXTRA_CA_CERTS':str(root/'config/tls/localhost-cert.pem')})
        result=subprocess.run([NODE,str(root/'bin/full-browser.cjs'),str(root),a.cases],cwd=root,env=env)
    finally:
        subprocess.run([sys.executable,str(root/'bin/dev.py'),'stop'],cwd=root)
        subprocess.run([str(DEV/'start')],cwd=DEV,check=True)
    raise SystemExit(result.returncode)
if __name__=='__main__':main()
