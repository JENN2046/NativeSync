"""Prepare/manage a fresh, mobile-only LAN acceptance copy. No remote server access."""
import argparse,datetime,hashlib,html,ipaddress,json,os,pathlib,secrets,shutil,signal,socket,subprocess,sys,time,urllib.request
from verify_full_runtime import prepare,RUNS,DEV,REPO,NODE,write,digest
PYTHON='/home/jenn/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3'
def run(args,**kwargs):return subprocess.run(args,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,**kwargs)
def network(address):
    ip=ipaddress.ip_address(address)
    assert any(ip in ipaddress.ip_network(n) for n in ['10.0.0.0/8','172.16.0.0/12','192.168.0.0/16']),'PRIVATE_LAN_IPV4_REQUIRED'
    rows=json.loads(subprocess.check_output(['ip','-j','-4','address','show'],text=True))
    for row in rows:
        for info in row.get('addr_info',[]):
            if info.get('local')==address and row['operstate']=='UP':return row['ifname'],info['prefixlen']
    raise ValueError('LAN_ADDRESS_NOT_ACTIVE')
def owned(root):
    assert not root.is_symlink();root=root.resolve();assert root.parent==RUNS,'OWNED_RUN_REQUIRED'
    assert json.loads((root/'ISOLATED.json').read_text())['kind']=='nativesync-full-local-runtime'
    cfg=json.loads((root/'PHONE.json').read_text());assert cfg['kind']=='nativesync-android-local-test';return root,cfg
def prepare_phone(address,package):
    interface,prefix=network(address);root=RUNS/datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    prepare(root,package,attachments=True,groups=True,phone=True)
    settings=root/'data/chat/settings.json';value=json.loads(settings.read_text());value.update({'lastOpenItemId':'ns-normal','lastOpenItemType':'agent'});write(settings,value)
    fixtures=root/'fixtures';fixtures.mkdir(exist_ok=True);(fixtures/'phone-test.txt').write_text('NATIVESYNC_ANDROID_SYNTHETIC_FILE\n手机上传测试用合成文件。\n')
    run([NODE,'-e',"require(process.argv[1])({create:{width:96,height:64,channels:3,background:{r:20,g:135,b:200}}}).png().toFile(process.argv[2])",str(root/'VCPToolBox/node_modules/sharp'),str(fixtures/'phone-test.png')])
    provision_gateway(root,address)
def provision_gateway(root,address):
    interface,prefix=network(address)
    folder=root/'config/phone';folder.mkdir(mode=0o700)
    # The signing key is discarded immediately; only this test leaf is issued.
    run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','2','-subj','/CN=NativeSync Android Local Test','-addext','basicConstraints=critical,CA:TRUE,pathlen:0','-addext','keyUsage=critical,keyCertSign,cRLSign','-keyout',str(folder/'ca-key.pem'),'-out',str(folder/'ca.pem')])
    run(['openssl','req','-new','-newkey','rsa:2048','-nodes','-subj','/CN=NativeSync Android Local Test Server','-keyout',str(folder/'server-key.pem'),'-out',str(folder/'server.csr')])
    (folder/'server.ext').write_text('basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:'+address+',IP:127.0.0.1\n')
    try:run(['openssl','x509','-req','-in',str(folder/'server.csr'),'-CA',str(folder/'ca.pem'),'-CAkey',str(folder/'ca-key.pem'),'-CAcreateserial','-days','2','-extfile',str(folder/'server.ext'),'-out',str(folder/'server-cert.pem')])
    finally:(folder/'ca-key.pem').unlink()
    os.chmod(folder/'server-key.pem',0o600);run(['openssl','x509','-in',str(folder/'ca.pem'),'-outform','DER','-out',str(folder/'ca.crt')])
    fingerprint=digest(folder/'ca.crt');origin='https://'+address+':17663'
    cfg={'kind':'nativesync-android-local-test','address':address,'interface':interface,'prefix':prefix,'origin':origin,'certificateUrl':'http://'+address+':17664/','caFingerprint':fingerprint,'expiresAt':int(time.time()*1000)+4*3600*1000,'rootSigningKeyDeleted':True,'realDeviceAcceptance':'pending'};write(root/'PHONE.json',cfg)
    env=root/'VCPToolBox/config.env';lines=env.read_text().splitlines();replace={'NativeMobileOrigin':origin,'NativeMobileBackendUrl':origin,'NativeMobileKeyExchangeEnabled':'false'};env.write_text('\n'.join(k+'='+replace[k] if (k:=line.split('=',1)[0]) in replace else line for line in lines)+'\n')
    effect=root/'VCPToolBox/Plugin/IsolatedEffect/plugin-manifest.json'
    if effect.exists():effect.rename(effect.with_name('plugin-manifest.json.block'))
    for name in ['phone-run.cjs','phone-gateway.cjs']:shutil.copyfile(REPO/'tools/dev-environment'/name,root/'bin'/name)
    provenance=json.loads((root/'PROVENANCE.json').read_text());provenance['verificationProfile']='full-source-android' if (root/'SOURCE_PROFILE.json').exists() else 'phone-four-synthetic-topics';provenance['phoneProfile']={'topics':len(json.loads((root/'SOURCE_PROFILE.json').read_text())['topics']) if (root/'SOURCE_PROFILE.json').exists() else 4,'keyExchange':False,'certificateSha256':fingerprint,'origin':origin};provenance['verificationFiles'].update({n:digest(root/'bin'/n) for n in ['phone-run.cjs','phone-gateway.cjs']});write(root/'PROVENANCE.json',provenance)
    print(json.dumps({'root':str(root),'phase':'prepared','origin':origin,'certificateUrl':cfg['certificateUrl'],'caSha256':fingerprint,'lanListenerStarted':False}))
