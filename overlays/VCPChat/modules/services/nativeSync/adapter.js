'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { durableJson } = require('./durableJson');
const {envelopeFor,fieldsFrom,withFields,emptyHash,assertCompatibleBackfill,validateEnvelope}=require('./metadata');
const {stable,sha256}=require('./protocol');
const { identity, canonicalMessage, messageKey, messageHash, tombstoneHash, descriptor, wireTopic, fail } = require('./protocol');
const verifiedContinuity=message=>message?._nativeSyncMetadata?validateEnvelope(message,message._nativeSyncMetadata).fields.continuity:undefined;
// Older v2 receipts may have copied a raw top-level field even when their
// envelope covered some other control. Version alone does not attest causality.
const acknowledgedContinuity=value=>value?.continuityVerified===true?value.continuity:undefined;

function validatePullPage(result, cursor, limit) {
    if (!result || !Array.isArray(result.events) || result.events.length > limit ||
        !Number.isSafeInteger(result.headSeq) || !Number.isSafeInteger(result.nextSeq) ||
        result.headSeq < cursor || result.nextSeq < cursor || result.nextSeq > result.headSeq ||
        typeof result.hasMore !== 'boolean' || result.hasMore !== (result.nextSeq < result.headSeq)) throw fail('INVALID_PULL_CURSOR');
    if (result.hasMore && result.nextSeq === cursor) throw fail('PAGINATION_STALLED');
    let previous = cursor;
    for (const event of result.events) {
        if (!Number.isSafeInteger(event?.seq) || event.seq <= previous) throw fail('CURSOR_REWIND');
        if (event.seq > result.nextSeq) throw fail('INVALID_PULL_CURSOR');
        previous = event.seq;
    }
}

// State locks never wait for Queue or network. Queue -> short state transaction is
// the only nested lock order; HTTP is always outside both locks.
const openingQueues = new WeakSet();
const activePaths = new Map();
const stateKey = file => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
class NativeSyncAdapter {
    static async open(options) {
        const adapter = new NativeSyncAdapter(options);
        const ownerKey=stateKey(adapter.statePath);
        if(openingQueues.has(adapter.queue)||activePaths.has(ownerKey))throw fail('SYNC_ALREADY_ATTACHED');
        const policy=adapter.queue.syncPolicy;
        if(policy&&!options.source&&JSON.stringify(policy.topics)!==JSON.stringify(adapter.topics))throw fail('OWNER_BINDING_CHANGED');
        if(policy&&!policy.isRecoveryFence)throw fail('SYNC_ALREADY_ATTACHED');
        openingQueues.add(adapter.queue);activePaths.set(ownerKey,adapter);
        adapter.queue.configureSync(adapter.recoveryFence('SYNC_STARTUP_RECOVERY_REQUIRED'));
        try {
        let loaded=false;
        try { adapter.state = JSON.parse(await fs.readFile(adapter.statePath, 'utf8'));loaded=true; }
        catch (error) { if(error instanceof SyntaxError)throw fail('INVALID_SYNC_STATE_JSON');if (error.code !== 'ENOENT') throw error; }
        if (!adapter.state||typeof adapter.state!=='object'||adapter.state.deviceId !== adapter.deviceId || ![1,2].includes(adapter.state.version) || !Array.isArray(adapter.state.outbox) || !Number.isSafeInteger(adapter.state.cursor) || adapter.state.cursor < 0 || !adapter.state.acked) throw fail('INVALID_SYNC_STATE');
        if(!adapter.state.source&&options.source&&options.sourceAdoptionVerified===true)adapter.state.source=structuredClone(options.source);
        if(adapter.state.source&&options.sourceTransitionVerified&&JSON.stringify(adapter.state.source.binding)!==JSON.stringify(adapter.source?.binding)){
            const proof=adapter.source?.scopeTransition,scopes=require('./sourceScope'),prior=adapter.state.source.binding,next=adapter.source.binding,{scope:a,...x}=prior,{scope:b,...y}=next;
            if(!proof||proof.localStateHash!==sha256(stable(adapter.state))||proof.fromScopeHash!==scopes.scopeHash(a)||proof.toScopeHash!==scopes.scopeHash(b)||stable(x)!==stable(y))throw fail('SOURCE_BINDING_CHANGED');scopes.expansion(a,b||{mode:'full'});adapter.state.source=structuredClone(adapter.source);
        }
        if (JSON.stringify(adapter.state.source?.binding||null)!==JSON.stringify(adapter.source?.binding||null)) throw fail('SOURCE_BINDING_CHANGED');
        if(adapter.source&&adapter.state.topics.some(d=>!adapter.sourcePermits(d)))throw fail('SOURCE_SCOPE_MISMATCH');
        if (JSON.stringify(adapter.state.topics) !== JSON.stringify(adapter.topics)) throw fail('OWNER_BINDING_CHANGED');
        if (adapter.state.version===1) {
            const backup=adapter.statePath+'.v1-backup.'+sha256(JSON.stringify(adapter.state)).slice(0,16);
            try { await fs.access(backup); } catch(error) { if(error.code!=='ENOENT')throw error;await durableJson(backup,adapter.state); }
            adapter.state={...adapter.state,version:2,format:'native-message-intents-v1',migration:{from:1,backup},localCommits:{},receipts:{},inbox:[],drift:{}};
            for(const op of adapter.state.outbox)if(op.action==='delete'){op.status='legacy-unverified';op.error={code:'LEGACY_DELETE_INTENT_UNVERIFIED'};}
        }
        if(adapter.state.format!=='native-message-intents-v1'||!adapter.state.localCommits||!adapter.state.receipts||!Array.isArray(adapter.state.inbox)||adapter.state.inbox.length>1000||!adapter.state.drift)throw fail('INVALID_SYNC_STATE');
        if(!loaded&&options.bootstrap)adapter.state.initialImport={id:randomUUID(),...structuredClone(options.bootstrap),preparedTopics:[]};
        await adapter.persist(adapter.statePath,adapter.state);
        adapter.queue.configureSync(adapter, event => adapter.observe(event));
        try { await adapter.recover(); }
        catch (error) { await adapter.recordDegradation(error); }
        return adapter;
        } catch(error) { adapter.startupError=error.code||'SYNC_STARTUP_FAILED';if(policy?.isRecoveryFence)adapter.queue.configureSync(policy);if(activePaths.get(ownerKey)===adapter)activePaths.delete(ownerKey);throw error; }
        finally { openingQueues.delete(adapter.queue); }
    }

