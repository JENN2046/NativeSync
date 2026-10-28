// This store contains only unconfirmed submissions. It is not a chat cache or
// an execution queue: reconnecting can check records, but cannot send them.
export const SUBMISSION_STORAGE_KEY = 'vcp.nativeSync.submissions.v1';
export const MAX_PENDING_SUBMISSIONS = 16;
export const MAX_PENDING_BYTES = 256 * 1024;
const HEX = /^[a-f0-9]{64}$/;
const KINDS = new Set(['message', 'invitation']);
const RECORD_KEYS = ['version','origin','entryId','topicKey','requestId','kind','payload','sessionMarker','payloadHash','status','createdAt'];

function fail(code) { throw Object.assign(new Error(code), {code}); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exactKeys(value, keys) { return object(value) && Object.keys(value).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(value, key)); }
function boundedString(value, max) { return typeof value === 'string' && value.length > 0 && value.length <= max; }
function byteLength(value) { return new TextEncoder().encode(value).byteLength; }
export function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  return JSON.stringify(value);
}

export function validSessionRecovery(value) {
  return object(value) && value.version === 1 && HEX.test(value.entryId) && HEX.test(value.sessionMarker);
}

function clonePayload(kind, payload) {
  if (!KINDS.has(kind) || !object(payload) || !boundedString(payload.requestId, 80)) fail('SUBMISSION_INVALID');
  const keys = kind === 'message' ? ['requestId','text','attachments'] : ['requestId','agentId'];
  if (Object.keys(payload).some(key => !keys.includes(key))) fail('SUBMISSION_INVALID');
  if (kind === 'invitation') {
    if (!boundedString(payload.agentId, 256)) fail('SUBMISSION_INVALID');
    return {requestId:payload.requestId, agentId:payload.agentId};
  }
  if (typeof payload.text !== 'string' || payload.text.length > 12000) fail('SUBMISSION_INVALID');
  if (payload.attachments !== undefined && (!Array.isArray(payload.attachments) || payload.attachments.length > 8 || payload.attachments.some(id => !boundedString(id, 256)))) fail('SUBMISSION_INVALID');
  if (!payload.text.trim() && !payload.attachments?.length) fail('SUBMISSION_INVALID');
  return {requestId:payload.requestId, text:payload.text, ...(payload.attachments === undefined ? {} : {attachments:[...payload.attachments]})};
}

export async function submissionPayloadHash({topicKey, kind, payload}, cryptoApi = globalThis.crypto) {
  if (!boundedString(topicKey, 2048)) fail('SUBMISSION_INVALID');
  const original = clonePayload(kind, payload);
  const canonical = kind === 'message' ? {...original, attachments:original.attachments || []} : original;
  if (!cryptoApi?.subtle) fail('SUBMISSION_CRYPTO_UNAVAILABLE');
  const bytes = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(stable({topicKey, kind, payload:canonical})));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function validRecord(record, origin) {
  if (!exactKeys(record, RECORD_KEYS) || record.version !== 1 || record.origin !== origin || !HEX.test(record.entryId) || !HEX.test(record.sessionMarker) || !HEX.test(record.payloadHash) || !boundedString(record.topicKey, 2048) || !KINDS.has(record.kind) || record.status !== 'unconfirmed' || !Number.isSafeInteger(record.createdAt) || record.createdAt < 0) return false;
  try { return record.requestId === record.payload.requestId && stable(clonePayload(record.kind, record.payload)) === stable(record.payload); }
  catch { return false; }
}
function sameScope(a, b) { return a.origin === b.origin && a.entryId === b.entryId && a.topicKey === b.topicKey; }
function sameRecord(a, b) { return sameScope(a, b) && a.requestId === b.requestId && a.kind === b.kind && a.sessionMarker === b.sessionMarker && a.payloadHash === b.payloadHash && stable(a.payload) === stable(b.payload); }

