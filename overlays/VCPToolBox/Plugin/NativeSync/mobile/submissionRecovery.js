'use strict';
const { sha256, stable } = require('../sync/protocol');

// These hashes describe an authenticated observation. They are never accepted
// as credentials and do not replace the existing session-scoped idempotency key.
const sessionMarker = sessionId => sha256('native-sync-mobile-session-v1\0' + sessionId);
const entryId = (origin, serverUrl) => sha256('native-sync-mobile-entry-v1\0' + origin + '\0' + serverUrl);

function normalizeSubmission({ topicKey, kind, payload }) {
    const invalid = () => { throw Object.assign(new Error('INVALID_RECOVERY_SUBMISSION'), { code: 'INVALID_RECOVERY_SUBMISSION' }); };
    if (typeof topicKey !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(topicKey) || !payload || typeof payload !== 'object' || Array.isArray(payload)) invalid();
    if (typeof payload.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(payload.requestId)) invalid();
    if (kind === 'message') {
        if (Object.keys(payload).some(k => !['requestId', 'text', 'attachments'].includes(k)) || typeof payload.text !== 'string' || payload.text.length > 12000) invalid();
        const attachments = payload.attachments === undefined ? [] : payload.attachments;
        if (!Array.isArray(attachments) || attachments.length > 8 || attachments.some(id => typeof id !== 'string') || (!payload.text.trim() && !attachments.length)) invalid();
        return { topicKey, kind, payload: { requestId: payload.requestId, text: payload.text, attachments: [...attachments] } };
    }
    if (kind === 'invitation') {
        if (Object.keys(payload).some(k => !['requestId', 'agentId'].includes(k)) || typeof payload.agentId !== 'string' || !payload.agentId) invalid();
        return { topicKey, kind, payload: { requestId: payload.requestId, agentId: payload.agentId } };
    }
    invalid();
}

const payloadHash = submission => sha256(stable(normalizeSubmission(submission)));

function executionRecovery(row) {
    // An old row without the original durable payload cannot prove a match.
    if (typeof row?.request_payload !== 'string' || !row.request_payload || typeof row.session_id !== 'string' || !row.session_id) return undefined;
    const kind = row.kind === 'group_invitation' ? 'invitation' : row.kind == null || row.kind === 'group_message' ? 'message' : null;
    if (!kind) return undefined;
    try {
        const payload = JSON.parse(row.request_payload);
        if (payload?.requestId !== row.request_id) return undefined;
        return { version: 1, sessionMarker: sessionMarker(row.session_id), payloadHash: payloadHash({ topicKey: row.topic_key, kind, payload }), kind };
    } catch { return undefined; }
}

module.exports = { normalizeSubmission, payloadHash, sessionMarker, entryId, executionRecovery };
