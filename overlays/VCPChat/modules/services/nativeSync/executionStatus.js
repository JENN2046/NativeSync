'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { durableJson } = require('./durableJson');
const { identity, sha256, fail } = require('./protocol');
const { projectNativeWork, verifyNativeResult } = require('./nativeTasks');

const MAX_EXECUTIONS = 128;
const MAX_CACHE_BYTES = 1024 * 1024;
const topicKey = topic => JSON.stringify([topic.ownerType, topic.ownerId, topic.topicId]);
function topicFor(d) {
    try {
        const { msgId, ...topic } = identity({ ownerType: d?.itemType, ownerId: d?.itemId, topicId: d?.topicId, msgId: '_' });
        return topic;
    } catch { throw fail('INVALID_EXECUTION_TOPIC'); }
}
const codeFor = (value, fallback) => /^[A-Z][A-Z0-9_]{0,79}$/.test(value || '') ? value : fallback;
function projectExecution(row) {
    const text = (value, optional = false) => {
        if (optional && (value === null || value === undefined)) return null;
        if (typeof value !== 'string' || !value || value.length > 512 || /[\x00-\x1f]/.test(value)) throw fail('INVALID_EXECUTION_STATUS');
        return value;
    };
    if (!row || !/^[a-z_]{1,40}$/.test(row.state || '') || !Number.isSafeInteger(row.attempts) || row.attempts < 0 || ![row.createdAt, row.updatedAt].every(v => Number.isSafeInteger(v) && v >= 0)) throw fail('INVALID_EXECUTION_STATUS');
    // Explicit projection: never cache submission, prompts, session markers,
    // credentials or any control capability returned by another server version.
    return {
        id: text(row.id), requestId: text(row.requestId), state: row.state,
        attempts: row.attempts, userMessageId: text(row.userMessageId, true),
        replyMessageId: text(row.replyMessageId, true),
        kind: row.kind === 'group_message' || row.kind === 'group_invitation' ? row.kind : 'message',
        errorCode: row.errorCode ? codeFor(row.errorCode, 'EXECUTION_ERROR') : null,
        createdAt: row.createdAt, updatedAt: row.updatedAt,
        reviewResolved: row.reviewResolved === true,
        ...projectNativeWork(row),
    };
}
function projectResponse(value, topic) {
    if (value?.version !== 1 || topicKey(value.topic || {}) !== topicKey(topic)) throw fail('EXECUTION_TOPIC_MISMATCH');
    if (!Number.isSafeInteger(value.observedAt) || value.observedAt < 0 || !Array.isArray(value.executions) || value.executions.length > 10000) throw fail('INVALID_EXECUTION_STATUS');
    const rows = value.executions.map(projectExecution);
    if (new Set(rows.map(row => row.id)).size !== rows.length) throw fail('INVALID_EXECUTION_STATUS');
    rows.sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || a.id.localeCompare(b.id));
    return { topic, observedAt: value.observedAt, executions: rows.slice(0, MAX_EXECUTIONS), total: rows.length, truncated: rows.length > MAX_EXECUTIONS };
}

