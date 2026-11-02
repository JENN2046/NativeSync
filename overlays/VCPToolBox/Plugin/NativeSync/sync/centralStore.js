'use strict';
const { DatabaseSync } = require('node:sqlite');
const { identity, stable, sha256, messageHash, tombstoneHash } = require('./protocol');
const {validateEnvelope,withFields,fieldsFrom,controlFields}=require('./metadata');

class SyncError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'SyncError';
    this.code = code;
    this.status = status;
  }
}
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function storageCorrupt(cause) {
  const error = new SyncError('SYNC_STORAGE_CORRUPT', 'Stored sync data failed integrity validation', 500);
  error.cause = cause;
  return error;
}
// Validate persisted facts before projecting them. A valid JSON document alone
// does not prove its identity, content digest, deletion or metadata authority.
function projectStoredMessage(row) {
  try {
    const id = identity({ownerType:row.owner_type,ownerId:row.owner_id,topicId:row.topic_id,msgId:row.msg_id});
    const seq = row.seq ?? row.last_seq;
    const action = Object.hasOwn(row,'action') ? row.action : row.deleted === 0 ? 'upsert' : row.deleted === 1 ? 'delete' : null;
    if (!Number.isSafeInteger(seq) || seq < 1 || !['upsert','delete'].includes(action) || !digest(row.hash) ||
        !Number.isSafeInteger(row.metadata_version) || row.metadata_version < 0 ||
        (row.metadata_version === 0 ? row.metadata_hash !== null : !digest(row.metadata_hash))) throw Error('Invalid stored columns');
    if (action === 'delete') {
      if (row.message_json !== null || row.metadata_version !== 0 || row.hash !== tombstoneHash(id)) throw Error('Invalid stored deletion');
      return null;
    }
    if (typeof row.message_json !== 'string') throw Error('Missing stored message');
    const message = JSON.parse(row.message_json);
    if (!message || Array.isArray(message) || typeof message !== 'object' || message.id !== id.msgId || messageHash(message) !== row.hash) throw Error('Invalid stored message');
    if (!row.metadata_version) {
      for (const key of ['_nativeSyncMetadata',...controlFields]) delete message[key];
      return message;
    }
    const envelope = validateEnvelope(message,message._nativeSyncMetadata);
    if (envelope.version !== row.metadata_version || envelope.hash !== row.metadata_hash) throw Error('Invalid stored metadata authority');
    return withFields(message,envelope);
  } catch (error) { throw storageCorrupt(error); }
}
function readStoredReceipt(json, expected) {
  try {
    const result = JSON.parse(json);
    if (!result || Array.isArray(result) || Object.keys(result).some(k=>!['seq','hash','deleted','metadataVersion','metadataHash'].includes(k)) ||
        !Number.isSafeInteger(result.seq) || result.seq < 1 || !digest(result.hash) || typeof result.deleted !== 'boolean' ||
        (result.metadataVersion !== undefined || result.metadataHash !== undefined) &&
          (result.deleted || !Number.isSafeInteger(result.metadataVersion) || result.metadataVersion < 1 || !digest(result.metadataHash)) ||
        expected && (result.hash !== expected.hash || result.deleted !== expected.deleted)) throw Error('Invalid stored receipt');
    return result;
  } catch (error) { throw storageCorrupt(error); }
}
class CentralStore {
  constructor(filePath) {
    this.db = new DatabaseSync(filePath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS messages (
        owner_type TEXT NOT NULL, owner_id TEXT NOT NULL, topic_id TEXT NOT NULL,
        msg_id TEXT NOT NULL, hash TEXT NOT NULL, deleted INTEGER NOT NULL,
        message_json TEXT, last_seq INTEGER NOT NULL,
        PRIMARY KEY(owner_type, owner_id, topic_id, msg_id)
      );
      CREATE TABLE IF NOT EXISTS journal (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_type TEXT NOT NULL, owner_id TEXT NOT NULL, topic_id TEXT NOT NULL,
        msg_id TEXT NOT NULL, action TEXT NOT NULL, hash TEXT NOT NULL,
        message_json TEXT, device_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS applied_ops (
        device_id TEXT NOT NULL, op_id TEXT NOT NULL,
        request_hash TEXT NOT NULL, result_json TEXT NOT NULL,
        PRIMARY KEY(device_id, op_id)
      );
      CREATE INDEX IF NOT EXISTS idx_journal_topic ON journal(owner_type,owner_id,topic_id,seq);
      CREATE INDEX IF NOT EXISTS idx_journal_message ON journal(owner_type,owner_id,topic_id,msg_id,seq);
    `);
    // Legacy JSON never proves metadata publication authority. Only these
    // independently persisted columns, written in the same Journal transaction,
    // identify a validated envelope; existing rows start at version zero.
    for(const table of ['messages','journal']){
      const columns=this.db.prepare('PRAGMA table_info('+table+')').all();
      if(!columns.some(c=>c.name==='metadata_version'))this.db.exec('ALTER TABLE '+table+' ADD COLUMN metadata_version INTEGER NOT NULL DEFAULT 0');
      if(!columns.some(c=>c.name==='metadata_hash'))this.db.exec('ALTER TABLE '+table+' ADD COLUMN metadata_hash TEXT');
    }
    // Triggers enforce JSON syntax for both existing and fresh tables without
    // rebuilding a live ledger or changing old rows/sequence numbers. Semantic
    // validation remains in apply/projectStoredMessage; NULL is a tombstone.
    for (const [table,column,nullable] of [['messages','message_json',true],['journal','message_json',true],['applied_ops','result_json',false]]) {
      for (const event of ['INSERT','UPDATE']) this.db.exec(`CREATE TRIGGER IF NOT EXISTS nativesync_json_${table}_${event.toLowerCase()}
        BEFORE ${event} ON ${table} WHEN ${nullable ? `NEW.${column} IS NOT NULL AND` : ''} NOT json_valid(NEW.${column})
        BEGIN SELECT RAISE(ABORT,'NATIVESYNC_INVALID_JSON'); END;`);
    }
    this.findOp = this.db.prepare('SELECT request_hash, result_json FROM applied_ops WHERE device_id=? AND op_id=?');
    this.findMessage = this.db.prepare('SELECT * FROM messages WHERE owner_type=? AND owner_id=? AND topic_id=? AND msg_id=?');
    this.insertJournal = this.db.prepare('INSERT INTO journal(owner_type,owner_id,topic_id,msg_id,action,hash,message_json,device_id,metadata_version,metadata_hash) VALUES (?,?,?,?,?,?,?,?,?,?)');
    this.upsertMessage = this.db.prepare(`INSERT INTO messages(owner_type,owner_id,topic_id,msg_id,hash,deleted,message_json,last_seq,metadata_version,metadata_hash)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_type,owner_id,topic_id,msg_id) DO UPDATE SET
      hash=excluded.hash, deleted=excluded.deleted, message_json=excluded.message_json, last_seq=excluded.last_seq,metadata_version=excluded.metadata_version,metadata_hash=excluded.metadata_hash`);
    this.insertOp = this.db.prepare('INSERT INTO applied_ops(device_id,op_id,request_hash,result_json) VALUES(?,?,?,?)');
    // Scan routing columns only. Unauthorized message bodies are never loaded.
    this.pullStmt = this.db.prepare('SELECT seq,owner_type,owner_id,topic_id FROM journal WHERE seq > ? ORDER BY seq ASC LIMIT ?');
    this.readJournalSeqs = this.db.prepare('SELECT * FROM journal WHERE seq IN (SELECT value FROM json_each(?)) ORDER BY seq');
    const tuple = alias => ['owner_type','owner_id','topic_id','msg_id'].map((name,i)=>`${alias}.${name}=json_extract(w.value,'$[${i}]')`).join(' AND ');
    this.readProjections = this.db.prepare(`SELECT m.* FROM json_each(?) w JOIN messages m ON ${tuple('m')}`);
    // Both lookups are bounded by the requested identities, not the database.
    this.readProjectionHeads = this.db.prepare(`SELECT j.* FROM json_each(?) w JOIN journal j ON j.seq=json_extract(w.value,'$[4]') AND ${tuple('j')}`);
    this.readLatestSeqs = this.db.prepare(`SELECT w.value AS identity_key,(SELECT MAX(j.seq) FROM journal j WHERE ${tuple('j')}) AS seq FROM json_each(?) w`);
    this.headStmt = this.db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM journal');
  }
  apply(raw, authority = {}) {
    let id;
    try { id = identity(raw); } catch { throw new SyncError('INVALID_IDENTITY','Invalid message identity'); }
    if (!raw || typeof raw.deviceId !== 'string' || !raw.deviceId ||
        typeof raw.opId !== 'string' || !raw.opId ||
        !['upsert','delete'].includes(raw.action) ||
        (raw.baseHash !== null && (typeof raw.baseHash !== 'string' || !/^[a-f0-9]{64}$/.test(raw.baseHash)))) {
      throw new SyncError('INVALID_OPERATION', 'Invalid deviceId, opId, action or baseHash');
    }
    let message = null;
    if (raw.action === 'upsert') {
      if (!raw.message || raw.message.id !== id.msgId) {
        throw new SyncError('INVALID_MESSAGE', 'message.id must match msgId');
      }
      try { messageHash(raw.message); } catch (error) { throw new SyncError(error.code || 'INVALID_MESSAGE','Invalid message content'); }
      message = raw.message;
    }
    if(raw.metadata!==undefined&&!authority.metadataPublisher)throw new SyncError('METADATA_PUBLISHER_REQUIRED','Trusted metadata publisher required',403);
    if(raw.metadata!==undefined&&raw.action!=='upsert')throw new SyncError('INVALID_CONTROL_METADATA','Metadata is only valid on a live upsert',400);
    const incoming=raw.metadata===undefined?null:validateEnvelope(message,raw.metadata);
    if(message?._nativeSyncMetadata&&!incoming)throw new SyncError('VERSIONED_METADATA_REQUIRED','Stored metadata cannot be supplied without publication authority',409);
    const normalized = { ...id, deviceId: raw.deviceId, opId: raw.opId,
      action: raw.action, baseHash: raw.baseHash, message, ...(incoming?{metadata:incoming}:{}) };
    const requestHash = sha256(stable(normalized));
    const args = [id.ownerType, id.ownerId, id.topicId, id.msgId];
    const hash = raw.action === 'delete' ? tombstoneHash(id) : messageHash(message);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previousOp = this.findOp.get(raw.deviceId, raw.opId);
      if (previousOp) {
        if (previousOp.request_hash !== requestHash) {
          if(!digest(previousOp.request_hash))throw storageCorrupt(Error('INVALID_STORED_REQUEST_HASH'));
          throw new SyncError('IDEMPOTENCY_KEY_REUSED', 'opId reused for different content', 409);
        }
        const result = readStoredReceipt(previousOp.result_json,{hash,deleted:raw.action==='delete'});
        const accepted=this.db.prepare('SELECT * FROM journal WHERE seq=? AND owner_type=? AND owner_id=? AND topic_id=? AND msg_id=?').get(result.seq,...args);
        if(!accepted||accepted.hash!==result.hash||(accepted.action==='delete')!==result.deleted||accepted.metadata_version!==(result.metadataVersion||0)||accepted.metadata_hash!==(result.metadataHash||null))throw storageCorrupt(Error('RECEIPT_REFERENCE_INVALID'));
        this.projectRows([accepted]);
        this.db.exec('COMMIT');
        return { ...result, replayed: true };
      }
      const previous = this.findMessage.get(...args);
      const projected = previous ? this.projectMessage(previous) : null;
      let priorMetadata=previous?.metadata_version?projected._nativeSyncMetadata:null;
      let metadata=priorMetadata;
      if(incoming){
        if(previous?.deleted)throw new SyncError('METADATA_TOMBSTONED','Metadata cannot resurrect a deleted message',409);
        const version=priorMetadata?.version||0;
        if(incoming.version<version||incoming.version>version+1||(incoming.version===version&&incoming.hash!==priorMetadata.hash))throw new SyncError('METADATA_VERSION_CONFLICT','Expected consecutive metadata version',409);
        if(incoming.hash!==priorMetadata?.hash){
          if((previous?.hash??null)!==raw.baseHash)throw new SyncError('MESSAGE_CONFLICT','Metadata content binding changed',409);
          metadata=incoming;
        }
      }else if(message?.contextCompaction!==undefined||message?.tool_calls!==undefined||message?.tool_call_id!==undefined||message?.isThinking!==undefined||message?.continuity!==undefined){
        if(!priorMetadata)throw new SyncError('VERSIONED_METADATA_REQUIRED','Control metadata requires a versioned envelope',409);
      }
      if(message&&metadata){message=withFields(message,metadata);validateEnvelope(message,metadata);}
      // Serialize once: Journal and current projection receive the same bytes.
      const messageJson = message ? JSON.stringify(message) : null;
      const metadataChanged=(metadata?.hash||null)!==(priorMetadata?.hash||null);
      let seq;
      if (previous && previous.hash === hash && Boolean(previous.deleted) === (raw.action === 'delete') && !metadataChanged) {
        // Same materialized state. A fresh opId must not create duplicate journal entries.
        seq = Number(previous.last_seq);
      } else {
        if ((previous?.hash ?? null) !== raw.baseHash) {
          throw new SyncError('MESSAGE_CONFLICT', 'Expected message hash differs from central state', 409);
        }
        seq = Number(this.insertJournal.run(...args, raw.action, hash,
          messageJson, raw.deviceId,message&&metadata?metadata.version:0,message&&metadata?metadata.hash:null).lastInsertRowid);
        this.upsertMessage.run(...args, hash, raw.action === 'delete' ? 1 : 0,
          messageJson, seq,message&&metadata?metadata.version:0,message&&metadata?metadata.hash:null);
      }
      if(message)this.attachments?.associate(id,message,authority.attachmentPrincipal);
      const result = { seq, hash, deleted: raw.action === 'delete', ...(metadata&&raw.action!=='delete'?{metadataVersion:metadata.version,metadataHash:metadata.hash}:{}) };
      this.insertOp.run(raw.deviceId, raw.opId, requestHash, JSON.stringify(result));
      this.db.exec('COMMIT');
      return { ...result, replayed: false };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  pull(afterSeq, limit = 100, allowedTopics) {
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new SyncError('INVALID_CURSOR', 'afterSeq must be >= 0; limit must be 1..500');
    }
    if (allowedTopics !== undefined && (!Array.isArray(allowedTopics) || allowedTopics.some(key => typeof key !== 'string'))) {
      throw new SyncError('INVALID_TOPIC_SCOPE', 'Topic scope must be an array of identity keys', 403);
    }
    const allowed = allowedTopics === undefined ? null : new Set(allowedTopics);
    // LIMIT bounds the global scan, not just the authorized output. An empty
    // filtered page must still acknowledge precisely this scanned window.
    return this.readSnapshot(()=>{
      const window=this.pullStmt.all(afterSeq,limit),headSeq=Number(this.headStmt.get().seq),nextSeq=window.at(-1)?.seq??afterSeq;
      const seqs=window.filter(row=>!allowed||allowed.has(JSON.stringify([row.owner_type,row.owner_id,row.topic_id]))).map(row=>row.seq);
      const records=this.readProjected(()=>seqs.length?this.readJournalSeqs.all(JSON.stringify(seqs)):[]);
      const events=records.map(({row,message})=>({seq:Number(row.seq),ownerType:row.owner_type,ownerId:row.owner_id,topicId:row.topic_id,msgId:row.msg_id,action:row.action,hash:row.hash,message,sourceDevice:row.device_id}));
      return {events,headSeq,nextSeq,hasMore:nextSeq<headSeq};
    });
  }
  readSnapshot(read) {
    const own=!this.db.isTransaction;if(own)this.db.exec('BEGIN');
    try{
      const result=read();
      if(result&&typeof result.then==='function')throw Error('ASYNC_STORAGE_READ_SNAPSHOT');
      if(own)this.db.exec('COMMIT');return result;
    }catch(error){if(own&&this.db.isTransaction)this.db.exec('ROLLBACK');throw error;}
  }
  readProjected(readRows) {
    return this.readSnapshot(()=>{
      const rows=readRows(this.db),messages=this.projectRows(rows);
      return rows.map((row,i)=>({row,message:messages[i]}));
    });
  }
  projectRows(rows) {
    return this.readSnapshot(()=>{
      const key=row=>JSON.stringify([row.owner_type,row.owner_id,row.topic_id,row.msg_id]);
      const equivalent=(journal,projection)=>journal.hash===projection.hash&&(journal.action==='delete')===Boolean(projection.deleted)&&journal.metadata_version===projection.metadata_version&&journal.metadata_hash===projection.metadata_hash;
      const messages=[];
      for(const row of rows){try{identity({ownerType:row.owner_type,ownerId:row.owner_id,topicId:row.topic_id,msgId:row.msg_id});}catch(error){throw storageCorrupt(error);}}
      for(let offset=0;offset<rows.length;offset+=128){
        const page=rows.slice(offset,offset+128),keys=[...new Set(page.map(key))].map(JSON.parse),projections=this.readProjections.all(JSON.stringify(keys));
        const current=new Map(projections.map(row=>[key(row),row]));
        const heads=this.readProjectionHeads.all(JSON.stringify(projections.map(row=>[...JSON.parse(key(row)),row.last_seq]))),bySeq=new Map(heads.map(row=>[row.seq,row]));
        const latest=new Map(this.readLatestSeqs.all(JSON.stringify(keys)).map(row=>[JSON.stringify(JSON.parse(row.identity_key)),row.seq]));
        for(const projection of projections){
          const head=bySeq.get(projection.last_seq);
          if(!head||key(head)!==key(projection)||latest.get(key(projection))!==projection.last_seq||!equivalent(head,projection))throw storageCorrupt(Error('MESSAGE_REFERENCE_INVALID'));
        }
        for(const row of page){
          const projection=current.get(key(row));
          if(!projection)throw storageCorrupt(Error('JOURNAL_PROJECTION_INVALID'));
          if(Object.hasOwn(row,'action')){
            if(projection.last_seq<row.seq||projection.last_seq===row.seq&&!equivalent(row,projection))throw storageCorrupt(Error('JOURNAL_PROJECTION_INVALID'));
          }else if(row.last_seq!==projection.last_seq||row.hash!==projection.hash||row.deleted!==projection.deleted||row.metadata_version!==projection.metadata_version||row.metadata_hash!==projection.metadata_hash)throw storageCorrupt(Error('MESSAGE_REFERENCE_INVALID'));
        }
        // Only decode bodies after identity/head associations have passed.
        for(const row of projections)projectStoredMessage(row);
        for(const row of heads)projectStoredMessage(row);
        for(const row of page)messages.push(projectStoredMessage(row));
      }
      return messages;
    });
  }
  projectMessage(row) {
    return this.projectRows([row])[0];
  }
  metrics() {
    return {
      headSeq: Number(this.headStmt.get().seq),
      journalRows: Number(this.db.prepare('SELECT COUNT(*) AS n FROM journal').get().n),
      appliedOps: Number(this.db.prepare('SELECT COUNT(*) AS n FROM applied_ops').get().n),
      liveMessages: Number(this.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE deleted=0').get().n)
    };
  }
  close() { this.db.close(); }
}
module.exports = { CentralStore, SyncError, projectStoredMessage, readStoredReceipt };
