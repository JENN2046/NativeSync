import pathlib,json,subprocess,os,time,secrets,signal,socket,urllib.request,sqlite3,hashlib,sys,shutil
ROOT=pathlib.Path(sys.argv[1]).resolve();PACKAGE=pathlib.Path(sys.argv[2]).resolve();HOSTS=ROOT/'hosts';NODE='/home/jenn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node';OLD=pathlib.Path('/home/jenn/NativeSync-Dev')
assert json.loads((ROOT/'ISOLATED.json').read_text())['kind']=='nativesync-independent-cold-start'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,v):
 p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,indent=2,ensure_ascii=False)+'\n');p.chmod(0o600)
def command(args,env=None,log=None,cwd=None,timeout=80):
 with (ROOT/'logs'/log).open('w') if log else open(os.devnull,'w') as out:
  p=subprocess.run([str(x) for x in args],cwd=cwd,env=env,stdout=out,stderr=subprocess.STDOUT,timeout=timeout)
 assert p.returncode==0,'COLD_COMMAND_FAILED '+str(log)
def http(route,body=None,source=False):
 headers={'Authorization':'Bearer '+credentials['key'],'Content-Type':'application/json','X-NativeSync-Protocol':'2','X-NativeSync-Capabilities':'message-intents-v1,attachments-v1'}
 if source:headers.update({'X-NativeSync-Source':binding['sourceId'],'X-NativeSync-Device':binding['deviceId'],'X-NativeSync-Space':binding['spaceId']})
 req=urllib.request.Request('http://127.0.0.1:17650'+route,headers=headers,data=json.dumps(body).encode() if body is not None else None)
 with urllib.request.urlopen(req,timeout=3) as r:return json.load(r)