def attach_source(root,address):
    from install_local import root_check
    root=root_check(root);assert root.parent==RUNS and json.loads((root/'ISOLATED.json').read_text())['kind']=='nativesync-full-local-runtime'
    assert json.loads((root/'SOURCE_PROFILE.json').read_text())['kind']=='synthetic-full-source','SYNTHETIC_SOURCE_REQUIRED'
    connection=json.loads((root/'data/chat/.native-sync/connection.json').read_text());assert connection['scopeMode']=='source' and connection['executionMode']=='all-supported'
    assert not (root/'PHONE.json').exists(),'PHONE_ALREADY_ATTACHED'
    for old,new in [('source.png','phone-test.png'),('source.txt','phone-test.txt')]:shutil.copyfile(root/'fixtures'/old,root/'fixtures'/new)
    provision_gateway(root,address)
def manager(root):
    p=json.loads((root/'PHONE_MANAGER.json').read_text())['pid'];proc=pathlib.Path('/proc')/str(p)
    try:
        if proc.joinpath('stat').read_text().rsplit(')',1)[1].split()[0]=='Z':return None
        assert proc.joinpath('cwd').resolve()==root/'bin' and str(root/'bin/phone-run.cjs').encode() in proc.joinpath('cmdline').read_bytes(),'MANAGER_IDENTITY_MISMATCH'
        return p
    except FileNotFoundError:return None
def start(root,cfg):
    network(cfg['address']);assert cfg['expiresAt']>time.time()*1000,'PHONE_WINDOW_EXPIRED'
    if (root/'PHONE_MANAGER.json').exists() and manager(root):raise ValueError('PHONE_TEST_ALREADY_RUNNING')
    for port in [17663,17664]:
        with socket.socket() as probe:probe.bind((cfg['address'],port))
    subprocess.run([str(DEV/'stop')],check=True)
    env={k:v for k,v in os.environ.items() if k in ['HOME','PATH','USER','DISPLAY','WAYLAND_DISPLAY','XAUTHORITY','XDG_RUNTIME_DIR','DBUS_SESSION_BUS_ADDRESS','LANG']}
    log=(root/'logs/phone-manager.log').open('ab');p=subprocess.Popen([NODE,str(root/'bin/phone-run.cjs')],cwd=root/'bin',env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True);log.close();write(root/'PHONE_MANAGER.json',{'pid':p.pid})
    deadline=time.monotonic()+90
    while time.monotonic()<deadline:
        if p.poll() is not None:subprocess.run([str(DEV/'start')],check=True);raise ValueError('PHONE_INSTANCE_EXITED; inspect isolated logs')
        if (root/'PHONE_LIVE.json').exists() and json.loads((root/'PHONE_LIVE.json').read_text())['state']=='ready':print(json.dumps({'state':'ready','root':str(root),'origin':cfg['origin'],'certificateUrl':cfg['certificateUrl'],'caSha256':cfg['caFingerprint']}));return
        time.sleep(.25)
    raise ValueError('PHONE_START_NOT_READY; do not start another instance before checking its logs')