export function createSubmissionRecovery({origin, getStorage = () => globalThis.localStorage, getLocks = () => globalThis.navigator?.locks, cryptoApi = globalThis.crypto, maxRecords = MAX_PENDING_SUBMISSIONS, maxBytes = MAX_PENDING_BYTES, now = Date.now} = {}) {
  if (!boundedString(origin, 2048) || origin === 'null') fail('SUBMISSION_INVALID');
  // Every page writes the same origin-wide record array, including different
  // entries/topics. Keep the entire read/modify/write/readback in one native
  // Web Lock; a per-page mutex or storage event cannot prevent lost updates.
  async function mutate(update) {
    let locks;
    try { locks = getLocks(); } catch { fail('SUBMISSION_LOCK_UNAVAILABLE'); }
    if (typeof locks?.request !== 'function') fail('SUBMISSION_LOCK_UNAVAILABLE');
    let entered = false;
    try {
      return await locks.request(SUBMISSION_STORAGE_KEY, {mode:'exclusive'}, () => {
        entered = true;
        return update();
      });
    } catch (error) {
      if (!entered) fail('SUBMISSION_LOCK_UNAVAILABLE');
      throw error;
    }
  }
  function readRaw() {
    try { return getStorage().getItem(SUBMISSION_STORAGE_KEY); }
    catch { fail('SUBMISSION_STORE_UNAVAILABLE'); }
  }
  function load() {
    const raw = readRaw();
    if (raw === null) return [];
    if (typeof raw !== 'string' || byteLength(raw) > maxBytes) fail('SUBMISSION_STORE_BUDGET');
    let data;
    try { data = JSON.parse(raw); } catch { fail('SUBMISSION_STORE_CORRUPT'); }
    if (!exactKeys(data, ['version','records']) || data.version !== 1 || !Array.isArray(data.records) || data.records.length > maxRecords || data.records.some(record => !validRecord(record, origin))) fail('SUBMISSION_STORE_CORRUPT');
    if (data.records.some((record, index) => data.records.slice(0, index).some(previous => sameScope(record, previous)))) fail('SUBMISSION_STORE_CORRUPT');
    return data.records;
  }
  function save(records) {
    const raw = JSON.stringify({version:1, records});
    if (records.length > maxRecords || byteLength(raw) > maxBytes) fail('SUBMISSION_STORE_BUDGET');
    try { getStorage().setItem(SUBMISSION_STORAGE_KEY, raw); }
    catch { fail('SUBMISSION_STORE_UNAVAILABLE'); }
    if (readRaw() !== raw) fail('SUBMISSION_STORE_UNVERIFIED');
  }
  function current({entryId, topicKey}) { return load().find(record => sameScope(record, {origin, entryId, topicKey})) || null; }
  function requireCurrent(record) {
    const saved = current(record);
    if (!saved || !sameRecord(saved, record)) fail('SUBMISSION_RECORD_CHANGED');
    return saved;
  }
  async function verify(record) {
    if (!validRecord(record, origin) || await submissionPayloadHash(record, cryptoApi) !== record.payloadHash) fail('SUBMISSION_STORE_CORRUPT');
    return record;
  }
  async function prepare({entryId, sessionMarker, topicKey, kind, payload}) {
    if (!validSessionRecovery({version:1, entryId, sessionMarker})) fail('SUBMISSION_RECOVERY_UNAVAILABLE');
    const original = clonePayload(kind, payload);
    const payloadHash = await submissionPayloadHash({topicKey, kind, payload:original}, cryptoApi);
    const record = {version:1, origin, entryId, topicKey, requestId:original.requestId, kind, payload:original, sessionMarker, payloadHash, status:'unconfirmed', createdAt:now()};
    return mutate(() => {
      const records = load(); // Reread after hashing AND after acquiring the cross-page lock.
      if (records.some(previous => sameScope(previous, record))) fail('SUBMISSION_PENDING');
      save([...records, record]);
      return requireCurrent(record);
    });
  }
  async function inspect(record, executions, session) {
    await verify(record);
    if (!validSessionRecovery(session) || session.entryId !== record.entryId || !Array.isArray(executions)) return {state:'review', reason:'metadata'};
    // The authorized topic endpoint returns its full, unpaginated execution
    // list. Messages in the same response have a separate history cursor.
    if (executions.some(job => !object(job) || job.topicKey !== record.topicKey)) return {state:'review', reason:'scope'};
    const candidates = executions.filter(job => job.requestId === record.requestId);
    if (!candidates.length) return session.sessionMarker === record.sessionMarker ? {state:'absent'} : {state:'review', reason:'session'};
    if (candidates.length !== 1) return {state:'review', reason:'ambiguous'};
    const execution = candidates[0], recovery = execution.recovery;
    if (!boundedString(execution.id, 256) || !boundedString(execution.state, 80) || !object(recovery) || recovery.version !== 1 || !HEX.test(recovery.sessionMarker) || !HEX.test(recovery.payloadHash) || !KINDS.has(recovery.kind)) return {state:'review', reason:'metadata'};
    if (recovery.sessionMarker !== record.sessionMarker || recovery.payloadHash !== record.payloadHash || recovery.kind !== record.kind) return {state:'review', reason:'conflict'};
    return {state:'confirmed', execution};
  }
  async function confirm(record, execution, session) {
    if ((await inspect(record, [execution], session)).state !== 'confirmed') fail('SUBMISSION_RECEIPT_UNVERIFIED');
    return mutate(() => {
      const records = load(), index = records.findIndex(previous => sameScope(previous, record));
      if (index < 0) return false; // Another successful check already cleared this same record.
      if (!sameRecord(records[index], record)) fail('SUBMISSION_RECORD_CHANGED');
      save(records.filter((_, at) => at !== index));
      return true;
    });
  }
  return {load, current, prepare, verify, requireCurrent, inspect, confirm};
}
