const MAX_NATIVE_TASKS = 64;
const MAX_TOOL_INVOCATIONS = 256;
const MAX_RESULT_BYTES = 2 * 1024 * 1024;
const taskStates = new Set(['accepted', 'running', 'waiting', 'cancelling', 'completed', 'failed', 'cancelled', 'stopped', 'unknown']);
const terminalStates = new Set(['completed', 'failed', 'cancelled', 'stopped']);
const fail = (code = 'INVALID_NATIVE_TASK_STATUS') => Object.assign(Error(code), { code });
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function id(value, optional = false) {
    if (optional && (value === null || value === undefined)) return null;
    if (typeof value !== 'string' || !value || value.length > 512 || /[\x00-\x1f]/.test(value)) throw fail();
    return value;
}
function errorCode(value) {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string' || !/^[A-Z][A-Z0-9_]{0,79}$/.test(value)) throw fail();
    return value;
}
function projectTask(value, executionId) {
    if (!object(value) || value.executionId !== executionId || value.pluginName !== 'AgentAssistant' || !taskStates.has(value.state) ||
        !Number.isSafeInteger(value.revision) || value.revision < 0 || !Number.isSafeInteger(value.observedAt) || value.observedAt < 0 ||
        typeof value.reviewRequired !== 'boolean' || typeof value.reviewResolved !== 'boolean') throw fail();
    const nativeTaskId = id(value.nativeTaskId);
    const resultRef = value.resultRef == null ? null : value.resultRef;
    const resultHash = value.resultHash == null ? null : value.resultHash;
    if (resultRef !== null && (!object(resultRef) || resultRef.kind !== 'AgentAssistantArchive' || resultRef.nativeTaskId !== nativeTaskId || !terminalStates.has(value.state))) throw fail();
    if ((resultRef === null) !== (resultHash === null) || (resultHash !== null && (typeof resultHash !== 'string' || !/^[a-f0-9]{64}$/.test(resultHash)))) throw fail();
    if (value.summary != null && (typeof value.summary !== 'string' || value.summary.length > 2048 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value.summary))) throw fail();
    return {
        pluginName: 'AgentAssistant', nativeTaskId, executionId: id(executionId),
        stepId: id(value.stepId, true), invocationId: id(value.invocationId), recordId: id(value.recordId, true),
        agentBaseName: id(value.agentBaseName), state: value.state, nativeStatus: id(value.nativeStatus, true),
        revision: value.revision, resultRef: resultRef ? { kind: 'AgentAssistantArchive', nativeTaskId } : null,
        resultHash, summary: value.summary ?? null, observedAt: value.observedAt,
        reviewRequired: value.reviewRequired, reviewResolved: value.reviewResolved, errorCode: errorCode(value.errorCode),
    };
}
function projectNativeWork(row) {
    if (!object(row)) throw fail();
    const tasks = row.nativeTasks === undefined ? [] : row.nativeTasks;
    const calls = row.toolInvocations === undefined ? [] : row.toolInvocations;
    if (!Array.isArray(tasks) || tasks.length > MAX_NATIVE_TASKS || !Array.isArray(calls) || calls.length > MAX_TOOL_INVOCATIONS) throw fail();
    const toolInvocations = calls.map(value => {
        if (!object(value) || !['started', 'returned', 'error'].includes(value.state)) throw fail();
        return { invocationId: id(value.invocationId), pluginName: id(value.pluginName), stepId: id(value.stepId, true), recordId: id(value.recordId, true), state: value.state, errorCode: errorCode(value.errorCode) };
    });
    const invocations = new Map(toolInvocations.map(value => [value.invocationId, value]));
    if (invocations.size !== toolInvocations.length) throw fail();
    const nativeTasks = tasks.map(value => projectTask(value, row.id));
    if (new Set(nativeTasks.map(value => value.nativeTaskId)).size !== nativeTasks.length) throw fail();
    const group = row.kind === 'group_message' || row.kind === 'group_invitation';
    for (const task of nativeTasks) {
        const call = invocations.get(task.invocationId);
        if (!call || call.pluginName !== task.pluginName || call.stepId !== task.stepId || call.recordId !== task.recordId || (!group && task.stepId !== null)) throw fail();
    }
    return { nativeTasks, toolInvocations };
}
async function verifyNativeResult(value, executionId, expected, hash) {
    if (!object(value) || value.version !== 1 || value.executionId !== executionId || typeof value.content !== 'string') throw fail('INVALID_NATIVE_TASK_RESULT');
    const task = projectTask(value.task, executionId);
    if (!expected?.resultRef || !task.resultRef || task.nativeTaskId !== expected.nativeTaskId || task.invocationId !== expected.invocationId ||
        task.stepId !== expected.stepId || task.recordId !== expected.recordId || task.agentBaseName !== expected.agentBaseName || task.state !== expected.state || task.nativeStatus !== expected.nativeStatus || task.resultHash !== expected.resultHash || task.revision < expected.revision) throw fail('NATIVE_TASK_RESULT_MISMATCH');
    const bytes = new TextEncoder().encode(value.content);
    if (bytes.byteLength > MAX_RESULT_BYTES) throw fail('NATIVE_TASK_RESULT_TOO_LARGE');
    if (await hash(bytes) !== task.resultHash) throw fail('NATIVE_TASK_RESULT_HASH_MISMATCH');
    return { version: 1, executionId, task, content: value.content };
}

export { MAX_NATIVE_TASKS, MAX_TOOL_INVOCATIONS, MAX_RESULT_BYTES, projectNativeWork, verifyNativeResult };
export const nativeTaskLabels = { accepted:'AA 已登记，启动待核对', running:'AA 运行中', waiting:'AA 等待下一步', cancelling:'AA 正在取消', completed:'AA 已完成', failed:'AA 失败', cancelled:'AA 已取消', stopped:'AA 已停止（未成功完成）', unknown:'AA 状态未知，待核对' };
export const toolLabels = { started:'工具已开始，结果待核对', returned:'工具调用已返回', error:'工具调用返回错误' };
export async function resultHash(bytes) {
    if (!globalThis.crypto?.subtle) throw fail('NATIVE_TASK_RESULT_CRYPTO_UNAVAILABLE');
    return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
}
