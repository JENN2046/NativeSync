#!/usr/bin/env python3
import pathlib,subprocess,os,json,sys,time,signal,ssl,urllib.request,urllib.error
ROOT=pathlib.Path(__file__).resolve().parents[1];NODE='/home/jenn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node';FILE=ROOT/'data/processes.json'
def environment():
 allowed=['PATH','HOME','USER','LOGNAME','LANG','DISPLAY','WAYLAND_DISPLAY','XAUTHORITY','XDG_RUNTIME_DIR','DBUS_SESSION_BUS_ADDRESS','SHELL']
 env={k:v for k,v in os.environ.items() if k in allowed};env['PATH']=str(pathlib.Path(NODE).parent)+':/usr/bin:/bin';env['CHOKIDAR_USEPOLLING']='true';env['CHOKIDAR_INTERVAL']='1000';env['NODE_EXTRA_CA_CERTS']=str(ROOT/'config/tls/localhost-cert.pem');env['VCPCHAT_APP_DATA_DIR']=str(ROOT/'data/chat');env['VCPCHAT_STATE_DIR']=str(ROOT/'data/launcher');return env
def PathLikeUnderRoot(pid):
 try:return pathlib.Path(os.readlink('/proc/'+str(pid)+'/cwd')).is_relative_to(ROOT)
 except OSError:return False
processes=json.loads(FILE.read_text()) if FILE.exists() else {}
def alive(pid):
 try:os.kill(pid,0);return pathlib.Path('/proc/'+str(pid)+'/stat').read_text().rsplit(')',1)[1].split()[0]!='Z'
 except OSError:return False
def spawn(name,args,cwd):
 old=processes.get(name)
 if old and alive(old) and PathLikeUnderRoot(old):return
 log=(ROOT/'logs'/f'{name}.log').open('ab');p=subprocess.Popen(args,cwd=cwd,env=environment(),stdout=log,stderr=subprocess.STDOUT,start_new_session=True);processes[name]=p.pid;FILE.write_text(json.dumps(processes,indent=2)+'\n');print(name,'PID',p.pid,flush=True)
def wait_ready():
 credentials=json.loads((ROOT/'config/local-credentials.json').read_text())
 context=ssl.create_default_context(cafile=str(ROOT/'config/tls/localhost-cert.pem'))
 deadline=time.monotonic()+45
 while time.monotonic()<deadline:
  if not alive(processes['backend']):raise SystemExit('Backend exited before readiness; inspect logs/backend.log.')
  try:
   for route in ['/v1/models','/api/v1/sync/status']:
    req=urllib.request.Request('https://127.0.0.1:17653'+route,headers={'Authorization':'Bearer '+credentials['serverKey']})
    with urllib.request.urlopen(req,context=context,timeout=2) as response:
     if response.status!=200:raise RuntimeError('unready')
     json.load(response)
   print('backend and NativeSync ready');return
  except (OSError,ValueError,RuntimeError):time.sleep(.25)
 raise SystemExit('Backend readiness failed; inspect logs/backend.log. Desktop was not started.')
command=sys.argv[1] if len(sys.argv)>1 else 'status'
if command=='start':
 spawn('provider',[NODE,str(ROOT/'bin/local-provider.cjs')],ROOT);spawn('backend',[NODE,'server.js'],ROOT/'VCPToolBox');spawn('admin',[NODE,'adminServer.js'],ROOT/'VCPToolBox');spawn('https',[NODE,str(ROOT/'bin/https-proxy.cjs')],ROOT)
 wait_ready()
 if '--no-chat' not in sys.argv:
  spawn('chat',[NODE,'scripts/vcpchat-dev-launcher.mjs','--project-root',str(ROOT/'VCPChat'),'--shallow-doctor','--ready-timeout-ms','60000','--','--remote-debugging-port=17654'],ROOT/'VCPChat')
  subprocess.run([NODE,str(ROOT/'bin/desktop-ready.cjs')],cwd=ROOT,env=environment(),check=True,timeout=55)
elif command=='stop':
 chat_pid=processes.get('chat')
 if chat_pid and alive(chat_pid) and PathLikeUnderRoot(chat_pid):
  subprocess.run([NODE,str(ROOT/'bin/desktop-stop.cjs')],cwd=ROOT,env=environment(),check=True,timeout=25)
 for name,pid in list(processes.items()):
  try:
   cmd=pathlib.Path('/proc')/str(pid)/'cmdline'
   if alive(pid) and (str(ROOT).encode() in cmd.read_bytes() or PathLikeUnderRoot(pid)):
    if name=='chat':
     deadline=time.monotonic()+5
     while alive(pid) and time.monotonic()<deadline:time.sleep(.1)
     if alive(pid):raise SystemExit('Desktop launcher still running after guarded quit; not forcing it.')
     continue
    os.killpg(pid,signal.SIGTERM);print('stopping',name,pid)
  except OSError:pass
 deadline=time.monotonic()+15
 for name,pid in processes.items():
  while alive(pid) and PathLikeUnderRoot(pid) and time.monotonic()<deadline:time.sleep(.1)
  if alive(pid) and PathLikeUnderRoot(pid):raise SystemExit(name+' is still draining; no forced termination attempted.')
else:
 for name,pid in processes.items():print(name,pid,'running' if alive(pid) and PathLikeUnderRoot(pid) else 'stopped')