    constructor({ queue, statePath, deviceId, url, token, topics, source = null, notify = () => {}, persist = durableJson, request = null }) {
        const endpoint = new URL(url);
        if (!(endpoint.protocol === 'https:' || (endpoint.protocol === 'http:' && endpoint.hostname === '127.0.0.1')) || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) throw fail('PROTECTED_SYNC_ENDPOINT_REQUIRED');
        if (!queue || !deviceId || !statePath || !token || !Array.isArray(topics) || (!source&&!topics.length)) throw fail('INVALID_SYNC_OPTIONS');
        this.source=source;this.fullSource=Boolean(source)&&!require('./sourceScope').normalizeScope(source?.binding?.scope);
        this.queue = queue; this.statePath = statePath; this.deviceId = deviceId;
        this.url = endpoint.origin; this.token = token; this.notify = notify; this.persist = persist;
        this.requestOverride = request; this.tail = Promise.resolve(); this.busy = false;
        this.degraded = null; this.notificationPending = new Map();
        this.topics = topics.map(d => ({ itemId: d.itemId, itemType: d.itemType || 'agent', topicId: d.topicId }));
        this.bindings = new Map();
        for (const d of this.topics) {
            identity({ ...wireTopic(d), msgId: '_binding' });
            const file = this.queue.getHistoryPath(d.itemId, d.topicId);
            const key = process.platform === 'win32' ? file.toLowerCase() : file;
            if (this.bindings.has(key)) throw fail('OWNER_PATH_CONFLICT');
            this.bindings.set(key, JSON.stringify(wireTopic(d)));
        }
        this.state = { version: 2,format:'native-message-intents-v1', deviceId, topics: this.topics, cursor: 0, acked: {}, outbox: [], pending: null,localCommits:{},receipts:{},inbox:[],drift:{},...(source?{source:structuredClone(source)}:{}) };
    }