// A bounded read-only view of the existing execution table. This cache has no
// History/Outbox authority and has a separate persistence queue and failure path.
class NativeExecutionStatus {
    static async open(options) {
        const service = new NativeExecutionStatus(options);
        try {
            await service.assertCachePath();
            const value = JSON.parse(await fs.readFile(service.file, 'utf8'));
            if (![1, 2].includes(value?.version) || (value.binding !== service.binding&&value.binding!==service.previousBinding) || !Array.isArray(value.topics)) throw fail('EXECUTION_CACHE_BINDING_CHANGED');
            const rows = new Map();
            if (value.topics.length > service.topics.length) throw fail('INVALID_EXECUTION_CACHE');
            for (const row of value.topics) {
                const key = topicKey(row?.topic || {});
                const topic = service.topics.find(t => topicKey(t) === key);
                if (!topic || rows.has(key) || !Array.isArray(row.executions) || row.executions.length > MAX_EXECUTIONS || !Number.isSafeInteger(row.total) || row.total < row.executions.length || row.truncated !== (row.total > row.executions.length)) throw fail('INVALID_EXECUTION_CACHE');
                const projected = projectResponse({ ...row, version: 1 }, topic);
                rows.set(key, { ...projected, total: row.total, truncated: row.truncated });
            }
            service.records = rows;
        } catch (error) {
            if (error.code !== 'ENOENT') service.loadError = codeFor(error.code, 'INVALID_EXECUTION_CACHE');
        }
        return service;
    }
    constructor({ connection, file, request, notify = () => {}, persist = durableJson }) {
        const endpoint = new URL(connection.url);
        if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) throw fail('PROTECTED_SYNC_ENDPOINT_REQUIRED');
        this.topics = connection.topics.map(d => topicFor({ ...d, itemType: d.itemType || 'agent' }));
        this.binding = sha256(JSON.stringify([endpoint.origin, connection.deviceId, connection.scopeMode==='source'?[connection.sourceId,connection.spaceId]:this.topics.map(topicKey).sort()]));
        this.previousBinding=connection.scopeMode==='source'&&connection.previousSelectedTopics?sha256(JSON.stringify([endpoint.origin,connection.deviceId,connection.previousSelectedTopics.map(d=>topicKey(topicFor({...d,itemType:d.itemType||'agent'}))).sort()])):null;
        this.file = file; this.request = request; this.notify = notify; this.persist = persist;
        this.records = new Map(); this.errors = new Map(); this.pending = new Map(); this.resultRequests = new Map();
        this.tail = Promise.resolve(); this.loadError = null;
    }
    async assertCachePath() {
        try {
            const dir = await fs.lstat(path.dirname(this.file));
            if (!dir.isDirectory() || dir.isSymbolicLink()) throw fail('EXECUTION_CACHE_ALIAS');
            const stat = await fs.lstat(this.file);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > MAX_CACHE_BYTES) throw fail('EXECUTION_CACHE_ALIAS');
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    assertTopic(d) {
        const topic = topicFor(d);
        if (!this.topics.some(t => topicKey(t) === topicKey(topic))) throw fail('TOPIC_NOT_ALLOWED');
        return topic;
    }
    read(d) {
        const topic = this.assertTopic(d), key = topicKey(topic), row = this.records.get(key);
        const error = this.errors.get(key) || (this.loadError ? { code: this.loadError } : null);
        return structuredClone({ version: 1, enabled: true, topic, freshness: row ? 'last-known' : 'unavailable', connection: error ? (error.code === 'NETWORK_UNAVAILABLE' ? 'offline' : 'error') : 'unverified', observedAt: row?.observedAt ?? null, executions: row?.executions || [], total: row?.total || 0, truncated: row?.truncated || false, error });
    }
    async refresh(d) {
        const topic = this.assertTopic(d), key = topicKey(topic);
        if (this.pending.has(key)) return this.pending.get(key);
        const run = (async () => {
            try {
                const query = new URLSearchParams(topic).toString();
                const row = projectResponse(await this.request('/api/plugins/NativeSync/mobile/executions?' + query), topic);
                const save = this.tail.then(async () => {
                    const next = new Map(this.records); next.set(key, row);
                    await this.assertCachePath();
                    const cache = { version: 2, binding: this.binding, topics: [...next.values()] };
                    if (Buffer.byteLength(JSON.stringify(cache)) > MAX_CACHE_BYTES) throw fail('EXECUTION_CACHE_BUDGET');
                    await this.persist(this.file, cache);
                    this.records = next;
                });
                this.tail = save.catch(() => {});
                await save;
                this.errors.delete(key); this.loadError = null;
                const result = { ...this.read(d), freshness: 'current', connection: 'online' };
                try { this.notify(structuredClone(result)); } catch {}
                return result;
            } catch (error) {
                this.errors.set(key, { code: codeFor(error.code, 'EXECUTION_STATUS_UNAVAILABLE'), ...(Number.isInteger(error.status) ? { status: error.status } : {}) });
                const result = this.read(d);
                try { this.notify(structuredClone(result)); } catch {}
                return result;
            }
        })().finally(() => this.pending.delete(key));
        this.pending.set(key, run);
        return run;
    }
    addTopics(descriptors){for(const d of descriptors){const topic=topicFor(d);if(!this.topics.some(t=>topicKey(t)===topicKey(topic)))this.topics.push(topic);}}
    async refreshAll() {
        await Promise.allSettled(this.topics.map(t => this.refresh({ itemId: t.ownerId, itemType: t.ownerType, topicId: t.topicId })));
    }
    async result(d, executionId, nativeTaskId) {
        const topic = this.assertTopic(d), key = topicKey(topic);
        if ([executionId, nativeTaskId].some(value => typeof value !== 'string' || !value || value.length > 512 || /[\x00-\x1f]/.test(value))) throw fail('INVALID_NATIVE_TASK_QUERY');
        const job = this.records.get(key)?.executions.find(row => row.id === executionId);
        const task = job?.nativeTasks.find(row => row.nativeTaskId === nativeTaskId);
        if (!task?.resultRef) throw fail('NATIVE_TASK_RESULT_UNAVAILABLE');
        const requestKey = JSON.stringify([key, executionId, nativeTaskId]);
        if (this.resultRequests.has(requestKey)) return this.resultRequests.get(requestKey);
        // Result text stays in the requesting view. Reading it never changes
        // History, the status cache, submission identity or execution state.
        const pending = (async () => {
            const route = '/api/plugins/NativeSync/mobile/executions/' + encodeURIComponent(executionId) + '/native-tasks/' + encodeURIComponent(nativeTaskId) + '/result?' + new URLSearchParams(topic);
            const value = await this.request(route);
            const result = await verifyNativeResult(value, executionId, task, bytes => require('node:crypto').createHash('sha256').update(bytes).digest('hex'));
            return { ...result, topic };
        })().finally(() => this.resultRequests.delete(requestKey));
        this.resultRequests.set(requestKey, pending);
        return pending;
    }
    async close() { await Promise.allSettled([...this.pending.values(), ...this.resultRequests.values()]); await this.tail; }
}

function localDelivery(adapter, d) {
    const state = adapter?.state;
    const same = op => op.ownerType === d.itemType && op.ownerId === d.itemId && op.topicId === d.topicId;
    const pending = (state?.outbox || []).filter(same);
    const commit = state?.localCommits?.[JSON.stringify({ ownerId: d.itemId, ownerType: d.itemType, topicId: d.topicId })];
    return { pendingOperations: pending.length, blockedOperations: pending.filter(op => op.status).length, pendingLocalCommit: Boolean(commit), localCommitStage: commit?.stage || null };
}

module.exports = { NativeExecutionStatus, localDelivery };