def stop(root):
    pid=manager(root)
    if pid:os.kill(pid,signal.SIGTERM)
    deadline=time.monotonic()+60
    while manager(root) and time.monotonic()<deadline:time.sleep(.2)
    assert not manager(root),'PHONE_STILL_DRAINING; no forced termination'
    subprocess.run([str(DEV/'start')],check=True);print('phone test stopped; daily development instance restored')
def pair(root,cfg):
    assert manager(root),'PHONE_NOT_RUNNING';key=json.loads((root/'config/local-credentials.json').read_text())['serverKey']
    connection=json.loads((root/'data/chat/.native-sync/connection.json').read_text());headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'};body={}
    if connection.get('scopeMode')=='source':
        assert connection.get('sourceScope',{}).get('mode')=='full','FULL_SOURCE_REQUIRED'
        headers.update({'X-NativeSync-Source':connection['sourceId'],'X-NativeSync-Device':connection['deviceId'],'X-NativeSync-Space':connection['spaceId']});body={'scopeMode':'source','sourceId':connection['sourceId']};description='此二维码授权本合成来源及以后新增的话题，不包含后端 Key。'
    else:
        topics=connection['topics'];headers['X-NativeSync-Topics']=__import__('base64').urlsafe_b64encode(json.dumps([[t['itemType'],t['itemId'],t['topicId']] for t in topics]).encode()).decode().rstrip('=');description='此二维码只授权四个合成测试话题，不包含后端 Key。'
    req=urllib.request.Request('http://127.0.0.1:17650/api/plugins/NativeSync/mobile/pairing',data=json.dumps(body).encode(),headers=headers);grant=json.load(urllib.request.urlopen(req,timeout=5));url=cfg['origin']+'/mobile/#pair='+grant['pairingCode']
    code='from reportlab.graphics.barcode.qr import QrCodeWidget; from reportlab.graphics.shapes import Drawing; from reportlab.graphics import renderSVG; import sys; q=QrCodeWidget(sys.stdin.read()); b=q.getBounds(); d=Drawing(320,320,transform=[320/(b[2]-b[0]),0,0,320/(b[3]-b[1]),0,0]); d.add(q); print(renderSVG.drawToString(d))'
    svg=subprocess.check_output([PYTHON,'-c',code],input=url,text=True)
    card=root/'config/phone/pair-card.html';card.write_text('<meta charset="utf-8"><meta http-equiv="refresh" content="15"><h1>NativeSync 手机测试配对</h1><p>仅在本机显示。三分钟内扫码，并在手机确认连接；过期后由本机重新生成。</p>'+svg+'<p>'+description+'</p>');card.chmod(0o600)
    print(json.dumps({'pairCard':'http://127.0.0.1:17652/phone-pair','expiresAt':grant['expiresAt'],'codePrinted':False}))
def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('command',choices=['prepare','attach-source','start','stop','status','pair']);parser.add_argument('--address');parser.add_argument('--package',type=pathlib.Path,default=REPO/'.local/release-assembly/phone-readiness');parser.add_argument('--root',type=pathlib.Path);a=parser.parse_args()
    if a.command=='prepare':assert a.address;prepare_phone(a.address,a.package.resolve());return
    assert a.root
    if a.command=='attach-source':assert a.address;attach_source(a.root.resolve(),a.address);return
    root,cfg=owned(a.root)
    if a.command=='start':start(root,cfg)
    elif a.command=='stop':stop(root)
    elif a.command=='pair':pair(root,cfg)
    else:print(json.dumps({'root':str(root),'managerAlive':bool(manager(root)),'origin':cfg['origin'],'realDeviceAcceptance':cfg['realDeviceAcceptance']}))
if __name__=='__main__':main()
