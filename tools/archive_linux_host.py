"""Seal public Linux host code without reading live configuration or runtime data.

Uses a private Git index/object directory. Source worktrees and their Git object
stores remain read-only. A complete public anchor export accompanies each binary
patch, so restoring code needs neither the original host directory nor GitHub.
"""
import argparse, datetime, hashlib, io, json, os, pathlib, shutil, stat, subprocess, tarfile, tempfile, zipfile

REPO = pathlib.Path(__file__).resolve().parents[1]
ANCHORS = {
    'VCPToolBox': 'c603f13692b212db371223ff6d91fb71b0b3b39e',
    'VCPChat': '44e19e7d2a04a06d3bc61304375077f0ac43e01f',
}
LOCAL_BASES = {
    'VCPToolBox': 'afc089973f0c34b6cab2d5d67f0f97f204ba7a56',
    'VCPChat': 'fb37badf5a302a6e8768a3e4b0b1e6d50efa085d',
}
EXCLUDED_PARTS = {'.git', 'node_modules', 'AppData', 'UserData', 'Agents', 'AgentGroups',
    'Agent', 'dailynote', 'DebugLog', 'logs', 'Log', 'VectorStore', 'VCPAsyncResults',
    'VCPAsyncTaskArchives', 'state', 'data', 'image', '__pycache__'}
EXCLUDED_NAMES = {'config.json', 'settings.json', 'connection.json', 'agent_map.json',
    'toolapprovalconfig.json', 'multimodal-config.json', 'models.json', '.npmrc',
    '.yarnrc', '.yarnrc.yml', '.netrc', '.pypirc', 'pip.conf', 'auth.json',
    'tokens.json', 'token.json', 'id_rsa', 'id_ed25519'}
CODE_SUFFIXES={'.js','.cjs','.mjs','.ts','.tsx','.jsx','.vue','.py','.rs','.cs','.cpp','.h','.go','.sh'}

def public(name):
    p = pathlib.PurePosixPath(name); n = p.name.lower()
    return (not p.is_absolute() and '..' not in p.parts and
        not any(x in EXCLUDED_PARTS for x in p.parts) and
        not n.startswith('.env') and not n.endswith(('.env', '.pem', '.key', '.p12', '.pfx', '.sqlite', '.sqlite3', '.db', '.log', '.pyc')) and
        n not in EXCLUDED_NAMES and not ('config' in n and n.endswith('.json') and n not in {'tsconfig.json', 'jsconfig.json'}) and
        (p.suffix.lower() in CODE_SUFFIXES or not any('secret' in x.lower() or 'credential' in x.lower() for x in p.parts)))

def git(root, *args, data=None):
    return subprocess.check_output(['git', *args], cwd=root, input=data, stderr=subprocess.PIPE)

def sha(data): return hashlib.sha256(data).hexdigest()
def save(path, value): path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')

