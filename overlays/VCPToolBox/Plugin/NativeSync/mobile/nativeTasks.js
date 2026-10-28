'use strict';
const { createHash } = require('node:crypto');
const nativeContext = require('../../../modules/requestExecutionContext');
const terminalStates = new Set(['completed', 'failed', 'cancelled', 'stopped']);
const nativeTerminalStates = { Succeed: 'completed', Failed: 'failed', Cancelled: 'cancelled', Stopped: 'stopped' };
const liveStates = new Set(['accepted', 'running', 'waiting', 'cancelling', 'unknown']);
const fail = (code, status = 409) => Object.assign(new Error(code), { code, status });
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,160}$/.test(value);
const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');

// This is a projection of already accepted native calls, never a task runner.
// No arguments, prompts, full tool results or AA loop state are stored here.
class NativeTaskLinks {
    constructor(engine) {
        this.engine = engine;
        this.db = engine.db;
        this.closed = false;
        this.pending = null;
        this.nextReconcile = 0;
        this.db.exec('CREATE TABLE IF NOT EXISTS mobile_native_continuity_schema (id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL)');
        const version=this.db.prepare('SELECT version FROM mobile_native_continuity_schema WHERE id=1').get();
        if(version&&version.version!==1)throw fail('NATIVE_TASK_SCHEMA_UNSUPPORTED',503);
        if(!version)this.db.prepare('INSERT INTO mobile_native_continuity_schema(id,version) VALUES(1,1)').run();
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS mobile_native_invocations (
                invocation_id TEXT PRIMARY KEY, execution_id TEXT NOT NULL,
                step_id TEXT, native_request_id TEXT NOT NULL, plugin_name TEXT NOT NULL,
                record_id TEXT, state TEXT NOT NULL, error_code TEXT,
                created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_mobile_native_invocations_execution
                ON mobile_native_invocations(execution_id);
            CREATE TABLE IF NOT EXISTS mobile_native_tasks (
                plugin_name TEXT NOT NULL, native_task_id TEXT NOT NULL,
                execution_id TEXT NOT NULL, step_id TEXT, native_request_id TEXT NOT NULL,
                invocation_id TEXT NOT NULL, record_id TEXT, agent_base_name TEXT NOT NULL,
                state TEXT NOT NULL, native_status TEXT, revision INTEGER NOT NULL DEFAULT 0,
                result_ref TEXT, result_hash TEXT, summary TEXT,
                observed_at INTEGER NOT NULL, error_code TEXT,
                review_required INTEGER NOT NULL DEFAULT 0,
                review_resolved INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY(plugin_name,native_task_id)
            );
            CREATE INDEX IF NOT EXISTS idx_mobile_native_tasks_execution
                ON mobile_native_tasks(execution_id);
        `);
    }
    assertOpen() { if (this.closed) throw fail('NATIVE_TASK_PROJECTION_CLOSED', 503); }
    binding(executionId, stepId = null) {
        const job = this.engine.get(executionId);
        if (!job || !this.engine.topics.has(job.topic_key)) throw fail('NATIVE_TASK_PARENT_NOT_FOUND');
        if (stepId) {
            const step = this.db.prepare('SELECT job_id FROM mobile_execution_steps WHERE id=?').get(stepId);
            if (!step || step.job_id !== executionId) throw fail('NATIVE_TASK_PARENT_MISMATCH');
        }
        return { executionId, stepId, nativeRequestId: stepId || executionId };
    }
    identity(binding, data) {
        const nativeRequestId = data?.nativeRequestId || data?.requestId;
        if (nativeRequestId !== binding.nativeRequestId || !identifier(data?.invocationId) ||
            typeof data?.pluginName !== 'string' || !identifier(data.pluginName) ||
            (data.recordId != null && !identifier(data.recordId))) throw fail('NATIVE_TASK_IDENTITY_MISMATCH');
        return { ...binding, invocationId: data.invocationId, pluginName: data.pluginName, recordId: data.recordId ?? null };
    }
    hooks(executionId, stepId = null) {
        const binding = this.binding(executionId, stepId);
        return {
            onToolDispatch: data => this.dispatch(binding, data),
            onToolSettled: data => this.settled(binding, data),
            onTaskAccepted: data => this.accept(binding, data),
            onTaskObserved: data => this.observeBound(binding, data)
        };
    }
    dispatch(binding, data) {
        this.assertOpen();
        const id = this.identity(binding, data), now = Date.now();
        const prior = this.db.prepare('SELECT * FROM mobile_native_invocations WHERE invocation_id=?').get(id.invocationId);
        if (prior) {
            if (!this.sameInvocation(prior, id)) throw fail('NATIVE_INVOCATION_ID_REUSED');
            // The same native dispatch cannot silently be performed twice.
            throw fail('NATIVE_INVOCATION_ALREADY_DISPATCHED');
        }
        if (this.db.prepare('SELECT count(*) AS n FROM mobile_native_invocations WHERE execution_id=?').get(binding.executionId).n >= 256) throw fail('NATIVE_INVOCATION_LIMIT');
        this.db.exec('BEGIN IMMEDIATE');
        try {
            this.db.prepare("INSERT INTO mobile_native_invocations(invocation_id,execution_id,step_id,native_request_id,plugin_name,record_id,state,created_at,updated_at) VALUES(?,?,?,?,?,?,'started',?,?)")
                .run(id.invocationId, id.executionId, id.stepId, id.nativeRequestId, id.pluginName, id.recordId, now, now);
            this.db.prepare('UPDATE mobile_executions SET tool_started=1 WHERE id=?').run(binding.executionId);
            if (binding.stepId) this.db.prepare('UPDATE mobile_execution_steps SET tool_started=1 WHERE id=?').run(binding.stepId);
            this.db.exec('COMMIT');
        } catch (error) { this.db.exec('ROLLBACK'); throw error; }
        this.engine.fault('native-tool-dispatch-intent');
    }
    sameInvocation(row, id) {
        return row.execution_id === id.executionId && row.step_id === id.stepId &&
            row.native_request_id === id.nativeRequestId && row.plugin_name === id.pluginName &&
            row.record_id === id.recordId;
    }
    settled(binding, data) {
        this.assertOpen();
        const id = this.identity(binding, data), row = this.db.prepare('SELECT * FROM mobile_native_invocations WHERE invocation_id=?').get(id.invocationId);
        if (!row || !this.sameInvocation(row, id) || !['returned', 'error'].includes(data.outcome)) throw fail('NATIVE_INVOCATION_IDENTITY_MISMATCH');
        const code = typeof data.errorCode === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(data.errorCode) ? data.errorCode : null;
        if (row.state !== 'started') {
            if (row.state === data.outcome && row.error_code === code) return;
            throw fail('NATIVE_INVOCATION_RESULT_CONFLICT');
        }
        this.db.exec('BEGIN IMMEDIATE');
        try {
            this.db.prepare('UPDATE mobile_native_invocations SET state=?,error_code=?,updated_at=? WHERE invocation_id=?')
                .run(data.outcome, code, Date.now(), id.invocationId);
            // An accepted association is not evidence that AA reached launch.
            // Confirm the narrow error case before the parent tool error can be
            // handled as an ordinary model reply and release its Topic slot.
            if (data.outcome === 'error') {
                for (const task of this.db.prepare("SELECT * FROM mobile_native_tasks WHERE invocation_id=? AND state='accepted'").all(id.invocationId)) {
                    this.markUnknown(task, 'NATIVE_TASK_LAUNCH_UNCONFIRMED');
                }
            }
            this.db.exec('COMMIT');
        } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }
    accept(binding, data) {
        this.assertOpen();
        const id = this.identity(binding, data);
        if (id.pluginName !== 'AgentAssistant' || !identifier(data.nativeTaskId) ||
            typeof data.agentBaseName !== 'string' || !data.agentBaseName || data.agentBaseName.length > 160) throw fail('INVALID_NATIVE_TASK');
        const invocation = this.db.prepare('SELECT * FROM mobile_native_invocations WHERE invocation_id=?').get(id.invocationId);
        if (!invocation || !this.sameInvocation(invocation, id) || invocation.state !== 'started') throw fail('NATIVE_TASK_INVOCATION_REQUIRED');
        const prior = this.get(id.pluginName, data.nativeTaskId);
        if (prior) {
            if (!this.matches(prior, { ...id, nativeTaskId: data.nativeTaskId, agentBaseName: data.agentBaseName })) throw fail('NATIVE_TASK_ID_REUSED');
            return this.public(prior);
        }
        if (this.db.prepare('SELECT count(*) AS n FROM mobile_native_tasks WHERE execution_id=?').get(id.executionId).n >= 64) throw fail('NATIVE_TASK_LIMIT');
        this.db.prepare("INSERT INTO mobile_native_tasks(plugin_name,native_task_id,execution_id,step_id,native_request_id,invocation_id,record_id,agent_base_name,state,observed_at) VALUES(?,?,?,?,?,?,?,?,'accepted',?)")
            .run(id.pluginName, data.nativeTaskId, id.executionId, id.stepId, id.nativeRequestId, id.invocationId, id.recordId, data.agentBaseName, Date.now());
        this.engine.fault('native-task-accepted');
        return this.public(this.get(id.pluginName, data.nativeTaskId));
    }
    get(pluginName, nativeTaskId) {
        return this.db.prepare('SELECT * FROM mobile_native_tasks WHERE plugin_name=? AND native_task_id=?').get(pluginName, nativeTaskId);
    }
    matches(row, data) {
        return row.plugin_name === data.pluginName && row.native_task_id === data.nativeTaskId &&
            row.native_request_id === (data.nativeRequestId || data.requestId) &&
            row.invocation_id === data.invocationId && row.record_id === (data.recordId ?? null) &&
            row.agent_base_name === data.agentBaseName &&
            (data.executionId === undefined || row.execution_id === data.executionId) &&
            (data.stepId === undefined || row.step_id === data.stepId);
    }
    observeBound(binding, data) {
        this.assertOpen();
        const row = this.get(data?.pluginName, data?.nativeTaskId);
        if (!row || row.execution_id !== binding.executionId || row.step_id !== binding.stepId || !this.matches(row, data)) throw fail('NATIVE_TASK_IDENTITY_MISMATCH');
        return this.observe(row, data);
    }
    observe(row, data) {
        this.assertOpen();
        if (!this.matches(row, data) || (!terminalStates.has(data.state) && !liveStates.has(data.state))) throw fail('INVALID_NATIVE_TASK_OBSERVATION');
        const terminal = terminalStates.has(data.state);
        if (terminal && (data.schemaVersion !== 1 || data.revision !== 1 || nativeTerminalStates[data.nativeStatus] !== data.state || !/^[a-f0-9]{64}$/.test(data.resultHash || '') ||
            typeof data.resultRef !== 'string' || !data.resultRef || typeof data.summary !== 'string' || data.summary.length > 2048 ||
            !Number.isSafeInteger(data.endTime) || data.endTime <= 0)) throw fail('NATIVE_TASK_PROOF_REQUIRED');
        if (!terminal && data.revision !== 0) throw fail('INVALID_NATIVE_TASK_OBSERVATION');
        if (terminalStates.has(row.state)) {
            if (!terminal) return this.public(row); // late running cannot roll back a committed native terminal
            if (row.state === data.state && row.result_hash === data.resultHash && row.result_ref === data.resultRef && row.revision === data.revision) return this.public(row);
            this.db.prepare("UPDATE mobile_native_tasks SET review_required=1,review_resolved=0,error_code='NATIVE_TASK_OBSERVATION_CONFLICT' WHERE plugin_name=? AND native_task_id=?").run(row.plugin_name, row.native_task_id);
            throw fail('NATIVE_TASK_OBSERVATION_CONFLICT');
        }
        const unknown = data.state === 'unknown';
        const code = unknown ? (/^[A-Z][A-Z0-9_]{0,79}$/.test(data.errorCode || data.code || '') ? (data.errorCode || data.code) : 'NATIVE_TASK_RESULT_UNKNOWN') : null;
        const resolved = unknown && row.state === 'unknown' ? row.review_resolved : 0;
        this.db.prepare('UPDATE mobile_native_tasks SET state=?,native_status=?,revision=?,result_ref=?,result_hash=?,summary=?,observed_at=?,error_code=?,review_required=?,review_resolved=? WHERE plugin_name=? AND native_task_id=?')
            .run(data.state, typeof data.nativeStatus === 'string' ? data.nativeStatus.slice(0,80) : null, data.revision,
                terminal ? data.resultRef : null, terminal ? data.resultHash : null, terminal ? data.summary : null,
                Date.now(), code, unknown ? 1 : 0, resolved, row.plugin_name, row.native_task_id);
        this.engine.fault('native-task-projected');
        return this.public(this.get(row.plugin_name, row.native_task_id));
    }
    markUnknown(row, code) {
        if (terminalStates.has(row.state)) return;
        const resolved = row.state === 'unknown' ? row.review_resolved : 0;
        this.db.prepare("UPDATE mobile_native_tasks SET state='unknown',review_required=1,review_resolved=?,error_code=?,observed_at=? WHERE plugin_name=? AND native_task_id=?")
            .run(resolved, code, Date.now(), row.plugin_name, row.native_task_id);
    }
    queryInput(row, includeResult = false) {
        return { nativeTaskId: row.native_task_id, agentBaseName: row.agent_base_name,
            nativeRequestId: row.native_request_id, invocationId: row.invocation_id,
            recordId: row.record_id, ...(includeResult ? { includeResult: true } : {}) };
    }
    async reconcile(force = false) {
        if (this.closed || this.pending || (!force && Date.now() < this.nextReconcile)) return this.pending;
        this.nextReconcile = Date.now() + 2000;
        const rows = this.db.prepare("SELECT * FROM mobile_native_tasks WHERE state NOT IN ('completed','failed','cancelled','stopped')").all();
        this.pending = (async () => {
            for (const row of rows) {
                if (this.closed) return;
                try {
                    const proof = await nativeContext.queryNativeTask(row.plugin_name, this.queryInput(row));
                    if (this.closed) return;
                    if (!proof) this.markUnknown(this.get(row.plugin_name,row.native_task_id), 'NATIVE_TASK_RESULT_UNKNOWN');
                    else this.observe(this.get(row.plugin_name,row.native_task_id), proof);
                } catch (error) {
                    if (!this.closed) this.markUnknown(this.get(row.plugin_name,row.native_task_id),
                        error.code === 'NATIVE_TASK_PROVIDER_UNAVAILABLE' ? error.code : 'NATIVE_TASK_RESULT_UNVERIFIED');
                }
            }
            if (!this.closed) this.engine.wake();
        })().finally(() => { this.pending = null; });
        return this.pending;
    }
    public(row) {
        return { pluginName: row.plugin_name, nativeTaskId: row.native_task_id,
            executionId: row.execution_id, stepId: row.step_id, invocationId: row.invocation_id,
            recordId: row.record_id, agentBaseName: row.agent_base_name, state: row.state,
            nativeStatus: row.native_status, revision: row.revision,
            resultRef: row.result_ref ? { kind: 'AgentAssistantArchive', nativeTaskId: row.native_task_id } : null,
            resultHash: row.result_hash, summary: row.summary, observedAt: row.observed_at,
            reviewRequired: Boolean(row.review_required), reviewResolved: Boolean(row.review_resolved), errorCode: row.error_code };
    }
    list(executionId) {
        return this.db.prepare('SELECT * FROM mobile_native_tasks WHERE execution_id=? ORDER BY observed_at,native_task_id').all(executionId).map(row => this.public(row));
    }
    invocations(executionId) {
        return this.db.prepare('SELECT * FROM mobile_native_invocations WHERE execution_id=? ORDER BY created_at,invocation_id').all(executionId).map(row => ({
            invocationId: row.invocation_id, pluginName: row.plugin_name, stepId: row.step_id,
            recordId: row.record_id, state: row.state, errorCode: row.error_code }));
    }
    held(topicKey) {
        return this.db.prepare('SELECT tasks.execution_id AS id FROM mobile_native_tasks tasks JOIN mobile_executions jobs ON jobs.id=tasks.execution_id WHERE jobs.topic_key=? AND tasks.review_required=1 AND tasks.review_resolved=0 LIMIT 1').get(topicKey);
    }
    needsReview(executionId) {
        return Boolean(this.db.prepare('SELECT 1 FROM mobile_native_tasks WHERE execution_id=? AND review_required=1 AND review_resolved=0 LIMIT 1').get(executionId));
    }
    uncertainTools(executionId) {
        const job = this.engine.get(executionId);
        const rows = this.db.prepare('SELECT state FROM mobile_native_invocations WHERE execution_id=?').all(executionId);
        return rows.some(row => row.state !== 'returned') || (Boolean(job?.tool_started) && rows.length === 0);
    }
    unsettledTools(executionId,stepId) {
        const query='SELECT 1 FROM mobile_native_invocations WHERE execution_id=? AND state=\'started\'';
        return Boolean(stepId === undefined ? this.db.prepare(query+' LIMIT 1').get(executionId) :
            this.db.prepare(query+' AND step_id=? LIMIT 1').get(executionId,stepId));
    }
    acknowledge(executionId) {
        this.db.prepare('UPDATE mobile_native_tasks SET review_resolved=1 WHERE execution_id=? AND review_required=1').run(executionId);
    }
    async result(topicKey, executionId, nativeTaskId) {
        this.assertOpen();
        const job = this.engine.get(executionId), row = this.get('AgentAssistant', nativeTaskId);
        if (!job || job.topic_key !== topicKey || !row || row.execution_id !== executionId) throw fail('NATIVE_TASK_NOT_FOUND', 404);
        const proof = await nativeContext.queryNativeTask(row.plugin_name, this.queryInput(row, true));
        this.assertOpen();
        if (!proof || !this.matches(row, proof) || !terminalStates.has(proof.state) || typeof proof.resultContent !== 'string' || hash(proof.resultContent) !== proof.resultHash) throw fail('NATIVE_TASK_RESULT_UNVERIFIED');
        if(Buffer.byteLength(proof.resultContent,'utf8')>2*1024*1024)throw fail('NATIVE_TASK_RESULT_TOO_LARGE',413);
        const task = this.observe(this.get(row.plugin_name,row.native_task_id), proof);
        if (task.reviewRequired) throw fail('NATIVE_TASK_RESULT_UNVERIFIED');
        return { version: 1, executionId, task, content: proof.resultContent };
    }
    close() { this.closed = true; }
}
module.exports = { NativeTaskLinks, terminalStates };