    outsideSource(d){
        if(!this.source||this.sourcePermits(d)||this.isEnabled(d))return false;
        const file=this.queue.getHistoryPath(d.itemId,d.topicId),key=process.platform==='win32'?file.toLowerCase():file;
        if(this.bindings.has(key))throw fail('OWNER_PATH_CONFLICT');return true;
    }
    sourcePermits(d){return Boolean(this.source)&&require('./sourceScope').permits(this.source.binding.scope,d);}
    canonical(raw,topicId){return this.source?require('./sourceSnapshot').canonicalSourceMessage(raw,topicId):canonicalMessage(raw,topicId);}
    isEnabled(d) {
        return this.topics.some(t => t.itemId === d.itemId && t.itemType === (d.itemType || 'agent') && t.topicId === d.topicId);
    }
    recoveryFence(code) {
        const adapter=this;
        const beforeWrite=async d=>{
            if(adapter.fullSource||adapter.sourcePermits(d)||adapter.isEnabled(d))throw fail(adapter.startupError||code);
            const file=adapter.queue.getHistoryPath(d.itemId,d.topicId),key=process.platform==='win32'?file.toLowerCase():file;
            if(adapter.bindings.has(key))throw fail('OWNER_PATH_CONFLICT');
        };
        return {isRecoveryFence:true,fullSource:this.fullSource,topics:this.topics,isEnabled:d=>adapter.isEnabled(d),beforeMutation:beforeWrite,beforeWrite,
            beforeRead:async d=>{if(adapter.isEnabled(d)){adapter.assertTopic(d);await adapter.assertPhysicalPath(d);}},
            retryLocalCommit:async()=>{throw fail(adapter.startupError||code);},
            diagnostics:()=>({enabled:true,degraded:adapter.startupError||code,readOnly:true,selectedTopics:adapter.topics.length,localCommits:[],outboxSize:adapter.state?.outbox?.length||0,pending:false})};
    }
    async addSourceTopic(d) {
        if(!this.source)throw fail('FULL_SOURCE_REQUIRED');
        if(!this.sourcePermits(d))throw fail('SOURCE_TOPIC_NOT_APPROVED');
        const normalized={itemId:d.itemId,itemType:d.itemType||'agent',topicId:d.topicId};
        identity({...wireTopic(normalized),msgId:'_binding'});
        if(this.isEnabled(normalized))return;
        const file=this.queue.getHistoryPath(d.itemId,d.topicId),key=process.platform==='win32'?file.toLowerCase():file;
        if(this.bindings.has(key))throw fail('OWNER_PATH_CONFLICT');
        await this.assertPhysicalPath(normalized);
        await this.transaction(next=>{if(!next.topics.some(t=>this.sameTopic(wireTopic(t),normalized)))next.topics.push(normalized);});
        this.topics=this.state.topics.map(t=>({...t}));this.bindings.set(key,JSON.stringify(wireTopic(normalized)));
    }
    deletedMessageIds(d) {
        const deleted = new Set();
        const itemType=d.itemType||'agent';
        for (const [key, value] of Object.entries(this.state.acked)) {
            const [type, owner, topic, msg] = JSON.parse(key);
            if (type === itemType && owner === d.itemId && topic === d.topicId && value.deleted) deleted.add(msg);
        }
        for (const op of this.state.outbox) {
            if (op.ownerType === itemType && op.ownerId === d.itemId && op.topicId === d.topicId) {
                if (op.action === 'delete') deleted.add(op.msgId); else deleted.delete(op.msgId);
            }
        }
        return [...deleted];
    }
    assertTopic(d) {
        if (!this.isEnabled(d)) throw fail('OWNER_BINDING_MISMATCH');
        const file = this.queue.getHistoryPath(d.itemId, d.topicId);
        const key = process.platform === 'win32' ? file.toLowerCase() : file;
        if (this.bindings.get(key) !== JSON.stringify(wireTopic(d))) throw fail('OWNER_PATH_CONFLICT');
    }
    async assertPhysicalPath(d) {
        const root = path.resolve(this.queue.userDataDir);
        const file = this.queue.getHistoryPath(d.itemId, d.topicId);
        const segments = path.relative(root, file).split(path.sep);
        let current = root;
        for (const segment of ['', ...segments]) {
            if (segment) current = path.join(current, segment);
            try {
                const info = await fs.lstat(current);
                if (info.isSymbolicLink() || (info.isFile() && info.nlink > 1)) throw fail('OWNER_PATH_ALIAS');
            } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
    }
    async beforeRead(d) {
        if (this.isEnabled(d)) {
            this.assertTopic(d); await this.assertPhysicalPath(d);
            const known=new Map();
            for(const [key,value]of Object.entries(this.state.acked))if(this.sameTopicIdentity(key,d))known.set(key,!value.deleted);
            for(const op of this.state.outbox)if(this.sameTopic(op,d))known.set(messageKey(op),op.action!=='delete');
            if([...known.values()].some(Boolean))try{await fs.access(this.queue.getHistoryPath(d.itemId,d.topicId));}catch(error){if(error.code==='ENOENT')throw fail('HISTORY_SOURCE_MISSING');throw error;}
        }
    }
    topicKey(d) { return JSON.stringify(wireTopic(d)); }
    sameTopic(op,d) { const id=wireTopic(d);return op.ownerType===id.ownerType&&op.ownerId===id.ownerId&&op.topicId===id.topicId; }
    projectionRecoveryFor(d) {
        const row=this.state.inbox.filter(item=>item.projectionRecovery&&this.sameTopic(item.event,d)).sort((a,b)=>a.event.seq-b.event.seq)[0];
        if(row&&!this.sameEvent(row.event,row.projectionRecovery.event))throw fail('RECOVERY_EVENT_MISMATCH');
        return row?.projectionRecovery;
    }
    assertProjectionWriteOrder(d) {
        const proof=this.projectionRecoveryFor(d);
        // This proof binds the whole Topic revision. Parking it frees other
        // Topics, not writes to this same History, until its event is settled.
        if(proof&&(d.syncSource!=='remote'||!this.sameEvent(proof.event,d.syncEvent)))throw fail('SYNC_RECOVERY_REQUIRED');
    }
    async beforeMutation(d) {
        if(this.outsideSource(d))return;
        if(this.sourceDeletionActive(d)||this.sourceDeleted?.(d))throw fail('SOURCE_DIRECTORY_DELETED');
        if(this.source&&!this.sourceExpected&&d.syncSource!=='remote'&&!d.syncResumeCommitId)throw fail('SOURCE_STARTUP_RECOVERY_REQUIRED');
        if(this.source&&!this.isEnabled(d)&&d.syncSource!=='remote'){if(!this.ensureSourceTopic)throw fail('SOURCE_TOPIC_NOT_ATTACHED');await this.ensureSourceTopic(d);}
        if(this.source&&d.syncSource!=='remote'){await this.ensureSourceSnapshot?.(d);if(this.sourceDeleted?.(d))throw fail('SOURCE_DIRECTORY_DELETED');}
        if(!this.isEnabled(d))return;
        this.assertTopic(d);await this.assertPhysicalPath(d);
        if(this.state.initialImport&&d.syncSource!=='remote')throw fail('INITIAL_IMPORT_RECOVERY_REQUIRED');
        if(this.state.pending&&this.sameTopic(this.state.pending.event,d)&&d.syncSource!=='remote')throw fail('SYNC_RECOVERY_REQUIRED');
        this.assertProjectionWriteOrder(d);
        if(this.state.localCommits[this.topicKey(d)]&&!d.syncResumeCommitId)await this.reconcileLocal(d);
        if(d.syncSource!=='remote'){
            await this.capture(d,await this.queue.read(d));
            if(this.state.drift[this.topicKey(d)])throw fail('LOCAL_HISTORY_DRIFT');
        }
    }
    async beforeWrite(d) {
        if(this.outsideSource(d))return;
        if(this.sourceDeletionActive(d))throw fail('SOURCE_DIRECTORY_DELETED');
        if(this.source&&!this.sourceExpected&&d.syncSource!=='remote'&&!d.syncResumeCommitId)throw fail('SOURCE_STARTUP_RECOVERY_REQUIRED');
        if(this.source&&!this.isEnabled(d)&&d.syncSource!=='remote'){if(!this.ensureSourceTopic)throw fail('SOURCE_TOPIC_NOT_ATTACHED');await this.ensureSourceTopic(d);}
        if(this.source&&d.syncSource!=='remote'){await this.ensureSourceSnapshot?.(d);if(this.sourceDeleted?.(d))throw fail('SOURCE_DIRECTORY_DELETED');}
        if (this.isEnabled(d)) {
            this.assertTopic(d);
            await this.assertPhysicalPath(d);
            if (this.state.pending && this.sameTopic(this.state.pending.event,d) && d.syncSource !== 'remote') throw fail('SYNC_RECOVERY_REQUIRED');
            this.assertProjectionWriteOrder(d);
            if(this.state.localCommits[this.topicKey(d)]&&this.state.localCommits[this.topicKey(d)].id!==d.syncResumeCommitId)throw fail('LOCAL_COMMIT_RECOVERY_REQUIRED');
        } else {
            const file = this.queue.getHistoryPath(d.itemId, d.topicId);
            const key = process.platform === 'win32' ? file.toLowerCase() : file;
            if (this.bindings.has(key)) throw fail('OWNER_PATH_CONFLICT');
        }
    }
    transaction(fn) {
        const current = this.tail.catch(() => {}).then(async () => {
            const next = structuredClone(this.state);
            const result = await fn(next);
            try { await this.persist(this.statePath, next); }
            catch(error) {
                // A rename may have succeeded before a later fsync failed.
                // Reconcile the authoritative JSON before another transaction.
                try { const disk=JSON.parse(await fs.readFile(this.statePath,'utf8'));if(disk.version===2&&disk.deviceId===this.deviceId&&JSON.stringify(disk.topics)===JSON.stringify(this.topics))this.state=disk; } catch {}
                error.syncStatePersistenceFailure=true;
                throw error;
            }
            this.state = next;
            return result;
        });
        this.tail = current;
        return current;
    }
    async recordDegradation(error) {
        this.degraded = error.code || 'SYNC_CAPTURE_FAILED';
        await durableJson(`${this.statePath}.degraded`, { code: this.degraded, recoverable: true }).catch(() => {});
    }
    async prepareLocalCommit(d,intent) {
        this.assertTopic(d);
        const key=this.topicKey(d),existing=this.state.localCommits[key];
        if(existing){if(existing.id===d.syncResumeCommitId)return existing;throw fail('LOCAL_COMMIT_RECOVERY_REQUIRED');}
        const latest=new Map(this.state.outbox.map(op=>[messageKey(op),op])),operations=[];
        const groups=new Map();
        const remember=op=>{const c=op.causality||verifiedContinuity(op.message);for(const field of ['requestId','executionId'])if(c?.[field])groups.set(field+':'+c[field],op);};
        for(const op of this.state.outbox)remember(op);
        const touched=[];const deleted=[];
        const editedIds=new Set(intent.nativeOperations.filter(op=>op.kind==='edit').map(op=>op.id));
        for(const op of intent.nativeOperations){if(op.kind==='delete'){touched.push(...op.ids);deleted.push(...op.ids);}else touched.push(op.message?.id||op.id);}
        const before=new Map(intent.beforeHistory.map(m=>[m.id,m])),after=new Map(intent.history.map(m=>[m.id,m]));
        for(const msgId of new Set(touched)){
            const id={...wireTopic(d),msgId},mk=messageKey(id),raw=after.get(msgId),prior=latest.get(mk),base=prior?{hash:prior.action==='delete'?tombstoneHash(prior):messageHash(prior.message),deleted:prior.action==='delete',metadataVersion:prior.metadata?.version??this.state.acked[mk]?.metadataVersion??0,metadataHash:prior.metadata?.hash??this.state.acked[mk]?.metadataHash??emptyHash()}:(this.state.acked[mk]||this.sourceBase?.(d,msgId));
            if(!raw&&!deleted.includes(msgId))throw fail('EXPLICIT_DELETE_REQUIRED');
            // Time-only edits remain durable native operations for local replay,
            // but cannot create a wire change by synthesizing new causality.
            if(raw&&before.has(msgId)&&editedIds.has(msgId)){
                const previous={...before.get(msgId)},current={...raw};
                delete previous.updatedAt;delete current.updatedAt;
                if(stable(previous)===stable(current))continue;
            }
            const inherited=verifiedContinuity(before.get(msgId))||acknowledgedContinuity(this.state.acked[mk]);
            const known=intent.known!==undefined?intent.known:Boolean(intent.operations||inherited?.known);
            const parents=new Set(inherited?.dependsOnMessageIds||[]);
            for(const p of [raw?.replyToMessageId,raw?.parentMessageId,...(intent.dependsOnMessageIds||[])])if(p&&p!==msgId)parents.add(p);
            for(const p of intent.causalContextIds||[])if(p&&p!==msgId)parents.add(p);
            const requestId=intent.requestId||raw?.requestId||raw?.streamOperationId||inherited?.requestId,executionId=intent.executionId||raw?.executionId||inherited?.executionId;
            const grouped=[groups.get('requestId:'+requestId),groups.get('executionId:'+executionId)].filter(Boolean);
            for(const op of grouped)if(op.msgId!==msgId&&this.sameTopic(op,d))parents.add(op.msgId);
            const parentIds=parents.size<=1000?[...parents]:[];
            const continuity={version:1,known:known&&parents.size<=1000,...(requestId?{requestId}:{}),...(executionId?{executionId}:{}),dependsOnMessageIds:parentIds};
            if(raw&&known&&!intent.localOnly)raw.continuity=continuity;
            // Frame references are deterministic local hashes. The native bytes
            // remain in History; CAS upload can occur later without an online
            // dependency or a changed operation identity.
            if(raw&&!intent.localOnly)for(const attachment of raw.attachments||[]){
                const data=attachment._fileManagerData||attachment,frames=data.imageFrames||attachment.imageFrames;
                if(Array.isArray(frames)&&frames.length){
                    if(frames.length>10)throw fail('ATTACHMENT_FRAME_LIMIT');
                    const hashes=frames.map(frame=>{const bytes=Buffer.from(frame,'base64');if(bytes.length>20*1024*1024)throw fail('ATTACHMENT_FILE_TOO_LARGE');return sha256(bytes);});
                    attachment.frameHashes=hashes;if(attachment._fileManagerData)attachment._fileManagerData.frameHashes=hashes;
                }
            }
            const msg=raw?this.canonical({...raw,_nativeSyncMetadata:undefined},d.topicId):null;
            const metadataHash=msg?sha256(stable(fieldsFrom(msg))):emptyHash(),hash=msg?messageHash(msg):null;
            if(intent.localOnly){const previous=before.get(msgId),previousMessage=previous?this.canonical({...previous,_nativeSyncMetadata:undefined},d.topicId):null;if(!previousMessage||!msg||messageHash(previousMessage)!==hash||sha256(stable(fieldsFrom(previousMessage)))!==metadataHash)throw fail('LOCAL_MATERIALIZATION_CHANGED_MESSAGE');continue;}
            if(msg&&base&&!base.deleted&&base.hash===hash&&(base.metadataHash||emptyHash())===metadataHash)continue;
            if(!msg&&(!base||base.deleted))continue;
            const metadata=msg&&(metadataHash!==emptyHash()||base?.metadataVersion)?envelopeFor(msg,(base?.metadataVersion||0)+((base?.metadataHash||emptyHash())===metadataHash?0:1)):null;
            if(raw&&metadata)raw._nativeSyncMetadata=structuredClone(metadata);
            const dependsOnOps=[];if(prior)dependsOnOps.push(prior.opId);
            dependsOnOps.push(...grouped.map(op=>op.opId));
            for(const p of parentIds){const op=latest.get(messageKey({...wireTopic(d),msgId:p}));if(op)dependsOnOps.push(op.opId);}
            const op={...id,deviceId:this.deviceId,opId:intent.id+':'+operations.length,action:msg?'upsert':'delete',baseHash:base?.hash??null,message:msg,...(metadata?{metadata}:{}),causality:continuity,dependsOnOps:[...new Set(dependsOnOps)],commitId:intent.id};
            operations.push(op);latest.set(mk,op);
            remember(op);
        }
        const {deriveMessageOperations}=await import('../../chat/historyMessageIntent.mjs');
        const record={id:intent.id,source:intent.source,beforeRevision:intent.beforeRevision,afterRevision:this.queue.revision(intent.history),nativeOperations:deriveMessageOperations(intent.beforeHistory,intent.history,{deleteIds:deleted}),operations,stage:'prepared'};
        await this.transaction(next=>{if(next.localCommits[key])throw fail('LOCAL_COMMIT_RECOVERY_REQUIRED');if(next.receipts[record.id])throw fail('LOCAL_COMMIT_ID_REUSED');next.localCommits[key]=structuredClone(record);});
        return record;
    }
    async confirmLocal(d,id,revision) {
        return this.transaction(next=>{
            const key=this.topicKey(d),record=next.localCommits[key];
            if(!record||record.id!==id||record.afterRevision!==revision)throw fail('LOCAL_COMMIT_CONFIRMATION_MISMATCH');
            const ids=new Set(next.outbox.map(op=>op.opId));
            for(const op of record.operations)if(!ids.has(op.opId))next.outbox.push(op);
            next.receipts[id]={id,source:record.source,beforeRevision:record.beforeRevision,afterRevision:record.afterRevision,opIds:record.operations.map(op=>op.opId),state:record.operations.length?'saved_pending':'local_only'};
            delete next.localCommits[key];
            const completed=Object.keys(next.receipts).filter(k=>['synced','local_only'].includes(next.receipts[k].state));
            while(completed.length>256)delete next.receipts[completed.shift()];
        });
    }
    async reconcileLocal(d) {
        const record=this.state.localCommits[this.topicKey(d)];if(!record)return;
        const revision=this.queue.revision(await this.queue.read(d));
        if(revision===record.afterRevision){await this.confirmLocal(d,record.id,revision);return;}
        const code=revision===record.beforeRevision?'LOCAL_COMMIT_NOT_COMMITTED':'LOCAL_COMMIT_HISTORY_CONFLICT';
        await this.transaction(next=>{const r=next.localCommits[this.topicKey(d)];if(r?.id===record.id){r.stage=revision===record.beforeRevision?'uncommitted':'conflicted';r.error={code};}});
        throw fail(code);
    }
    async retryLocalCommit(d,id) {
        this.assertTopic(d);
        return this.queue.run(d,async()=>{
            const record=this.state.localCommits[this.topicKey(d)];if(!record||record.id!==id)throw fail('LOCAL_COMMIT_NOT_FOUND');
            const history=await this.queue.read(d),revision=this.queue.revision(history);
            if(revision===record.afterRevision){await this.confirmLocal(d,id,revision);return {success:true,localState:'saved',sync:{state:'captured',delivery:'pending',commitId:id},history};}
            if(revision!==record.beforeRevision)throw fail('LOCAL_COMMIT_HISTORY_CONFLICT');
            const {applyMessageOperations}=await import('../../chat/historyMessageIntent.mjs');
            const next=applyMessageOperations(history,record.nativeOperations);
            if(this.queue.revision(next)!==record.afterRevision)throw fail('LOCAL_COMMIT_REPLAY_MISMATCH');
            const result=await this.queue.write({...d,syncResumeCommitId:id},next,{beforeHistory:history,intent:{id,operations:record.nativeOperations,source:record.source}});
            return {...result,history:next};
        });
    }
    async observe({ descriptor: d, history, revision, localCommitId }) {
        this.assertTopic(d);
        try {
            if (d.syncSource === 'remote') {
                const event = d.syncEvent;
                await this.transaction(next => {
                    const key = messageKey(event);
                    const continuity=verifiedContinuity(event.message)||(event.action==='delete'?acknowledgedContinuity(next.acked[key]):undefined);
                    if (!next.acked[key] || next.acked[key].seq < event.seq) next.acked[key] = { hash: event.hash, deleted: event.action === 'delete', seq: event.seq,metadataVersion:event.message?._nativeSyncMetadata?.version||0,metadataHash:event.message?._nativeSyncMetadata?.hash||emptyHash(),continuity,continuityVerified:Boolean(continuity) };
                    if(d.syncAdvanceCursor!==false)next.cursor = Math.max(next.cursor, event.seq);
                    next.pending = null;
                    next.inbox=next.inbox.filter(item=>item.event.seq!==event.seq);
                });
                const change = { agentId: d.itemId, ownerId: d.itemId, ownerType: d.itemType, topicId: d.topicId, revision, source: 'native-sync', seq: event.seq };
                this.notificationPending.set(JSON.stringify(wireTopic(d)), change);
                // Notification failure cannot undo an already durable cursor. Retain
                // dirty notification and retry independently, including at recovery.
                this.retryNotifications();
            } else {
                if(!localCommitId)throw fail('LOCAL_COMMIT_INTENT_REQUIRED');
                await this.confirmLocal(d,localCommitId,revision);
            }
        } catch (error) {
            // Even if the main state disk is unavailable, attempt a separate,
            // low-disclosure recovery marker. Startup always rescans the allowlist.
            await this.recordDegradation(error);
            throw error;
        }
    }
    async capture(d, history) {
        // A snapshot is evidence for reconciliation, never a new user intent.
        this.assertTopic(d);
        const expected=new Map(this.sourceExpected?.(d)||[]);
        for(const [key,value]of Object.entries(this.state.acked))if(this.sameTopicIdentity(key,d))expected.set(key,value);
        for(const op of this.state.outbox)if(this.sameTopic(op,d))expected.set(messageKey(op),{hash:op.action==='delete'?tombstoneHash(op):messageHash(op.message),deleted:op.action==='delete',metadataHash:op.metadata?.hash||emptyHash()});
        const actual=new Map(history.map(raw=>{const m=this.source?require('./sourceSnapshot').canonicalSourceSnapshot(raw,d.topicId):this.canonical(raw,d.topicId);return [messageKey({...wireTopic(d),msgId:m.id}),{hash:messageHash(m),metadataHash:sha256(stable(fieldsFrom(m)))}];}));
        const drift=[];
        for(const [key,value]of expected)if(value.deleted?actual.has(key):actual.get(key)?.hash!==value.hash||actual.get(key)?.metadataHash!==(value.metadataHash||emptyHash()))drift.push(key);
        for(const key of actual.keys())if(!expected.has(key))drift.push(key);
        const value=drift.length?{code:'UNKNOWN_HISTORY_DRIFT',messageKeys:[...new Set(drift)]}:null;
        if(JSON.stringify(this.state.drift[this.topicKey(d)]||null)!==JSON.stringify(value))await this.transaction(next=>{if(value)next.drift[this.topicKey(d)]=value;else delete next.drift[this.topicKey(d)];});
        return {drift:drift.length};
    }
    sameTopicIdentity(key,d) { const [ownerType,ownerId,topicId]=JSON.parse(key);return this.sameTopic({ownerType,ownerId,topicId},d); }
    async bootstrapApproved() {
        const plan=this.state.initialImport;if(!plan)return;
        for(let index=0;index<plan.snapshots.length;index++){
            const item=plan.snapshots[index],d=item.descriptor,key=this.topicKey(d),commitId=plan.id+':'+index;
            if(this.state.initialImport.preparedTopics.includes(key))continue;
            await this.queue.run(d,async()=>{
                if(!this.state.receipts[commitId]){
                    const history=await this.queue.read(d);
                    if(this.queue.revision(history)!==item.revision)throw fail('APPROVED_HISTORY_CHANGED');
                    const ids=new Set(item.unmatchedIds),operations=item.history.filter(m=>ids.has(m.id)).map(message=>({kind:'append',message}));
                    const prepared=structuredClone(history);
                    const record=await this.prepareLocalCommit(d,{id:commitId,source:'approved-initial-import',nativeOperations:operations,beforeHistory:history,history:prepared,beforeRevision:item.revision,afterRevision:item.revision});
                    if(record.afterRevision!==item.revision){
                        const result=await this.queue.write({...d,syncResumeCommitId:commitId},prepared,{beforeHistory:history,intent:{id:commitId,operations:record.nativeOperations,source:record.source}});
                        if(result.sync?.state!=='captured')throw fail('SYNC_STATE_NOT_DURABLE');
                    }else await this.confirmLocal(d,commitId,item.revision);
                }
                await this.transaction(next=>next.initialImport.preparedTopics.push(key));
            });
        }
        for(const event of [...this.state.initialImport.matched]){
            this.validateEvent(event);
            await this.applyRemote(event,false,false,true);
            await this.transaction(next=>{next.initialImport.matched=next.initialImport.matched.filter(e=>e.seq!==event.seq);});
        }
        await this.transaction(next=>{delete next.initialImport;});
    }
    async recover() {
        for(const d of this.topics){
            if(this.state.localCommits[this.topicKey(d)])try{await this.queue.run(d,()=>this.reconcileLocal(d));}catch(error){
                if(error.syncStatePersistenceFailure)throw error;
                if(['HISTORY_SOURCE_MISSING','EACCES','EPERM','INVALID_HISTORY','INVALID_HISTORY_JSON'].includes(error.code))await this.transaction(next=>{const record=next.localCommits[this.topicKey(d)];if(record){record.stage='conflicted';record.error={code:error.code};}});
                else if(!['LOCAL_COMMIT_NOT_COMMITTED','LOCAL_COMMIT_HISTORY_CONFLICT'].includes(error.code))throw error;
            }
        }
        if(this.state.pending)try{await this.applyRemote(this.state.pending.event,true);}catch(error){
            if(error.syncStatePersistenceFailure)throw error;
            if(['SOURCE_BASELINE_REQUIRED','SOURCE_DIRECTORY_DELETED','RECOVERY_HISTORY_CONFLICT','LOCAL_CONTENT_CONFLICT','UNSYNCED_LOCAL_CONFLICT','HISTORY_SOURCE_MISSING','EACCES','EPERM','INVALID_HISTORY','INVALID_HISTORY_JSON'].includes(error.code))await this.parkProjection(this.state.pending.event,error);
            else if(!['LOCAL_COMMIT_NOT_COMMITTED','LOCAL_COMMIT_HISTORY_CONFLICT'].includes(error.code))throw error;
        }
        await this.bootstrapApproved();
        await this.drainInbox();
        for(const d of this.topics){
            if(!this.state.localCommits[this.topicKey(d)]&&!(this.source&&!this.sourceExpected)&&!this.sourceUnprepared?.(d))try{await this.queue.run(d,async()=>this.capture(d,await this.queue.read(d)));}
            catch(error){if(error.syncStatePersistenceFailure)throw error;await this.transaction(next=>{next.drift[this.topicKey(d)]={code:error.code||'HISTORY_READ_FAILED'};});}
            this.notificationPending.set(this.topicKey(d),{agentId:d.itemId,ownerId:d.itemId,ownerType:d.itemType,topicId:d.topicId,source:'native-sync',recovered:true});
        }
        this.degraded=null;await fs.rm(`${this.statePath}.degraded`,{force:true});this.retryNotifications();
    }
    retryNotifications() {
        for (const [key, event] of this.notificationPending) {
            try { if (this.notify(event) !== false) this.notificationPending.delete(key); }
            catch { /* dirty until the next retry or allowlisted startup refresh */ }
        }
    }
    async request(route, options = {}) {
        route=require('./connection').sourceRoute({scopeMode:this.source?'source':'selected'},route);
        if (this.requestOverride) return this.requestOverride(route, options);
        let response;
        try {
            response = await fetch(this.url + route, { method: options.body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', 'X-NativeSync-Protocol':'2','X-NativeSync-Capabilities':'attachments-v1,message-intents-v1' }, body: options.body ? JSON.stringify(options.body) : undefined, redirect: 'error', signal: AbortSignal.timeout(2000) });
        } catch { throw fail('NETWORK_UNAVAILABLE'); }
        let result;try{result=await response.json();}catch{};
        if(!response.ok)throw Object.assign(fail(/^[A-Z][A-Z0-9_]{0,79}$/.test(result?.error?.code||'')?result.error.code:'SYNC_HTTP_ERROR'),{status:response.status});
        if(!result)throw fail('CORRUPT_HTTP_RESPONSE');
        return result;
    }
    wireOperation(op) { const {ownerType,ownerId,topicId,msgId,deviceId,opId,action,baseHash,message,metadata}=op;return {ownerType,ownerId,topicId,msgId,deviceId,opId,action,baseHash,message,...(metadata?{metadata}:{})}; }
    sourceDeletionActive(d) {
        return Boolean(this.state.source&&Object.values(this.state.source.deletions||{}).some(r=>r.stage!=='aborted'&&r.targets.some(t=>t.ownerType===(d.itemType||'agent')&&t.ownerId===d.itemId&&(!t.topicId||t.topicId===d.topicId))));
    }
    sourceBaselineBlocked(d) {
        // Durable facts are available during the first recover(), before the
        // coordinator has loaded its page cache or attached optional callbacks.
        return Boolean(this.state.source&&(this.sourceDeletionActive(d)||this.state.source.plans?.[this.topicKey(d)]?.stage!=='complete'));
    }
    outboundBlocked(op) {
        if(this.sourceBaselineBlocked(descriptor(op))||this.sourceOutboundBlocked?.(descriptor(op)))return true;
        const earlier=this.state.outbox.slice(0,this.state.outbox.findIndex(x=>x.opId===op.opId));
        if(earlier.some(x=>messageKey(x)===messageKey(op)))return true;
        if((op.dependsOnOps||[]).some(id=>this.state.outbox.some(x=>x.opId===id)))return true;
        const relation=op.causality||verifiedContinuity(op.message);
        if(relation?.dependsOnMessageIds?.some(id=>!this.state.acked[messageKey({...wireTopic(descriptor(op)),msgId:id})]))return true;
        if(relation?.dependsOnMessageIds?.some(id=>earlier.some(x=>this.sameTopic(x,descriptor(op))&&x.msgId===id)))return true;
        if(!relation?.known&&earlier.some(x=>this.sameTopic(x,descriptor(op))))return true;
        if(earlier.some(x=>(relation?.requestId&&relation.requestId===(x.causality||verifiedContinuity(x.message))?.requestId)||(relation?.executionId&&relation.executionId===(x.causality||verifiedContinuity(x.message))?.executionId)))return true;
        return false;
    }
    async flush() {
        if(this.busy)throw fail('BUSY');this.busy=true;
        try{
            if(this.degraded||this.state.pending)await this.recover();
            for(const candidate of [...this.state.outbox]){
                const op=this.state.outbox.find(x=>x.opId===candidate.opId);
                if(!op||op.status==='conflicted'||op.status==='legacy-unverified'||this.outboundBlocked(op))continue;
                let result;
                try{result=await this.request('/api/v1/sync/push',{body:this.wireOperation(op)});}
                catch(error){
                    if(error.status===409&&['MESSAGE_CONFLICT','METADATA_VERSION_CONFLICT','METADATA_TOMBSTONED','IDEMPOTENCY_KEY_REUSED'].includes(error.code)){
                        await this.transaction(next=>{const item=next.outbox.find(x=>x.opId===op.opId);if(item){item.status='conflicted';item.error={code:error.code,status:error.status};}});continue;
                    }
                    throw error;
                }
                if(op.metadata&&result.metadataHash!==op.metadata.hash)throw fail('CORRUPT_METADATA_ACK');
                if(result.hash!==(op.action==='delete'?tombstoneHash(op):messageHash(op.message))||!Number.isSafeInteger(result.seq)||result.seq<1||result.deleted!==(op.action==='delete'))throw fail('CORRUPT_ACK');
                await this.transaction(next=>{
                    const index=next.outbox.findIndex(x=>x.opId===op.opId);if(index<0)throw fail('OUTBOX_CHANGED');
                    const continuity=op.causality||verifiedContinuity(op.message)||acknowledgedContinuity(next.acked[messageKey(op)]);
                    next.acked[messageKey(op)]={hash:result.hash,deleted:result.deleted,seq:result.seq,metadataVersion:result.metadataVersion||0,metadataHash:result.metadataHash||emptyHash(),continuity,continuityVerified:Boolean(continuity)};
                    next.outbox.splice(index,1);
                    for(const receipt of Object.values(next.receipts))if(receipt.state==='saved_pending'&&receipt.opIds.every(id=>!next.outbox.some(x=>x.opId===id)))receipt.state='synced';
                });
            }
        }finally{this.busy=false;}
    }
    validateEvent(event) {
        const id=identity(event);this.assertTopic(descriptor(id));
        if(event.message?.continuity&&!event.message._nativeSyncMetadata){const message={...event.message};delete message.continuity;event={...event,message};}
        if(!Number.isSafeInteger(event.seq)||event.seq<1||!['upsert','delete'].includes(event.action))throw fail('CORRUPT_EVENT');
        if(event.hash!==(event.action==='delete'?tombstoneHash(id):messageHash(event.message))||(event.action==='upsert'&&event.message.id!==id.msgId))throw fail('CORRUPT_EVENT');
        return event.message?{...event,message:this.canonical(event.message,id.topicId)}:event;
    }
    inboundBlocked(event) {
        const sourceDescriptor=descriptor(event),sourceProof=this.projectionRecoveryFor(sourceDescriptor);
        if(this.sourceBaselineBlocked(sourceDescriptor)||this.sourceInboundBlocked?.(sourceDescriptor)){
            if(this.sourceDeletionActive(sourceDescriptor)||!sourceProof?.initialImport||!this.sameEvent(sourceProof.event,event))return true;
        }
        const key=messageKey(event),d=descriptor(event),relation=verifiedContinuity(event.message)||(event.action==='delete'?acknowledgedContinuity(this.state.acked[key]):undefined);
        const recovery=this.projectionRecoveryFor(d);
        if(recovery&&!this.sameEvent(recovery.event,event))return true;
        if(this.state.acked[key]?.seq>=event.seq)return false;
        const prior=this.state.inbox.filter(x=>x.event.seq<event.seq&&this.sameTopic(x.event,d));
        const related=c=>(relation?.requestId&&c?.requestId===relation.requestId)||(relation?.executionId&&c?.executionId===relation.executionId);
        if(this.state.outbox.some(op=>related(op.causality||verifiedContinuity(op.message))))return true;
        if(relation?.dependsOnMessageIds?.some(id=>id!==event.msgId&&!this.state.acked[messageKey({...wireTopic(d),msgId:id})]))return true;
        if(this.state.outbox.some(op=>messageKey(op)===key)||prior.some(x=>messageKey(x.event)===key))return true;
        if(relation?.dependsOnMessageIds?.some(id=>this.state.outbox.some(op=>this.sameTopic(op,d)&&op.msgId===id)||this.state.inbox.some(x=>x.event.seq<event.seq&&this.sameTopic(x.event,d)&&x.event.msgId===id)))return true;
        if(!relation?.known&&prior.length)return true;
        if(this.state.inbox.some(x=>x.event.seq<event.seq&&related(verifiedContinuity(x.event.message))))return true;
        return false;
    }
    sameEvent(left,right) {
        return Boolean(left&&right&&left.seq===right.seq&&messageKey(left)===messageKey(right)&&left.action===right.action&&left.hash===right.hash);
    }
    async parkProjection(event,error) {
        // Free the short global write slot only after its exact proof is safe
        // on the corresponding Inbox row. State persistence errors propagate.
        await this.transaction(next=>{
            let row=next.inbox.find(x=>this.sameEvent(x.event,event));
            if(!row){row={event};next.inbox.push(row);}
            if(next.pending){
                if(!this.sameEvent(next.pending.event,event))throw fail('RECOVERY_EVENT_MISMATCH');
                row.projectionRecovery=next.pending;next.pending=null;
            }
            row.error={code:error.code};
        });
    }
    async drainInbox() {
        for(const item of [...this.state.inbox].sort((a,b)=>a.event.seq-b.event.seq)){
            const event=item.event;if(!this.state.inbox.some(x=>x.event.seq===event.seq))continue;
            if(this.inboundBlocked(event))continue;
            try{await this.applyRemote(event);}
            catch(error){
                if(error.syncStatePersistenceFailure)throw error;
                if(['SOURCE_BASELINE_REQUIRED','SOURCE_DIRECTORY_DELETED','UNSYNCED_LOCAL_CONFLICT','LOCAL_CONTENT_CONFLICT','LOCAL_COMMIT_NOT_COMMITTED','LOCAL_COMMIT_HISTORY_CONFLICT','RECOVERY_HISTORY_CONFLICT','HISTORY_SOURCE_MISSING','EACCES','EPERM','INVALID_HISTORY','INVALID_HISTORY_JSON'].includes(error.code)){
                    await this.parkProjection(event,error);continue;
                }
                throw error;
            }
        }
    }
    async applyRemote(event, recovering = false, advanceCursor = true, initialImport = false) {
        event=this.validateEvent(event);
        const id = identity(event), d = descriptor(id);
        this.assertTopic(d);
        if (!Number.isSafeInteger(event.seq) || event.seq < 1 || !['upsert', 'delete'].includes(event.action)) throw fail('CORRUPT_EVENT');
        if (event.hash !== (event.action === 'delete' ? tombstoneHash(id) : messageHash(event.message)) || (event.action === 'upsert' && event.message.id !== id.msgId)) throw fail('CORRUPT_EVENT');
        const recoveryProof=this.state.pending||this.state.inbox.find(x=>this.sameEvent(x.event,event))?.projectionRecovery;
        if(recoveryProof){
            if(!this.sameEvent(recoveryProof.event,event))throw fail('RECOVERY_EVENT_MISMATCH');
            if(recoveryProof.advanceCursor===false)advanceCursor=false;
            if(recoveryProof.initialImport===true)initialImport=true;
        }
        if(this.sourceBaselineBlocked(d)&&!initialImport)throw fail('SOURCE_BASELINE_REQUIRED');
        const result = await this.queue.mutate({ ...d, syncSource: 'remote', syncEvent: event,syncAdvanceCursor:advanceCursor }, async history => {
            const beforeRevision = this.queue.revision(history);
            const key = messageKey(id), prior = this.state.acked[key];
            if (prior?.seq >= event.seq) return history;
            if (this.state.outbox.some(op => messageKey(op) === key)) throw fail('UNSYNCED_LOCAL_CONFLICT');
            const index = history.findIndex(m => m.id === id.msgId);
            const actual = index < 0 ? null : messageHash(history[index]);
            const expected = prior && !prior.deleted ? prior.hash : null;
            const alreadyApplied = event.action === 'delete' ? actual === null : actual === event.hash;
            if (actual !== expected && !alreadyApplied) throw fail('LOCAL_CONTENT_CONFLICT');
            if(initialImport&&index>=0&&event.message)assertCompatibleBackfill(history[index],event.message);
            const proof=this.state.pending||this.state.inbox.find(x=>x.event.seq===event.seq)?.projectionRecovery;
            if(proof&&!this.sameEvent(proof.event,event))throw fail('RECOVERY_EVENT_MISMATCH');
            if (proof && this.queue.revision(history) !== proof.beforeRevision && this.queue.revision(history) !== proof.afterRevision) throw fail('RECOVERY_HISTORY_CONFLICT');
            if (event.action === 'delete') { if (index >= 0) history.splice(index, 1); }
            else if (index >= 0) history[index] = event.message._nativeSyncMetadata?withFields({ ...history[index], ...this.canonical(event.message, d.topicId) },event.message._nativeSyncMetadata):{ ...history[index], ...this.canonical(event.message, d.topicId) };
            else history.push(this.canonical(event.message, d.topicId));
            const afterRevision = this.queue.revision(history);
            await this.transaction(next => {
                if (next.pending && next.pending.event.seq !== event.seq) throw fail('SYNC_RECOVERY_REQUIRED');
                next.pending = { event, afterRevision, beforeRevision: next.pending?.beforeRevision ?? beforeRevision,advanceCursor,initialImport };
            });
            return history;
        });
        if (result.sync?.state !== 'captured') throw fail('SYNC_STATE_NOT_DURABLE');
        return result;
    }
    async pull({limit=100}={}) {
        if(this.busy)throw fail('BUSY');this.busy=true;
        try{
            if(this.degraded||this.state.pending)await this.recover();
            await this.drainInbox();
            for(let page=0;page<10000;page++){
                const result=await this.request(`/api/v1/sync/pull?after_seq=${this.state.cursor}&limit=${limit}`);
                validatePullPage(result,this.state.cursor,limit);
                result.events=result.events.map(event=>this.validateEvent(event));
                await this.transaction(next=>{
                    if(next.inbox.length+result.events.length>1000)throw fail('INBOUND_BUFFER_FULL');
                    next.inbox.push(...result.events.map(event=>({event})));next.cursor=result.nextSeq;
                });
                await this.drainInbox();
                if(!result.hasMore){this.retryNotifications();return;}
            }
            throw fail('PAGINATION_STALLED');
        }finally{this.busy=false;}
    }
    async synchronize() { await this.flush(); await this.pull(); }
    diagnostics() { return { ...(this.sourceDiagnostics?{source:this.sourceDiagnostics()}:{}), degraded: this.degraded,lastTransportError:this.lastTransportError||null, configurationError:this.configurationError||null, attachmentError:this.attachmentError||null, cursor: this.state.cursor,receivedCursor:this.state.cursor,materializedThrough:this.state.inbox.length?Math.min(...this.state.inbox.map(x=>x.event.seq))-1:this.state.cursor,inboundBuffered:this.state.inbox.length,conflicts:this.state.outbox.filter(op=>op.status).map(op=>({opId:op.opId,msgId:op.msgId,code:op.error?.code,status:op.error?.status})),localCommits:Object.values(this.state.localCommits).map(c=>({id:c.id,source:c.source,stage:c.stage,code:c.error?.code})),receipts:Object.values(this.state.receipts),drift:this.state.drift,pending: Boolean(this.state.pending), outboxSize: this.state.outbox.length }; }
    close() {
        if(this.closing)return this.closing;
        this.closing=(async()=>{
            await this.tail.catch(() => {});
            if(this.queue.syncPolicy===this)this.queue.configureSync(this.recoveryFence('SYNC_BRIDGE_CLOSED'));
            const key=stateKey(this.statePath);if(activePaths.get(key)===this)activePaths.delete(key);
        })();
        return this.closing;
    }
}
module.exports = { NativeSyncAdapter, validatePullPage };
