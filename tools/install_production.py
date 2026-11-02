"""Pinned, code-only NativeSync install/rollback for the reviewed Tencent target.

No SSH, service control, configuration edits or database restoration. Production
mutations require a separately approved, confirmed and already stopped window.
"""
import argparse
import contextlib
import fcntl
import hashlib
import importlib.util
import json
import os
import pathlib
import pwd
import shutil
import socket
import stat
import subprocess
import sys
import tempfile

ROOT = pathlib.Path('/opt/AGENTS_OS_Workspace/runtime/VCPToolBox')
BACKUPS = pathlib.Path('/opt/AGENTS_OS_Workspace/backups/NativeSync')
DATA = pathlib.Path('/opt/AGENTS_OS_Workspace/runtime-data/NativeSync/r21')
FIXTURES = pathlib.Path('/var/tmp') / ('nativesync-production-validation-' + str(os.getuid()))
OLD_PWA_ASSETS = {
    'assets/index-DI5CQjGO.js': '9d27f440d7db07334bb8bdb86e9fd10b5f78a9cd0245d75e3314b7d9c2b7bb2b',
    'assets/index--gXYP5bX.css': '8c22dc030ad70e52a415d896c1566f72b05d3d4a1cd47898e483c7a75dcd831b',
}
PLAN_SHA = 'dd40b094183c30a516c0806114bec4dee9ad3ad4694b7c4d64ec7736e7a7a4fb'
MANIFEST_SHA = '91134a1656d23ee80b8aa3550fb0f85e8ab55e0893eece5590e4bded195dad95'
CONFIG_SHA = 'bce07af11223781966536bde31ff88cb25869839d9ee0f2845923b4b962a72d4'  # Reviewed non-secret settings only.


def fail(condition, code):
    if not condition:
        raise ValueError(code)


def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest() if file.is_file() else None


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()


def canonical_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def no_alias(file):
    file = pathlib.Path(os.path.abspath(file))
    for parent in [file, *file.parents]:
        fail(not parent.is_symlink(), 'PATH_ALIAS')
    fail(not file.exists() or file.is_file() or file.is_dir(), 'SPECIAL_FILE')
    return file


def sync_dir(directory):
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def atomic(file, content, mode=0o600):
    no_alias(file)
    file.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.nativesync-', dir=file.parent)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, file)
        sync_dir(file.parent)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def config_projection(root):
    keys = {'NativeSyncEnabled','NativeSyncDataDir','NativeMobileEnabled','NativeMobileConfigSync',
            'NativeMobileAttachments','NativeMobileOrigin','NativeMobilePwaDir','NativeMobileKeyExchangeEnabled',
            'NativeMobileBackendUrl','NativeSyncFullSources','NativeMobileTopics'}
    values = {}
    for relative in ['config.env','Plugin/NativeSync/config.env']:
        file = root / relative
        fail(file.is_file(), 'CONFIG_REQUIRED')
        local = set()
        for line in file.read_text().splitlines():
            text = line.strip()
            if not text or text.startswith('#') or '=' not in text:
                continue
            key, value = text.split('=', 1)
            key, value = key.strip(), value.strip()
            if key not in keys:
                continue
            fail(key not in local, 'DUPLICATE_CONFIG_KEY')
            local.add(key)
            if len(value)>1 and value[0] in ['"', "'"] and value[-1]==value[0]:
                value = value[1:-1]
            if key in ['NativeSyncFullSources','NativeMobileTopics']:
                rows = json.loads(value)
                fail(isinstance(rows,list) and all(isinstance(row,dict) for row in rows),'INVALID_SCOPE_CONFIGURATION')
                # Hash the whole authority document, including unknown/new
                # fields. Projecting a whitelist here could silently miss an
                # added approvedScope, model, memberAliases or imageModels.
                value = {'items':len(rows),'semanticSha256':canonical_hash(rows),
                         'rowKeys':[sorted(row) for row in rows]}
            values[key] = value
    return values


