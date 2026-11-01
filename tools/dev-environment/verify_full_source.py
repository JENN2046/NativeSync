"""Fresh full-source host evidence: public code and synthetic data only."""
import argparse,datetime,json,pathlib,shutil,subprocess,os,hashlib
from verify_full_runtime import prepare,RUNS,DEV,REPO,NODE,write,digest

def source_fixture(root,package):
    prepare(root,package,attachments=True,phone=True)
    assert json.loads((root/'ISOLATED.json').read_text())['kind']=='nativesync-full-local-runtime'
    for folder in ['Agents','AgentGroups','UserData']:
        p=root/'data/chat'/folder
        if p.exists():shutil.rmtree(p)
        p.mkdir(parents=True)
    fixtures=root/'fixtures';fixtures.mkdir(exist_ok=True)
    subprocess.run([NODE,'-e',"require(process.argv[1])({create:{width:96,height:64,channels:3,background:{r:40,g:130,b:180}}}).png().toFile(process.argv[2])",str(root/'VCPToolBox/node_modules/sharp'),str(fixtures/'source.png')],check=True)
    (fixtures/'source.txt').write_text('ISOLATED_TEXT_ATTACHMENT\nSYNTHETIC_SOURCE_FILE\n')
    attachments=[]
    for name,kind in [('source.png','image/png'),('source.txt','text/plain')]:
        f=fixtures/name;h=digest(f);target=root/'data/chat/UserData/attachments'/(h+f.suffix);target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(f,target)
        data={'id':'attachment_'+h,'name':name,'type':kind,'size':f.stat().st_size,'hash':h,'blobHash':h,'internalPath':target.as_uri(),'internalFileName':target.name,'createdAt':None,'pdfMeta':None,'extractedText':f.read_text() if kind=='text/plain' else None}
        attachments.append({**{k:data[k] for k in ['id','name','type','size','hash','blobHash']},'_fileManagerData':data})
    owners=['ns-normal']+['ns-source-'+str(i).zfill(2) for i in range(1,10)];now=int(datetime.datetime.now().timestamp()*1000);descriptors=[]
    for index,owner in enumerate(owners):
        topics=[{'id':'test-topic' if index==0 and i==0 else 'topic-'+str(i).zfill(2),'name':'Source '+str(index)+' / '+str(i),'createdAt':now} for i in range(10)]
        write(root/'data/chat/Agents'/owner/'config.json',{'id':owner,'name':'Source Agent '+str(index),'topics':topics,'systemPrompt':'[[VCPToolUse=Forbidden]]\nSYNTHETIC_SOURCE_AGENT_'+str(index).zfill(2),'model':'nativesync-normal','temperature':index/20,'maxOutputTokens':128+index,'contextTokenLimit':32000,'streamOutput':False,'apiKey':'SYNTHETIC_DO_NOT_TRANSPORT'})
        for ti,topic in enumerate(topics):
            d={'itemType':'agent','itemId':owner,'topicId':topic['id']};descriptors.append(d)
            messages=[{'id':'source-'+str(index)+'-'+str(ti)+'-'+str(i),'role':'assistant' if i%2 else 'user','content':'SYNTHETIC_SOURCE_HISTORY_'+str(index)+'_'+str(ti)+'_'+str(i),'timestamp':now+i} for i in range(201 if index==ti==0 else 1)]
            if index==ti==0:messages[0]['attachments']=attachments
            write(root/'data/chat/UserData'/owner/'topics'/topic['id']/'history.json',messages)
    groups=[]
    for mode in ['sequential','invite_only','naturerandom']:
        owner='ns-source-group-'+mode;groups.append(owner);topics=[{'id':'topic-'+str(i).zfill(2),'name':mode+' / '+str(i),'createdAt':now} for i in range(10)]
        write(root/'data/chat/AgentGroups'/owner/'config.json',{'id':owner,'name':'Source '+mode,'members':owners[:2],'mode':mode,'modeSettings':{'sequential':{'speakerOrder':owners[:2]}},'groupPrompt':'SYNTHETIC_SOURCE_GROUP','useUnifiedModel':False,'topics':topics})
        for topic in topics:
            d={'itemType':'group','itemId':owner,'topicId':topic['id']};descriptors.append(d);write(root/'data/chat/UserData'/owner/'topics'/topic['id']/'history.json',[{'id':owner+'-'+topic['id'],'role':'user','content':'SYNTHETIC_SOURCE_GROUP_HISTORY','timestamp':now}])
    connection=json.loads((root/'data/chat/.native-sync/connection.json').read_text());connection['enabled']=False;connection['approvedHistory']=[{**descriptors[0],'rawFileSha256':digest(root/'data/chat/UserData/ns-normal/topics/test-topic/history.json')}];write(root/'data/chat/.native-sync/connection.json',connection)
    source_id='local-full-source';grant={'sourceId':source_id,'deviceId':connection['deviceId'],'executionMode':'all-supported','imageModels':['nativesync-normal']}
    env=root/'VCPToolBox/config.env';env.write_text(env.read_text()+'NativeMobileStartDelayMs=2000\nNativeSyncFullSources='+json.dumps([grant],separators=(',',':'))+'\n')
    settings=root/'data/chat/settings.json';v=json.loads(settings.read_text());v.update({'lastOpenItemId':'ns-normal','lastOpenItemType':'agent','lastOpenTopicId':'test-topic'});write(settings,v)
    manifest=root/'VCPToolBox/Plugin/IsolatedEffect/plugin-manifest.json';manifest.rename(manifest.with_name('plugin-manifest.json.block'))
    write(root/'SOURCE_PROFILE.json',{'kind':'synthetic-full-source','sourceId':source_id,'agents':owners,'groups':groups,'topics':descriptors,'initialMessages':330,'attachments':[{'name':a['name'],'sha256':a['hash']} for a in attachments]})
    for name in ['full-source.cjs','full-browser.cjs','full-support.cjs','full-desktop-preload.cjs']:shutil.copyfile(REPO/'tools/dev-environment'/name,root/'bin'/name)
    p=root/'PROVENANCE.json';v=json.loads(p.read_text());v['verificationProfile']='full-source-10-agents-3-groups-130-topics';v['verificationFiles'].update({n:digest(root/'bin'/n) for n in ['full-source.cjs','full-browser.cjs','full-support.cjs','full-desktop-preload.cjs']});write(p,v)

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--package',type=pathlib.Path,default=REPO/'.local/release-assembly/full-source-investigation');p.add_argument('--resume',type=pathlib.Path);p.add_argument('--prepare-only',action='store_true');p.add_argument('--start-case',choices=['enrollment','continuation','recovery','delivery'],default='enrollment');a=p.parse_args()
    root=a.resume.resolve() if a.resume else RUNS/datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    assert root.parent==RUNS
    if not a.resume:source_fixture(root,a.package.resolve())
    if a.resume and (root/'RESULT.json').exists():shutil.copyfile(root/'RESULT.json',root/('RESULT-before-'+a.start_case+'-'+datetime.datetime.now(datetime.timezone.utc).strftime('%H%M%S')+'.json'))
    if a.resume:
        shutil.copyfile(root/'PROVENANCE.json',root/('PROVENANCE-before-'+a.start_case+'-'+datetime.datetime.now(datetime.timezone.utc).strftime('%H%M%S')+'.json'))
        for name in ['full-source.cjs','full-browser.cjs']:shutil.copyfile(REPO/'tools/dev-environment'/name,root/'bin'/name)
    provenance=json.loads((root/'PROVENANCE.json').read_text());provenance['verificationFiles'].update({n:digest(root/'bin'/n) for n in ['full-source.cjs','full-browser.cjs']});write(root/'PROVENANCE.json',provenance)
    print(json.dumps({'root':str(root),'phase':'prepared'}),flush=True)
    if a.prepare_only:return
    subprocess.run([str(DEV/'stop')],check=True)
    try:
        env={k:v for k,v in os.environ.items() if k in ['HOME','PATH','USER','DISPLAY','WAYLAND_DISPLAY','XAUTHORITY','XDG_RUNTIME_DIR','DBUS_SESSION_BUS_ADDRESS','LANG']};env['PATH']=str(pathlib.Path(NODE).parent)+':/usr/bin:/bin';env['NODE_EXTRA_CA_CERTS']=str(root/'config/tls/localhost-cert.pem')
        result=subprocess.run([NODE,str(root/'bin/full-browser.cjs'),str(root),'source-full',a.start_case,str(a.package.resolve())],cwd=root,env=env)
    finally:
        subprocess.run(['/usr/bin/python3',str(root/'bin/dev.py'),'stop'],cwd=root);subprocess.run([str(DEV/'start')],check=True)
    raise SystemExit(result.returncode)
if __name__=='__main__':main()