class BlobReader:
    def __init__(self, root):
        self.p = subprocess.Popen(['git', 'cat-file', '--batch'], cwd=root, stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    def read(self, oid):
        self.p.stdin.write((oid + '\n').encode()); self.p.stdin.flush()
        header = self.p.stdout.readline().decode().split(); assert header[1] == 'blob'
        size = int(header[2]); chunks = []; remaining = size
        while remaining:
            b = self.p.stdout.read(min(remaining, 1024 * 1024)); assert b
            chunks.append(b); remaining -= len(b)
        assert self.p.stdout.read(1) == b'\n'
        return b''.join(chunks)
    def close(self): self.p.stdin.close(); assert self.p.wait() == 0

def tree(root, anchor):
    rows = {}
    for item in git(root, 'ls-tree', '-r', '-z', anchor).split(b'\0'):
        if not item: continue
        header, name = item.split(b'\t', 1); mode, kind, oid = header.decode().split()
        assert kind == 'blob' and mode in ['100644', '100755'], 'UNSUPPORTED_ANCHOR_ENTRY'
        rows[name.decode()] = {'mode': mode, 'oid': oid}
    return rows

def regular(root, name):
    path = root / name
    for p in [path, *path.parents]:
        if p == root: break
        assert not p.is_symlink(), 'PUBLIC_CODE_ALIAS ' + name
    return path if path.is_file() else None

def seal(dev, candidate, out):
    assert not out.exists(), 'NEW_OUTPUT_REQUIRED'; out.mkdir(parents=True)
    payload = json.loads((candidate / 'MANIFEST.json').read_text())
    profile = json.loads((candidate / 'compat/dev-hosts/linux-full.json').read_text())
    matched = json.loads((dev / 'matched-overlays.json').read_text())
    for row in payload['files']:
        assert sha((dev / row['path']).read_bytes()) == row['sha256'], 'PAYLOAD_DRIFT'
    for row in profile['files']:
        assert sha((dev / row['path']).read_bytes()) == row['sha256'], 'HOST_PROFILE_DRIFT'
    save(out / 'linux-full.json', profile)
    payload_paths = {r['path'] for r in payload['files']}
    records = {}; omitted = {}; patches = {}; anchor_records = {}
    with tempfile.TemporaryDirectory(prefix='nativesync-seal-index-') as temp:
        for host, anchor in ANCHORS.items():
            src = dev / host; base = tree(src, anchor)
            assert git(src, 'rev-parse', 'HEAD').decode().strip() == LOCAL_BASES[host], 'UNREVIEWED_LOCAL_HOST_BASE'
            git(src, 'merge-base', '--is-ancestor', anchor, LOCAL_BASES[host])
            part = out / host; part.mkdir(); index = pathlib.Path(temp) / host; index.mkdir()
            git(index, 'init', '--quiet')
            objects = pathlib.Path(git(src, 'rev-parse', '--path-format=absolute', '--git-path', 'objects').decode().strip())
            (index / '.git/objects/info/alternates').write_text(str(objects) + '\n')
            git(index, 'read-tree', anchor)
            names = set(base)
            names.update(tree(src, LOCAL_BASES[host]))
            names.update(n[len(host)+1:] for n in matched['publicMatchedSnapshot'] if n.startswith(host + '/'))
            names.update(r['path'][len(host)+1:] for r in profile['files'] if r['path'].startswith(host + '/'))
            if host == 'VCPToolBox':
                names.update(['modules/nativeConversationTransport.js', 'modules/pluginRuntimeEnvSandbox.js'])
                names.update(str(p.relative_to(src)) for p in (src / 'AdminPanel-Vue/dist').rglob('*') if p.is_file())
            omitted[host] = sorted(n for n in names if not public(n))
            names = sorted(n for n in names if public(n) and host + '/' + n not in payload_paths)
            rows = []; updates = []; changed = []; reader = BlobReader(src)
            archive = part / 'public-anchor.tar.gz'
            with tarfile.open(archive, 'w:gz', compresslevel=6) as tar:
                # Only declared public paths are opened, including for the anchor.
                for name, entry in sorted(base.items()):
                    if not public(name) or host + '/' + name in payload_paths: continue
                    data = reader.read(entry['oid']); info = tarfile.TarInfo(name)
                    info.size = len(data); info.mode = int(entry['mode'], 8) & 0o777; info.mtime = 0
                    tar.addfile(info, io.BytesIO(data))
                for name in names:
                    path = regular(src, name)
                    # Manifest activation is configuration; retain the public
                    # manifest bytes rather than freezing the .block filename.
                    if path is None and name.endswith('/plugin-manifest.json'):
                        path = regular(src, name + '.block')
                    entry = base.get(name)
                    if path is None:
                        if entry:
                            updates.append('0 ' + '0'*40 + '\t' + name + '\0'); changed.append({'path':name,'action':'delete'})
                        continue
                    data = path.read_bytes(); mode = '100755' if path.stat().st_mode & 0o111 else '100644'
                    oid = git(index, 'hash-object', '-w', '--stdin', data=data).decode().strip()
                    rows.append({'path':host+'/'+name,'sha256':sha(data),'bytes':len(data),'mode':mode})
                    if not entry or oid != entry['oid'] or mode != entry['mode']:
                        updates.append(mode + ' ' + oid + '\t' + name + '\0')
                        changed.append({'path':name,'action':'modify' if entry else 'add','beforeOid':entry['oid'] if entry else None,'afterOid':oid})
            reader.close()
            if updates: git(index, 'update-index', '-z', '--index-info', data=''.join(updates).encode())
            after_tree = git(index, 'write-tree').decode().strip()
            patch = git(index, 'diff', '--binary', '--full-index', '--no-ext-diff', anchor, after_tree, '--')
            (part / 'host-baseline.patch').write_bytes(patch)
            records[host] = rows; patches[host] = changed
            anchor_records[host] = {'commit':anchor,'upstreamRepository':'https://github.com/lioensky/'+host+'.git',
                'localGitBase':LOCAL_BASES[host],'upstreamIsVerifiedAncestor':True,
                'tree':git(src,'rev-parse',anchor+'^{tree}').decode().strip(),
                'patchedGitTree':after_tree,'publicAnchorSha256':sha(archive.read_bytes()),'patchSha256':sha(patch),
                'publicCodeFiles':len(rows),'changedPublicPaths':len(changed)}
            print(json.dumps({'host':host,'publicCodeFiles':len(rows),'changedPublicPaths':len(changed)}), flush=True)
    save(out / 'HOST_CODE_MANIFEST.json', {'kind':'nativesync-sealed-public-linux-host','anchors':anchor_records,
        'scope':'public code/resources and required binaries; excludes live configuration, credentials, chats and dependencies',
        'payloadExcludedFromHostPatch':sorted(payload_paths),'runtimePayloadManifestSha256':sha((candidate/'MANIFEST.json').read_bytes()),
        'files':[r for rows in records.values() for r in rows],'changes':patches,'excludedPathNames':omitted,
        'pluginActivationPolicyNotArchived':True,'sourceHostWasModified':False})
    shutil.copyfile(REPO/'tools/rebuild_linux_host.py',out/'rebuild_linux_host.py')
    # Keep a verified runtime package separate from the base patch.
    package = out / 'candidate'; package.mkdir()
    for p in candidate.rglob('*'):
        if not p.is_file() or p.is_symlink() or p.is_relative_to(candidate/'assembled') or p.name == 'pwa-build.txt': continue
        target = package / p.relative_to(candidate); target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,target)
    shutil.copyfile(REPO/'docs/linux-host-seal-20261101.md',out/'README.md')
    print(json.dumps({'output':str(out),'hosts':anchor_records}), flush=True)

if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--dev-root',type=pathlib.Path,default=pathlib.Path('/home/jenn/NativeSync-Dev'));p.add_argument('--candidate',required=True,type=pathlib.Path);p.add_argument('--out',required=True,type=pathlib.Path);a=p.parse_args();seal(a.dev_root.resolve(),a.candidate.resolve(),a.out.resolve())