class Target:
    def __init__(self, fixture=None):
        if fixture is None:
            fail(socket.gethostname()=='VM-0-13-ubuntu' and pwd.getpwuid(os.getuid()).pw_name=='ubuntu', 'PRODUCTION_IDENTITY_MISMATCH')
            self.root, self.data, self.backups = ROOT, DATA, BACKUPS
            self.config_sha, self.fixture = CONFIG_SHA, False
            self.node = ROOT / '.runtime/node/bin/node'
        else:
            fail(socket.gethostname()!='VM-0-13-ubuntu', 'FIXTURE_MODE_FORBIDDEN_ON_PRODUCTION')
            run = no_alias(pathlib.Path(fixture).absolute())
            fail(run.parent==FIXTURES and run.stat().st_uid==os.getuid(), 'OWNED_FIXTURE_REQUIRED')
            marker = json.loads((run/'ISOLATED.json').read_text())
            fail(marker['kind']=='nativesync-production-public-fixture', 'FIXTURE_MARKER_REQUIRED')
            self.root, self.data, self.backups = run/'host', run/'data', run/'backups'
            self.node = pathlib.Path(marker['node'])
            self.config_sha, self.fixture = marker['configProjectionSha256'], True
        no_alias(self.root)
        no_alias(self.data)

    def stopped(self):
        if not self.fixture:
            value = subprocess.check_output(['systemctl','show','vcptoolbox.service','-pActiveState','-pMainPID'], text=True)
            fields = dict(line.split('=',1) for line in value.splitlines() if '=' in line)
            fail(fields=={'ActiveState':'inactive','MainPID':'0'}, 'STOPPED_SERVICE_REQUIRED')
        # In addition to systemd, reject another same-user holder of this ledger.
        for proc in pathlib.Path('/proc').iterdir():
            try:
                if not proc.name.isdigit() or int(proc.name)==os.getpid() or proc.stat().st_uid!=os.getuid():
                    continue
                if (proc/'stat').read_text().rsplit(')',1)[1].split()[0]=='Z':
                    continue
                for fd in (proc/'fd').iterdir():
                    try:
                        path = os.readlink(fd)
                        fail(not path.startswith(str(self.data/'central.sqlite')), 'DATABASE_STILL_OPEN')
                    except FileNotFoundError:
                        pass
            except (FileNotFoundError, ProcessLookupError, PermissionError):
                continue

    def config(self):
        projection = config_projection(self.root)
        fail(canonical_hash(projection)==self.config_sha, 'CONFIGURATION_SCOPE_CHANGED')
        fail(projection['NativeSyncDataDir']==str(self.data) and projection['NativeMobilePwaDir']==str(self.root/'apps/mobile/dist'), 'DATA_OR_PWA_MAPPING_CHANGED')
        return {relative:digest(self.root/relative) for relative in ['config.env','Plugin/NativeSync/config.env']}


def load_plan(file):
    fail(digest(file)==PLAN_SHA, 'UNREVIEWED_TARGET_PLAN')
    return json.loads(file.read_text())


def targets(plan, target):
    rows = []
    for entry in plan['files']:
        row = dict(entry)
        relative = pathlib.PurePosixPath(row['relativeTarget'])
        fail(not relative.is_absolute() and '..' not in relative.parts, 'UNSAFE_TARGET')
        row['file'] = no_alias(target.root / relative)
        fail(not row['file'].exists() or row['file'].is_file(), 'NON_FILE_TARGET')
        rows.append(row)
    return rows


def verify_phase(rows, phase):
    for row in rows:
        current = digest(row['file'])
        expected = row['afterSha256'] if phase=='after' else row['beforeSha256']
        allowed = {expected}
        if phase=='mixed':
            allowed = {row['beforeSha256'],row['afterSha256']}
        elif phase=='before' and row['rollback']=='retain-inert-immutable-asset':
            allowed.add(row['afterSha256'])
        fail(current in allowed, 'TARGET_DIRTY '+row['relativeTarget'])


def protect_host(plan, target):
    for row in plan['protectedHostFiles']:
        relative = pathlib.Path(row['path']).relative_to(ROOT)
        fail(digest(no_alias(target.root/relative))==row['sha256'], 'HOST_REQUIREMENT_CHANGED '+str(relative))
    for name, expected in OLD_PWA_ASSETS.items():
        fail(digest(no_alias(target.root/'apps/mobile/dist'/name))==expected, 'OLD_PWA_ASSET_CHANGED')