def dbfacts():
 db=sqlite3.connect('file:'+str(ROOT/'data/native-sync/central.sqlite')+'?mode=ro',uri=True)
 try:return {'messages':db.execute('SELECT count(*) FROM messages').fetchone()[0],'journal':db.execute('SELECT count(*) FROM journal').fetchone()[0],'appliedOps':db.execute('SELECT count(*) FROM applied_ops').fetchone()[0],'jsonTriggers':[r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'nativesync_json_%' ORDER BY name")],'messageIndex':db.execute("SELECT count(*) FROM sqlite_master WHERE type='index' AND name='idx_journal_message'").fetchone()[0]}
 finally:db.close()
# Only declared code layer changes in a never-started reconstruction.
manifest=json.loads((PACKAGE/'MANIFEST.json').read_text());baseline=json.loads((ROOT/'seal/candidate/MANIFEST.json').read_text());old_hashes={r['path']:r['sha256'] for r in baseline['files']}
for row in manifest['files']:
 target=HOSTS/row['path'];assert sha(target) in [row['sha256'],old_hashes.get(row['path'])],'UNKNOWN_COLD_CODE_DRIFT';assert sha(PACKAGE/'payload'/row['path'])==row['sha256'];shutil.copyfile(PACKAGE/'payload'/row['path'],target)
for row in json.loads((PACKAGE/'compat/dev-hosts/linux-full.json').read_text())['files']:assert sha(HOSTS/row['path'])==row['sha256']
for host in ['VCPToolBox','VCPChat']:
 deps=HOSTS/host/'node_modules';assert deps.is_dir() and not deps.is_symlink()
 for path in deps.rglob('*'):
  if path.is_symlink():assert not path.resolve().is_relative_to(OLD),'OLD_DEPENDENCY_SYMLINK'
assert not (ROOT/'data/native-sync/central.sqlite').exists() and not (ROOT/'data/chat/.native-sync/state.json').exists(),'COLD_DATA_ALREADY_EXISTS'
for name in ['data/chat','data/backend/agents','data/backend/knowledge','data/backend/store','data/backend/tvs','data/native-sync']:(ROOT/name).mkdir(parents=True,exist_ok=True)
credentials={'key':secrets.token_urlsafe(32),'adminPassword':secrets.token_urlsafe(24)};write(ROOT/'config/credentials.json',credentials)
binding={'sourceId':'cold-source-'+secrets.token_hex(4),'deviceId':'cold-device-'+secrets.token_hex(8),'ownerId':'cold-agent','topicId':'cold-topic','messageId':'cold-message-'+secrets.token_hex(8)}
now=int(time.time()*1000);write(ROOT/'data/chat/Agents/cold-agent/config.json',{'id':'cold-agent','name':'NativeSync 独立冷启动','systemPrompt':'[[VCPToolUse=Forbidden]]\n本机合成冷启动。','model':'nativesync-cold','temperature':0,'maxOutputTokens':128,'contextTokenLimit':32000,'topics':[{'id':'cold-topic','name':'Cold topic','createdAt':now}]});write(ROOT/'data/chat/UserData/cold-agent/topics/cold-topic/history.json',[])
write(ROOT/'data/chat/settings.json',{'vcpServerUrl':'https://127.0.0.1:17653/v1/chat/completions','vcpApiKey':credentials['key'],'userName':'独立冷启动','uiMode':'next','ChatDataServiceEnabled':False,'enableDistributedServer':False,'lastOpenAgentId':'cold-agent','lastOpenItemId':'cold-agent','lastOpenItemType':'agent','lastOpenTopicId':'cold-topic'})
box=HOSTS/'VCPToolBox'
for p in (box/'Plugin').glob('*/plugin-manifest.json'):
 if p.parent.name not in ['NativeSync','AgentAssistant']:p.rename(p.with_name('plugin-manifest.json.block'))
write(box/'agent_map.json',{});write(box/'toolApprovalConfig.json',{'enabled':False,'fuzzyToolMatching':False});write(box/'Plugin/AgentAssistant/config.json',{'delegationMaxRounds':2,'delegationTimeout':20000,'agents':[]})
values={'HOST':'127.0.0.1','PORT':'17650','ADMIN_PORT':'17651','API_URL':'http://127.0.0.1:17652','API_Key':credentials['key'],'Key':credentials['key'],'VCP_Key':credentials['key'],'AdminUsername':'cold-local','AdminPassword':credentials['adminPassword'],'DebugMode':'false','RAGMemoRefresh':'false','AGENT_DIR_PATH':str(ROOT/'data/backend/agents'),'TVSTXT_DIR_PATH':str(ROOT/'data/backend/tvs'),'KNOWLEDGEBASE_ROOT_PATH':str(ROOT/'data/backend/knowledge'),'KNOWLEDGEBASE_STORE_PATH':str(ROOT/'data/backend/store'),'KNOWLEDGEBASE_FULL_SCAN_ON_STARTUP':'false','WhitelistEmbeddingModel':'nativesync-local-embedding','NativeSyncEnabled':'true','NativeSyncDataDir':str(ROOT/'data/native-sync'),'NativeMobileEnabled':'true','NativeMobileConfigSync':'true','NativeMobileAttachments':'false','NativeMobileOrigin':'https://127.0.0.1:17653','NativeMobileTopics':'[]','NativeMobileBackendUrl':'https://127.0.0.1:17653','NativeMobileKeyExchangeEnabled':'false','NativeMobilePwaDir':str(box/'Plugin/NativeSync/mobile-dist'),'NativeSyncFullSources':json.dumps([{'sourceId':binding['sourceId'],'deviceId':binding['deviceId'],'executionMode':'all-supported','imageModels':[]}],separators=(',',':'))}
(box/'config.env').write_text(''.join(k+'='+v+'\n' for k,v in values.items()));(box/'config.env').chmod(0o600)
command(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','2','-subj','/CN=NativeSync Independent Cold','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1','-addext','basicConstraints=critical,CA:TRUE','-keyout',ROOT/'config/cold-key.pem','-out',ROOT/'config/cold-cert.pem']);(ROOT/'config/cold-key.pem').chmod(0o600)
env={k:v for k,v in os.environ.items() if k in ['DISPLAY','WAYLAND_DISPLAY','XAUTHORITY','XDG_RUNTIME_DIR','DBUS_SESSION_BUS_ADDRESS','USER','LOGNAME']};env.update({'PATH':str(pathlib.Path(NODE).parent)+':/usr/bin:/bin','HOME':str(ROOT/'home'),'LANG':'C.UTF-8','XDG_CONFIG_HOME':str(ROOT/'data/xdg-config'),'XDG_STATE_HOME':str(ROOT/'data/xdg-state'),'XDG_CACHE_HOME':str(ROOT/'cache'),'NODE_EXTRA_CA_CERTS':str(ROOT/'config/cold-cert.pem'),'NODE_OPTIONS':'--require='+str(ROOT/'bin/module-audit.cjs'),'VCPCHAT_APP_DATA_DIR':str(ROOT/'data/chat'),'VCPCHAT_STATE_DIR':str(ROOT/'data/launcher'),'CHOKIDAR_USEPOLLING':'true','CHOKIDAR_INTERVAL':'1000'})
assert all(str(OLD) not in v for v in env.values());write(ROOT/'evidence/child-path-environment.json',{k:v for k,v in env.items() if k not in ['DBUS_SESSION_BUS_ADDRESS']})
children={};registry={};daily_stopped=False;clean=False

def spawn(name,args,cwd):
 fd=(ROOT/'logs'/('cold-'+name+'.log')).open('w');(ROOT/'logs'/('cold-'+name+'.log')).chmod(0o600)
 p=subprocess.Popen([str(x) for x in args],cwd=cwd,env=env,stdout=fd,stderr=subprocess.STDOUT,start_new_session=True);fd.close();children[name]=p
 registry[name]={'pid':p.pid,'cwd':str(cwd),'startTicks':pathlib.Path('/proc',str(p.pid),'stat').read_text().rsplit(')',1)[1].split()[19]};write(ROOT/'evidence/processes.json',registry)
 return p
try:
 command([OLD/'stop'],log='daily-stop.log');daily_stopped=True
 for port in [17650,17651,17652,17653,17654,17655]:
  deadline=time.monotonic()+15
  while True:
   try:
    with socket.socket() as probe:
     probe.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);probe.bind(('127.0.0.1',port))
    break
   except OSError:
    if time.monotonic()>=deadline:raise AssertionError('COLD_PORT_STILL_LISTENING '+str(port))
    time.sleep(.2)
 spawn('provider',[NODE,ROOT/'bin/provider.cjs'],ROOT);spawn('backend',[NODE,'server.js'],box);spawn('proxy',[NODE,ROOT/'bin/proxy.cjs'],ROOT)
 deadline=time.monotonic()+65
 while time.monotonic()<deadline:
  assert children['backend'].poll() is None,'COLD_BACKEND_EXITED'
  try:
   info=http('/api/v1/sync/source/info?sourceId='+binding['sourceId']+'&deviceId='+binding['deviceId']);break
  except OSError:time.sleep(.2)
 else:raise AssertionError('COLD_BACKEND_NOT_READY')
 initial=dbfacts();assert initial['messages']==initial['journal']==initial['appliedOps']==0 and len(initial['jsonTriggers'])==6 and initial['messageIndex']==1;write(ROOT/'evidence/fresh-schema.json',initial)
 binding['spaceId']=info['spaceId'];write(ROOT/'config/binding.json',binding)
 write(ROOT/'data/chat/.native-sync/connection.json',{'version':1,'enabled':True,'fullSelectionApproved':True,'scopeMode':'source','sourceId':binding['sourceId'],'spaceId':binding['spaceId'],'deviceId':binding['deviceId'],'sourceRoot':str(ROOT/'data/chat'),'sourceScope':{'mode':'full'},'executionMode':'all-supported','executionTopics':[],'topics':[],'publishCatalog':True,'publishExecutionConfigs':True,'syncAttachments':False,'serverUrl':'https://127.0.0.1:17653','credentialSource':'existing-vcp-settings'})
 spawn('desktop',[NODE,'scripts/vcpchat-dev-launcher.mjs','--project-root',HOSTS/'VCPChat','--shallow-doctor','--ready-timeout-ms','60000','--','--remote-debugging-port=17654'],HOSTS/'VCPChat')
 command([NODE,ROOT/'bin/desktop.cjs'],env=env,log='desktop-driver.log',cwd=ROOT,timeout=90)
 desktop=json.loads((ROOT/'evidence/desktop-roundtrip.json').read_text());page=http('/api/v1/sync/source/pull?after_seq=0&limit=100',source=True);assert len(page['events'])==1 and page['events'][0]['msgId']==binding['messageId'] and page['events'][0]['hash']==desktop['desktopMessageHash']
 final=dbfacts();assert final['messages']==final['journal']==final['appliedOps']==1
 health=json.load(urllib.request.urlopen('http://127.0.0.1:17652/health'));assert health['chats']==0
 loaded=[json.loads(line) for p in (ROOT/'evidence').glob('module-paths-*.jsonl') for line in p.read_text().splitlines()];assert loaded and all(not row['path'].startswith(str(OLD)+'/') for row in loaded);modules=[row['path'] for row in loaded if not row['entry'].startswith(('/usr/bin/npm','/usr/share/nodejs/npm/'))];assert all(pathlib.Path(p).is_relative_to(ROOT) for p in modules),'NON_COLD_APPLICATION_MODULE'
 assert any(p.endswith('Plugin/NativeSync/sync/centralStore.js') for p in modules)
 result={'result':'PASS','manifestSha256':sha(PACKAGE/'MANIFEST.json'),'initialSchema':initial,'finalSchema':final,'desktop':desktop,'pull':{'status':200,'seq':page['events'][0]['seq'],'hash':page['events'][0]['hash']},'provider':health,'independentlyResolvedModulePaths':len(set(modules)),'noOldDevRuntimeBorrow':True,'freshCredentialsAndConfiguration':True,'realBackendAndElectronStarted':True,'modelCalls':0}
 write(ROOT/'evidence/ROUNDTRIP.json',result);print(json.dumps({'roundtrip':'PASS','messages':1,'triggers':6,'modulePaths':len(set(modules))}),flush=True)
finally:
 if 'desktop' in children and children['desktop'].poll() is None:
  command([NODE,ROOT/'bin/desktop.cjs','stop'],env=env,log='desktop-stop.log',cwd=ROOT,timeout=35)
  try:children['desktop'].wait(timeout=20)
  except subprocess.TimeoutExpired:raise AssertionError('COLD_DESKTOP_STILL_DRAINING; no forced quit')
 for name in ['proxy','backend','provider']:
  p=children.get(name)
  if p and p.poll() is None:
   proc=pathlib.Path('/proc',str(p.pid));assert pathlib.Path(os.readlink(proc/'cwd')).is_relative_to(ROOT);assert proc.joinpath('stat').read_text().rsplit(')',1)[1].split()[19]==registry[name]['startTicks'];os.killpg(p.pid,signal.SIGTERM)
   p.wait(timeout=25)
 clean=all(p.poll() is not None for p in children.values())
 if daily_stopped and clean:command([OLD/'start'],log='daily-restored.log',timeout=85)
 write(ROOT/'evidence/LIFECYCLE.json',{'coldProcessesStopped':clean,'dailyRestored':daily_stopped and clean})
 if 'result' in locals():result['normalExitAndDailyRestore']=clean;write(ROOT/'evidence/RESULT.json',result)
