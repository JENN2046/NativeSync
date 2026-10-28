'use strict';
const express = require('express');
const { randomBytes, randomUUID } = require('node:crypto');
const path = require('node:path');
const { identity } = require('../sync/protocol');
const { ConversationExecution, error, digest, historyReady } = require('./execution');
const { MobileConnection } = require('./connection');
const { entryId, sessionMarker } = require('./submissionRecovery');
const cookieName = '__Secure-vcp_mobile';
const protectedHttps = req => Boolean(req.socket?.encrypted) || (req.secure === true && ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket?.remoteAddress));
class MobilePortal {
    constructor({ store, config, agentManager }) {
        this.store = store; this.db = store.db;
        this.origin = new URL(config.NativeMobileOrigin).origin;
        if (!this.origin.startsWith('https://')) throw error('MOBILE_HTTPS_ORIGIN_REQUIRED');
        const list = JSON.parse(config.NativeMobileTopics || '[]');
        if (!Array.isArray(list) || (!list.length && !store.sourceCatalog?.grants.size) || list.length > 8) throw error('EXPLICIT_MOBILE_TOPICS_REQUIRED');
        this.topics = list.map(t => {
            identity({ ...t, msgId: '_' });
            if (!['agent','group'].includes(t.ownerType) || !/^[a-zA-Z0-9_-]{1,64}$/.test(t.key)) throw error('INVALID_MOBILE_TOPIC');
            if(t.ownerType==='group'&&config.NativeMobileConfigSync!==true)throw error('GROUP_EXECUTION_CONFIG_REQUIRED');
            return { ...t };
        });
        this.staticTopics=this.topics.map(t=>({...t}));
        this.sourceCatalog=store.sourceCatalog||null;
        this.refreshDirectoryTopics();
        if (new Set(this.topics.map(t=>t.key)).size !== this.topics.length) throw error('DUPLICATE_MOBILE_TOPIC');
        if (new Set(this.topics.map(t=>JSON.stringify([t.ownerType,t.ownerId,t.topicId]))).size !== this.topics.length) throw error('DUPLICATE_MOBILE_IDENTITY');
        const hours=Number(config.NativeMobileSessionHours ?? 8);
        if(!Number.isFinite(hours)||hours<1||hours>720)throw error('INVALID_MOBILE_SESSION_DURATION');
        this.db.exec(`CREATE TABLE IF NOT EXISTS mobile_pairings(hash TEXT PRIMARY KEY,expires INTEGER NOT NULL,scopes TEXT NOT NULL,used INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS mobile_sessions(hash TEXT PRIMARY KEY,id TEXT NOT NULL UNIQUE,expires INTEGER NOT NULL,scopes TEXT NOT NULL);`);
        if(!this.db.prepare('PRAGMA table_info(mobile_sessions)').all().some(c=>c.name==='last_topic_key'))this.db.exec('ALTER TABLE mobile_sessions ADD COLUMN last_topic_key TEXT');
        if(config.NativeMobileAttachments===true&&config.NativeMobileConfigSync!==true)throw error('ATTACHMENTS_REQUIRE_VERSIONED_CONFIG');
        this.attachments=config.NativeMobileAttachments===true?new (require('./attachments').AttachmentStore)({store,root:config.NativeSyncDataDir,topics:this.topics}):null;
        this.engine = new ConversationExecution({ store, topics: this.topics, agentManager, configRequired: config.NativeMobileConfigSync === true, startDelayMs: Math.max(0, Math.min(Number(config.NativeMobileStartDelayMs) || 0, 10000)), maxConcurrency: config.NativeMobileMaxConcurrency === undefined ? 4 : Number(config.NativeMobileMaxConcurrency), executionTimeoutMs: config.NativeMobileExecutionTimeoutMs === undefined ? 120000 : Number(config.NativeMobileExecutionTimeoutMs),groupIdleTimeoutMs:config.NativeMobileGroupIdleTimeoutMs===undefined?62000:Number(config.NativeMobileGroupIdleTimeoutMs) });
        this.agentManager = agentManager;
        this.connection = new MobileConnection(config, () => this.engine.endpoint?.key);
        this.sessionSeconds = Math.floor(hours * 3600);
        this.db.exec('CREATE TABLE IF NOT EXISTS mobile_catalog(topic_key TEXT PRIMARY KEY,metadata TEXT NOT NULL)');
        this.engine.attachments=this.attachments;
        this.router = express.Router();
        this.router.use((req, res, next) => {
            if (!protectedHttps(req)) return res.status(403).json({error:{code:'HTTPS_REQUIRED'}});
            res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
            res.set('X-Content-Type-Options', 'nosniff'); res.set('Referrer-Policy', 'no-referrer'); next();
        });
        this.router.use('/api', (req, res, next) => {
            res.set('Cache-Control', 'no-store');
            if (!req.secure) return next(error('HTTPS_REQUIRED', 403));
            if (req.method !== 'GET' && req.headers.origin !== this.origin) return next(error('ORIGIN_REJECTED', 403));
            next();
        }, express.json({ limit: '128kb', strict: true }));
        this.router.get('/api/connection', (_req,res) => res.json(this.connection.information()));
        this.router.post('/api/connection/test', (req,res,next) => { try { res.json(this.connection.test(req.body?.serverUrl)); } catch(e) { next(e); } });
        this.router.post('/api/connection/authenticate', async (req,res,next) => {
            try {
                await this.connection.authenticate(req.body, req.socket.remoteAddress);
                this.issueSession(res, JSON.stringify(this.staticTopics.map(t=>t.key)), this.currentSession(req)?.id);
            } catch(e) { if (req.body) delete req.body.apiKey; next(e); }
        });
        this.router.post('/api/pair', (req, res, next) => { try { this.pair(req, res); } catch (e) { next(e); } });
        this.router.use('/api', (req, _res, next) => {
            try {
                const row = this.currentSession(req);
                if (!row) throw error('PAIR_REQUIRED', 401);
                req.mobileSession = { id: row.id, scopes: JSON.parse(row.scopes), lastTopicKey: row.last_topic_key }; next();
            } catch (e) { next(e); }
        });
        this.router.get('/api/session', (req, res) => res.json({ authenticated: true, server: this.connection.information(), recovery: this.recoveryContext(req.mobileSession.id), selectedTopic: req.mobileSession.lastTopicKey || null, topics: this.hasSourceScope(req.mobileSession)?[]:this.catalog(req.mobileSession), agents:this.hasSourceScope(req.mobileSession)?[]:this.agents(req.mobileSession), directory:{version:1,paged:true,scopeMode:this.hasSourceScope(req.mobileSession)?'source':'selected'} }));
        this.router.post('/api/selection', (req,res,next) => {
            try{
                if(!req.body||Object.keys(req.body).some(k=>k!=='key')||!this.topics.some(t=>t.key===req.body.key&&this.topicAllowed(t,req.mobileSession)))throw error('TOPIC_NOT_ALLOWED',403);
                this.db.prepare('UPDATE mobile_sessions SET last_topic_key=? WHERE id=?').run(req.body.key,req.mobileSession.id);res.json({selectedTopic:req.body.key});
            }catch(e){next(e);}
        });
        this.router.post('/api/connection/disconnect', (req,res) => {
            this.db.prepare('DELETE FROM mobile_sessions WHERE id=?').run(req.mobileSession.id);
            res.setHeader('Set-Cookie',`${cookieName}=; Path=/mobile; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
            res.json({ disconnected: true, revoked: true });
        });
        this.router.get('/api/directory',(req,res,next)=>{try{res.json(this.directory(req.mobileSession,req.query));}catch(e){next(e);}});
        this.router.get('/api/agents', (req,res) => res.json({ agents: this.agents(req.mobileSession) }));
        this.router.get('/api/conversations', (req, res) => res.json({ topics: this.catalog(req.mobileSession) }));
        this.router.post('/api/conversations/:key/baseline',(req,res,next)=>{
            try{const topic=this.authorize(req);if(!this.sourceCatalog)throw error('SOURCE_PROTOCOL_UNAVAILABLE',409);if(!req.body||Object.keys(req.body).some(k=>k!=='requestId'))throw error('INVALID_CURSOR');res.json(this.sourceCatalog.beginMobile(req.mobileSession.id,topic,req.body.requestId));}catch(e){next(e);}
        });
        this.router.get('/api/conversations/:key/baseline/:id',(req,res,next)=>{
            try{const topic=this.authorize(req);if(!this.sourceCatalog)throw error('SOURCE_PROTOCOL_UNAVAILABLE',409);if(Object.keys(req.query).some(k=>!['after','limit'].includes(k)))throw error('INVALID_CURSOR');res.json(this.sourceCatalog.mobilePage(req.mobileSession.id,topic,req.params.id,Number(req.query.after||0),Number(req.query.limit||100)));}catch(e){next(e);}
        });
        this.router.get('/api/conversations/:key/events',(req,res,next)=>{
            try{const topic=this.authorize(req);if(Object.keys(req.query).some(k=>!['after','limit'].includes(k)))throw error('INVALID_CURSOR');const result=this.store.pull(Number(req.query.after||0),Number(req.query.limit||100),[JSON.stringify([topic.ownerType,topic.ownerId,topic.topicId])]);const state=this.catalog(req.mobileSession).find(t=>t.key===topic.key);res.json({...result,topic:{ownerType:topic.ownerType,ownerId:topic.ownerId,topicId:topic.topicId},executions:this.engine.list(topic.key,req.mobileSession.id),topicState:state});}catch(e){next(e);}
        });
        this.router.get('/api/conversations/:key', (req,res,next) => {
            try {
                const topic = this.authorize(req); const after = Number(req.query.after || 0);
                if (!Number.isSafeInteger(after) || after < 0) throw error('INVALID_CURSOR');
                const rows = this.db.prepare('SELECT last_seq AS seq,message_json,deleted,msg_id AS id,metadata_version,metadata_hash FROM messages WHERE owner_type=? AND owner_id=? AND topic_id=? AND last_seq>? ORDER BY last_seq LIMIT 201').all(topic.ownerType,topic.ownerId,topic.topicId,after);
                const page = rows.slice(0,200);
                const ready=historyReady(this.db,topic);
                res.json({ messages: page.map(r=>({seq:r.seq,id:r.id,deleted:Boolean(r.deleted),message:this.store.projectMessage(r)})), next:page.at(-1)?.seq??after, hasMore:rows.length>200, executions:this.engine.list(topic.key,req.mobileSession.id),topicState:{historyReady:ready,executable:this.catalog(req.mobileSession).find(t=>t.key===topic.key).executable,unavailableReason:this.catalog(req.mobileSession).find(t=>t.key===topic.key).unavailableReason,...this.engine.configs.public(topic.key)} });
            } catch(e) { next(e); }
        });
        this.router.post('/api/conversations/:key/messages', (req,res,next) => {
            try {
                const topic=this.authorize(req);
                this.requireSubmissionContext(req);
                if (!req.body || Object.keys(req.body).some(k=>!['requestId','text','attachments'].includes(k))) throw error('INVALID_SUBMISSION');
                res.status(202).json(this.engine.accept(req.mobileSession.id,{topicKey:topic.key,...req.body}));
            } catch(e) { next(e); }
        });
        this.router.post('/api/conversations/:key/invitations',(req,res,next)=>{try{const topic=this.authorize(req);this.requireSubmissionContext(req);if(!req.body||Object.keys(req.body).some(k=>!['requestId','agentId'].includes(k)))throw error('INVALID_GROUP_SUBMISSION');res.status(202).json(this.engine.invite(req.mobileSession.id,{topicKey:topic.key,...req.body}));}catch(e){next(e);}});
        this.router.get('/api/conversations/:key/executions/:id/native-tasks/:nativeTaskId/result',async(req,res,next)=>{
            try{
                const topic=this.authorize(req);
                // Read permission follows the authorized Topic across sessions;
                // this route grants no task control and accepts no result path.
                if(Object.keys(req.query).length)throw error('INVALID_NATIVE_TASK_QUERY');
                res.json(await this.engine.nativeTaskResult(topic.key,req.params.id,req.params.nativeTaskId));
            }catch(e){next(e);}
        });
        this.router.post('/api/executions/:id/resolve',(req,res,next)=>{try{if(!req.body||Object.keys(req.body).some(k=>k!=='action'))throw error('INVALID_REVIEW_RESOLUTION');res.json(this.engine.resolveReview(req.params.id,req.mobileSession.id,req.body.action));}catch(e){next(e);}});
        this.router.get('/api/groups',(req,res)=>res.json({groups:this.agents(req.mobileSession).filter(a=>a.ownerType==='group')}));
        this.router.post('/api/executions/:id/cancel', (req,res,next) => { try {res.status(202).json(this.engine.cancel(req.params.id,req.mobileSession.id));} catch(e) {next(e);} });
        this.router.use('/api/conversations/:key/attachments',require('./attachmentRoutes').attachmentRoutes({storage:()=>this.attachments,authorize:req=>this.authorize(req),principal:req=>'mobile:'+req.mobileSession.id}));
        this.router.use('/api', (_req,res) => res.status(404).json({error:{code:'NOT_FOUND'}}));
        const dist=path.resolve(config.NativeMobilePwaDir || path.join(__dirname,'../mobile-dist'));
        this.router.use(express.static(dist,{index:'index.html',dotfiles:'deny',maxAge:0,fallthrough:true}));
        this.router.use((_req,res)=>res.status(404).end());
        this.router.use((e,_req,res,_next)=>res.status(e.status||400).json({error:{code:e.code||'BAD_REQUEST'}}));
    }
    authorize(req) { const t=this.topics.find(t=>t.key===req.params.key && this.topicAllowed(t,req.mobileSession));if(!t)throw error('TOPIC_NOT_ALLOWED',403);return t; }
    recoveryContext(sessionId) { return { version: 1, entryId: entryId(this.origin, this.connection.information().serverUrl), sessionMarker: sessionMarker(sessionId) }; }
    requireSubmissionContext(req) {
        const entry = req.headers['x-nativesync-entry-id'], marker = req.headers['x-nativesync-session-marker'];
        if (entry === undefined && marker === undefined) return; // Existing clients keep their original contract.
        const current = this.recoveryContext(req.mobileSession.id);
        // This is a reject-only precondition after Cookie, Origin and Topic
        // authorization; these non-credential hashes cannot confer authority.
        if (typeof entry !== 'string' || !/^[a-f0-9]{64}$/.test(entry) || typeof marker !== 'string' || !/^[a-f0-9]{64}$/.test(marker) || entry !== current.entryId || marker !== current.sessionMarker) throw error('SUBMISSION_CONTEXT_CHANGED',409);
    }
    catalog(session) {
        return this.topics.filter(t=>this.topicAllowed(t,session)).map(t=>{
            const legacyMetadata=JSON.parse(this.db.prepare('SELECT metadata FROM mobile_catalog WHERE topic_key=?').get(t.key)?.metadata || '{}');
            const owner=t.sourceId?this.sourceCatalog.entity(t.sourceId,t.ownerType,t.ownerId,''):null;
            const row=t.sourceId?this.sourceCatalog.entity(t.sourceId,t.ownerType,t.ownerId,t.topicId):null;
            const metadata=owner&&row?{agentName:JSON.parse(owner.metadata).name,topicName:JSON.parse(row.metadata).name,avatar:JSON.parse(owner.metadata).avatar,updatedAt:null}:legacyMetadata;
            const ready=historyReady(this.db,t),published=this.engine.configs.public(t.key);let available=false,reason='SERVER_AGENT_NOT_CONFIGURED';
            try{if(t.ownerType==='group'){const snapshot=this.engine.configs.snapshot(t);if(!snapshot)reason='EXECUTION_CONFIG_REQUIRED';else if(!['sequential','naturerandom','invite_only'].includes(snapshot.group.mode))reason='GROUP_MODE_REQUIRES_DESKTOP';else available=true;}
            else {available=Boolean(t.agentAlias&&(published.model||t.model)&&this.agentManager.isAgent(t.agentAlias)&&(!this.engine.configs.required||this.engine.configs.snapshot(t)));reason=this.engine.configs.required&&!published.configVersion?'EXECUTION_CONFIG_REQUIRED':'SERVER_AGENT_NOT_CONFIGURED';}}catch(e){reason=e.code||'CONFIG_SNAPSHOT_CORRUPT';}
            if(!ready){available=false;reason='HISTORY_IMPORT_PENDING';}
            return {key:t.key,ownerId:t.ownerId,ownerType:t.ownerType,topicId:t.topicId,historyProtocol:this.sourceCatalog?2:1,...(t.sourceId?{sourceId:t.sourceId,archived:Boolean(t.archived),sourceState:t.sourceState||'available'}:{}),agentName:metadata.agentName||t.agentName||t.ownerId,topicName:metadata.topicName||t.topicName||t.topicId,avatar:metadata.avatar||null,updatedAt:metadata.updatedAt||null,model:t.model||null,historyReady:ready,executable:available,unavailableReason:available?null:reason,attachmentsEnabled:Boolean(this.attachments),...published,syncStatus:ready?(t.sourceId?'history-ready':'central'):'initial-import-pending',...this.db.prepare('SELECT count(*) AS messageCount,coalesce(max(last_seq),0) AS seq FROM messages WHERE owner_type=? AND owner_id=? AND topic_id=? AND deleted=0').get(t.ownerType,t.ownerId,t.topicId)};
        });
    }
    agents(session) {
        const topics=this.catalog(session),agents=new Map();
        for(const t of topics)if(!agents.has(JSON.stringify([t.ownerType,t.ownerId])))agents.set(JSON.stringify([t.ownerType,t.ownerId]),{id:t.ownerId,ownerType:t.ownerType,name:t.agentName,avatar:t.avatar,model:t.model,executable:t.executable,unavailableReason:t.unavailableReason});
        for(const sourceId of this.sourceIds(session))for(const owner of this.sourceCatalog.entities(sourceId,'agents')){
            if(owner.deleted)continue;const related=topics.filter(t=>t.sourceId===sourceId&&t.ownerType===owner.ownerType&&t.ownerId===owner.ownerId);
            agents.set(JSON.stringify([owner.ownerType,owner.ownerId]),{id:owner.ownerId,ownerType:owner.ownerType,name:owner.name,avatar:owner.avatar||null,executable:related.some(t=>t.executable),unavailableReason:related.length?'SERVER_AGENT_NOT_CONFIGURED':'NO_TOPICS',sourceId});
        }
        return [...agents.values()];
    }
    hasSourceScope(session){return session.scopes.some(k=>k.startsWith('source:'));}
    sourceIds(session){return session.scopes.filter(k=>k.startsWith('source:')).map(k=>k.slice(7)).filter(id=>this.sourceCatalog?.grants.has(id));}
    topicAllowed(topic,session){return !topic.directoryDeleted&&(session.scopes.includes(topic.key)||(topic.sourceId&&this.sourceIds(session).includes(topic.sourceId)));}
    refreshDirectoryTopics(){
        if(!this.sourceCatalog)return;
        const rows=this.db.prepare("SELECT * FROM source_catalog_entities WHERE topic_id<>''").all();
        for(const row of rows){
            const metadata=JSON.parse(row.metadata),owner=this.sourceCatalog.entity(row.source_id,row.owner_type,row.owner_id,'');
            let topic=this.topics.find(t=>t.key===metadata.key);
            if(!topic){topic={key:metadata.key,ownerType:row.owner_type,ownerId:row.owner_id,topicId:row.topic_id};this.topics.push(topic);}
            Object.assign(topic,{sourceId:row.source_id,archived:Boolean(metadata.archived),sourceState:metadata.sourceState,directoryDeleted:Boolean(row.deleted||!owner||owner.deleted)});
            this.engine?.topics.set(topic.key,topic);this.attachments?.topics.set(topic.key,topic);
        }
    }
    directory(session,query={}){
        if(Object.keys(query).some(k=>!['kind','cursor','limit','revision'].includes(k)))throw error('INVALID_DIRECTORY_QUERY');
        const agents=this.agents(session),topics=this.catalog(session);
        const stableTopics=topics.map(({messageCount,seq,updatedAt,...rest})=>rest);
        const revision=digest(JSON.stringify({agents,topics:stableTopics,scope:session.scopes}));
        if(query.revision&&query.revision!==revision)throw error('DIRECTORY_REVISION_CHANGED',409);
        const sourceProgress=this.sourceIds(session).map(sourceId=>({sourceId,...this.sourceCatalog.progress(sourceId)}));
        if(query.kind==='revision')return {version:1,revision,sourceProgress};
        if(!['agents','topics'].includes(query.kind))throw error('INVALID_DIRECTORY_QUERY');
        const limit=Number(query.limit||100);if(!Number.isSafeInteger(limit)||limit<1||limit>200)throw error('INVALID_DIRECTORY_QUERY');
        let after='';if(query.cursor){try{after=JSON.parse(Buffer.from(query.cursor,'base64url').toString('utf8'));if(typeof after!=='string'||after.length>1024)throw Error();}catch{throw error('INVALID_CURSOR');}}
        const key=row=>query.kind==='agents'?JSON.stringify([row.ownerType,row.id]):row.key;
        const rows=(query.kind==='agents'?agents:topics).sort((a,b)=>key(a)<key(b)?-1:key(a)>key(b)?1:0).filter(r=>key(r)>after);
        const page=rows.slice(0,limit);return {version:1,revision,[query.kind]:page,next:page.length?Buffer.from(JSON.stringify(key(page.at(-1)))).toString('base64url'):query.cursor||null,hasMore:rows.length>limit,sourceProgress};
    }
    publishCatalog(body) {
        if (!body || Object.keys(body).some(k=>k!=='topics') || !Array.isArray(body.topics) || body.topics.length>this.topics.length) throw error('INVALID_CATALOG');
        const rows=body.topics.map(row=>{
            if(Object.keys(row).some(k=>!['ownerId','ownerType','topicId','agentName','topicName','updatedAt','avatar'].includes(k)))throw error('INVALID_CATALOG');
            const topic=this.topics.find(t=>t.ownerId===row.ownerId&&t.ownerType===row.ownerType&&t.topicId===row.topicId);if(!topic)throw error('TOPIC_NOT_ALLOWED',403);
            if(typeof row.agentName!=='string'||row.agentName.length>200||typeof row.topicName!=='string'||row.topicName.length>500||!Number.isSafeInteger(row.updatedAt)||row.updatedAt<0)throw error('INVALID_CATALOG');
            if(row.avatar!=null&&(typeof row.avatar!=='string'||row.avatar.length>24000||!/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(row.avatar)))throw error('INVALID_AVATAR');
            return [topic.key,JSON.stringify({agentName:row.agentName,topicName:row.topicName,updatedAt:row.updatedAt,avatar:row.avatar||null})];
        });
        this.db.exec('BEGIN IMMEDIATE');try{const put=this.db.prepare('INSERT INTO mobile_catalog(topic_key,metadata) VALUES(?,?) ON CONFLICT(topic_key) DO UPDATE SET metadata=excluded.metadata');for(const row of rows)put.run(...row);this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}
        return {published:rows.length};
    }
    currentSession(req) {
        const values=String(req.headers.cookie||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(cookieName+'='));if(values.length!==1)return null;
        const token=values[0].slice(cookieName.length+1);if(!/^[a-zA-Z0-9_-]{43}$/.test(token))return null;
        const row=this.db.prepare('SELECT id,expires,scopes,last_topic_key FROM mobile_sessions WHERE hash=?').get(digest(token));return row&&row.expires>Date.now()?row:null;
    }
    issueSession(res,scopes,existingId) {
        const token=randomBytes(32).toString('base64url'),id=existingId||randomUUID();
        const selected=existingId?this.db.prepare('SELECT last_topic_key FROM mobile_sessions WHERE id=?').get(existingId)?.last_topic_key:null;
        this.db.exec('BEGIN IMMEDIATE');try{if(existingId)this.db.prepare('DELETE FROM mobile_sessions WHERE id=?').run(existingId);this.db.prepare('INSERT INTO mobile_sessions(hash,id,expires,scopes,last_topic_key) VALUES(?,?,?,?,?)').run(digest(token),id,Date.now()+this.sessionSeconds*1000,scopes,selected||null);this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}
        res.setHeader('Set-Cookie',`${cookieName}=${token}; Path=/mobile; HttpOnly; Secure; SameSite=Strict; Max-Age=${this.sessionSeconds}`);res.json({authenticated:true,server:this.connection.information()});
    }
    createPairing(options={},requestScope={}) {
        if(!options||Object.keys(options).some(k=>!['scopeMode','sourceId'].includes(k)))throw error('INVALID_PAIRING_SCOPE');
        let scopes=this.staticTopics.filter(t=>requestScope.topics===undefined||requestScope.topics.includes(JSON.stringify([t.ownerType,t.ownerId,t.topicId]))).map(t=>t.key);
        if(options.scopeMode!==undefined&&options.scopeMode!=='selected'&&options.scopeMode!=='source')throw error('INVALID_PAIRING_SCOPE');
        if(options.scopeMode==='source'){
            if(requestScope.topics!==undefined&&requestScope.source?.sourceId!==options.sourceId)throw error('SOURCE_SCOPE_MISMATCH',403);
            if(!this.sourceCatalog?.grants.has(options.sourceId))throw error('SOURCE_NOT_APPROVED',403);
            scopes=['source:'+options.sourceId];
        }else if(options.sourceId!==undefined)throw error('INVALID_PAIRING_SCOPE');
        const code=randomBytes(24).toString('base64url'),expiresAt=Date.now()+180000;
        this.db.prepare('INSERT INTO mobile_pairings(hash,expires,scopes) VALUES(?,?,?)').run(digest(code),expiresAt,JSON.stringify(scopes));
        return {pairingCode:code,expiresAt};
    }
    pair(req,res) {
        const code=req.body?.code;
        if(typeof code!=='string'||!/^[a-zA-Z0-9_-]{32}$/.test(code))throw error('INVALID_PAIRING',401);
        const hash=digest(code),now=Date.now();const grant=this.db.prepare('SELECT * FROM mobile_pairings WHERE hash=?').get(hash);
        if(!grant||grant.used||grant.expires<=now)throw error('INVALID_PAIRING',401);
        const token=randomBytes(32).toString('base64url'),id=randomUUID();
        this.db.exec('BEGIN IMMEDIATE');
        try {
            if(!this.db.prepare('UPDATE mobile_pairings SET used=1 WHERE hash=? AND used=0 AND expires>?').run(hash,now).changes)throw error('INVALID_PAIRING',401);
            this.db.prepare('INSERT INTO mobile_sessions(hash,id,expires,scopes) VALUES(?,?,?,?)').run(digest(token),id,now+this.sessionSeconds*1000,grant.scopes);this.db.exec('COMMIT');
        } catch(e){this.db.exec('ROLLBACK');throw e;}
        res.setHeader('Set-Cookie',`${cookieName}=${token}; Path=/mobile; HttpOnly; Secure; SameSite=Strict; Max-Age=${this.sessionSeconds}`);
        res.json({authenticated:true});
    }
    beginDrain(){this.engine.beginDrain();}
    async close(){await this.engine.close();await this.attachments?.close();}
    snapshot(){return {executions:this.engine.snapshot(),sessionCount:this.db.prepare('SELECT count(*) AS n FROM mobile_sessions').get().n};}
}
module.exports={MobilePortal,cookieName,protectedHttps};