def package_verify(package):
    fail(sys.flags.optimize==0, 'NORMAL_PYTHON_ASSERTIONS_REQUIRED')
    fail(package is not None, 'PACKAGE_REQUIRED')
    fail(digest(package/'MANIFEST.json')==MANIFEST_SHA, 'UNREVIEWED_CANDIDATE')
    spec = importlib.util.spec_from_file_location('release_verify', pathlib.Path(__file__).with_name('install_release.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.verify(package)


def database(target, package, destination=None):
    command = [str(target.node),str(pathlib.Path(__file__).with_name('production_db_snapshot.cjs')),str(target.data/'central.sqlite'),str(package)]
    if destination is not None:
        command.append(str(destination))
    result = subprocess.run(command, capture_output=True, text=True, timeout=60)
    fail(result.returncode==0, 'DATABASE_NOT_SETTLED_OR_CORRUPT')
    return json.loads(result.stdout)


@contextlib.contextmanager
def locked(target, backup):
    no_alias(target.backups)
    target.backups.mkdir(parents=True, exist_ok=True, mode=0o700)
    fail(no_alias(backup).parent==target.backups, 'OWNED_BACKUP_REQUIRED')
    descriptor = os.open(target.backups/'.install.lock', os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX|fcntl.LOCK_NB)
        yield
    finally:
        os.close(descriptor)


def install(package, plan_file, target, backup):
    plan = load_plan(plan_file)
    manifest, payload = package_verify(package)
    rows = targets(plan, target)
    target.stopped()
    configs = target.config()
    protect_host(plan, target)
    verify_phase(rows, 'before')
    for row in rows:
        fail(row['source'] in payload and payload[row['source']]['sha256']==row['afterSha256'], 'TARGET_MAPPING_MISMATCH')
    with locked(target, backup):
        fail(not backup.exists(), 'NEW_BACKUP_REQUIRED')
        target.stopped()
        backup.mkdir(mode=0o700)
        state = database(target, package, backup/'consistent.sqlite')
        raw=[]
        for source in sorted(target.data.rglob('*')):
            no_alias(source)
            if source.is_file():
                relative=source.relative_to(target.data);destination=backup/'raw'/relative
                atomic(destination, source.read_bytes())
                raw.append({'path':str(relative),'sha256':digest(destination)})
        metadata=[]
        for row in rows:
            if row['operation']!='verify-only':
                file=row['file'];present=file.exists();mode=stat.S_IMODE(file.stat().st_mode) if present else 0o644
                metadata.append({'target':row['relativeTarget'],'mode':mode})
                if row['beforeSha256'] is not None:
                    atomic(backup/'before'/row['relativeTarget'],file.read_bytes())
        for name in configs:
            atomic(backup/'configuration'/name,(target.root/name).read_bytes())
        pwa_inventory=[]
        for source in sorted((target.root/'apps/mobile/dist').rglob('*')):
            no_alias(source)
            if source.is_file():
                relative=source.relative_to(target.root/'apps/mobile/dist')
                atomic(backup/'full-pwa'/relative,source.read_bytes())
                pwa_inventory.append({'path':str(relative),'sha256':digest(source)})
        journal={'format':1,'state':'prepared','root':str(target.root),'fixture':target.fixture,
                 'planSha256':PLAN_SHA,'manifestSha256':MANIFEST_SHA,'configurationSha256':configs,
                 'database':state,'rawFiles':raw,'pwaInventory':pwa_inventory,'modes':metadata,'writesCompleted':[],
                 'dataRestorationAllowed':False}
        atomic(backup/'INSTALL.json',encoded(journal))
        # Publish assets before index; the backend remains stopped throughout.
        order=sorted([r for r in rows if r['operation']!='verify-only'],key=lambda r:(r['relativeTarget']=='apps/mobile/dist/index.html',r['relativeTarget']))
        for row in order:
            target.stopped()
            fail(target.config()==configs, 'CONFIGURATION_CHANGED_DURING_INSTALL')
            fail(digest(row['file']) in {row['beforeSha256'],row['afterSha256']} if row['rollback']=='retain-inert-immutable-asset' else digest(row['file'])==row['beforeSha256'], 'TARGET_CHANGED_DURING_INSTALL')
            if digest(row['file'])!=row['afterSha256']:
                content=(package/'payload'/row['source']).read_bytes()
                fail(hashlib.sha256(content).hexdigest()==row['afterSha256'], 'PAYLOAD_CHANGED_DURING_INSTALL')
                atomic(row['file'],content,next(m['mode'] for m in metadata if m['target']==row['relativeTarget']))
                journal['writesCompleted'].append(row['relativeTarget'])
                atomic(backup/'INSTALL.json',encoded(journal))
        target.stopped()
        protect_host(plan,target)
        verify_phase(rows,'after')
        fail(target.config()==configs, 'CONFIGURATION_CHANGED_DURING_INSTALL')
        fail(database(target,package)['facts']==state['facts'], 'ACCEPTED_DATA_CHANGED_DURING_INSTALL')
        journal['state']='installed'
        atomic(backup/'INSTALL.json',encoded(journal))
        return journal


def rollback(plan_file, target, backup, package):
    plan=load_plan(plan_file)
    package_verify(package)
    rows=targets(plan,target)
    with locked(target,backup):
        no_alias(backup)
        journal=json.loads(no_alias(backup/'INSTALL.json').read_text())
        fail(journal['root']==str(target.root) and journal['fixture']==target.fixture and journal['planSha256']==PLAN_SHA and journal['manifestSha256']==MANIFEST_SHA, 'BACKUP_TARGET_MISMATCH')
        fail(journal['state'] in ['prepared','installed','rolling-back'], 'BACKUP_NOT_ROLLBACKABLE')
        target.stopped()
        state=database(target,package)
        fail(target.config()==journal['configurationSha256'], 'CONFIGURATION_CHANGED_SINCE_INSTALL')
        protect_host(plan,target)
        # Only interrupted operations allow a before/after mixture.
        verify_phase(rows,'mixed' if journal['state']!='installed' else 'after')
        for row in rows:
            if row['operation']!='verify-only' and row['beforeSha256'] is not None:
                fail(digest(no_alias(backup/'before'/row['relativeTarget']))==row['beforeSha256'], 'BACKUP_CORRUPT')
        journal['state']='rolling-back'
        atomic(backup/'INSTALL.json',encoded(journal))
        for row in sorted(rows,key=lambda r:(r['relativeTarget']!='apps/mobile/dist/index.html',r['relativeTarget'])):
            if row['operation']=='verify-only' or row['rollback']=='retain-inert-immutable-asset':
                continue
            target.stopped()
            fail(target.config()==journal['configurationSha256'], 'CONFIGURATION_CHANGED_DURING_ROLLBACK')
            current=digest(row['file'])
            fail(current in {row['beforeSha256'],row['afterSha256']}, 'TARGET_CHANGED_DURING_ROLLBACK')
            if current==row['beforeSha256']:
                continue
            if row['beforeSha256'] is None:
                row['file'].unlink()
                sync_dir(row['file'].parent)
            else:
                atomic(row['file'],(backup/'before'/row['relativeTarget']).read_bytes(),next(m['mode'] for m in journal['modes'] if m['target']==row['relativeTarget']))
        verify_phase(rows,'before')
        protect_host(plan,target)
        fail(database(target,package)['facts']==state['facts'], 'ACCEPTED_DATA_CHANGED_DURING_ROLLBACK')
        journal['state']='rolled-back'
        atomic(backup/'INSTALL.json',encoded(journal))
        return journal


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['preflight','install','rollback'])
    parser.add_argument('--plan',required=True,type=pathlib.Path)
    parser.add_argument('--package',type=pathlib.Path)
    parser.add_argument('--backup',type=pathlib.Path)
    parser.add_argument('--fixture',type=pathlib.Path)
    parser.add_argument('--window-confirmed',action='store_true',help='Operator has separate production approval, stopped ingress and settled all host work.')
    args=parser.parse_args()
    target=Target(args.fixture)
    if args.action!='preflight' and not target.fixture:
        fail(args.window_confirmed,'APPROVED_MAINTENANCE_WINDOW_REQUIRED')
    if args.action=='preflight':
        plan=load_plan(args.plan)
        package_verify(args.package)
        protect_host(plan,target)
        target.config()
        verify_phase(targets(plan,target),'before')
        print(json.dumps({'verified':True,'target':str(target.root),'productionWrites':False,'stoppedWindowStillRequired':True}))
        return
    fail(args.backup is not None,'BACKUP_REQUIRED')
    receipt=install(args.package,args.plan,target,args.backup.absolute()) if args.action=='install' else rollback(args.plan,target,args.backup.absolute(),args.package)
    print(json.dumps({'state':receipt['state'],'root':receipt['root'],'dataRestored':False,'codeWrites':len(receipt['writesCompleted'])}))


if __name__=='__main__':
    try:
        main()
    except (ValueError,OSError,KeyError,subprocess.SubprocessError) as error:
        # Do not include private configuration or database values in errors.
        code=str(error) if isinstance(error,ValueError) and str(error).split(' ')[0].replace('_','').isalnum() else type(error).__name__
        sys.stderr.write('INSTALLATION_REFUSED: '+code+'\n')
        sys.exit(1)
