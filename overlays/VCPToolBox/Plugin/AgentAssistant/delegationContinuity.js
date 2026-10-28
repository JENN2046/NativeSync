'use strict';

// Native AA result receipts live beside AA's existing report archives. Public
// plugin-callback files are deliberately not consulted as continuity authority.
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const STATES = Object.freeze({ Succeed: 'completed', Failed: 'failed', Cancelled: 'cancelled', Stopped: 'stopped' });
const FIELDS = ['pluginName', 'nativeTaskId', 'agentBaseName', 'nativeRequestId', 'invocationId', 'recordId'];
const HASH = /^[a-f0-9]{64}$/;
const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;

function failure(code) { return Object.assign(new Error(code), { code }); }
function identityOf(value) {
    const identity = Object.fromEntries(FIELDS.map(key => [key, value?.[key] ?? null]));
    if (identity.pluginName !== 'AgentAssistant' || !/^aa-delegation-\d+-[a-f0-9]{8}$/.test(identity.nativeTaskId || '') ||
        typeof identity.agentBaseName !== 'string' || !identity.agentBaseName || identity.agentBaseName.length > 160 ||
        /[\\/\0\r\n]/.test(identity.agentBaseName) || identity.agentBaseName === '.' || identity.agentBaseName === '..' ||
        !['nativeRequestId', 'invocationId'].every(key => typeof identity[key] === 'string' && identity[key] && identity[key].length <= 256) ||
        !(identity.recordId === null || (typeof identity.recordId === 'string' && identity.recordId.length <= 256))) {
        throw failure('NATIVE_TASK_IDENTITY_INVALID');
    }
    return identity;
}
function sameIdentity(left, right) { return FIELDS.every(key => (left?.[key] ?? null) === (right?.[key] ?? null)); }
function digest(value) { return createHash('sha256').update(value).digest('hex'); }
function syncDirectory(directory) {
    let fd;
    try { fd = fs.openSync(directory, 'r'); fs.fsyncSync(fd); }
    catch (error) { if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM'].includes(error.code)) throw error; }
    finally { if (fd !== undefined) fs.closeSync(fd); }
}
function publicReceipt(receipt, resultContent) {
    const result = Object.fromEntries([...FIELDS, 'schemaVersion', 'nativeStatus', 'state', 'revision', 'endTime',
        'resultRef', 'resultHash', 'archiveHash', 'summary'].map(key => [key, receipt[key]]));
    if (resultContent !== undefined) result.resultContent = resultContent;
    return result;
}

function createDelegationContinuity(projectRoot) {
    const directory = path.join(projectRoot, 'file', 'document', 'AgentTask');
    function locations(identity) {
        const name = `${identity.agentBaseName}_${identity.nativeTaskId}.md`;
        return {
            archive: path.join(directory, name),
            receipt: path.join(directory, `${identity.nativeTaskId}.native.json`),
            resultRef: `file/document/AgentTask/${name}`
        };
    }
    function read(identityValue, { includeResult = false } = {}) {
        const identity = identityOf(identityValue), location = locations(identity);
        let serialized;
        try {
            if (fs.statSync(location.receipt).size > 16 * 1024) throw failure('NATIVE_RESULT_INVALID');
            serialized = fs.readFileSync(location.receipt, 'utf8');
        } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
        let receipt;
        try { receipt = JSON.parse(serialized); } catch { throw failure('NATIVE_RESULT_INVALID'); }
        if (!sameIdentity(receipt, identity) || receipt.schemaVersion !== 1 || receipt.revision !== 1 ||
            !STATES[receipt.nativeStatus] || STATES[receipt.nativeStatus] !== receipt.state ||
            receipt.resultRef !== location.resultRef || !HASH.test(receipt.resultHash) || !HASH.test(receipt.archiveHash) ||
            !Number.isSafeInteger(receipt.endTime) || receipt.endTime <= 0 ||
            !Number.isSafeInteger(receipt.resultOffset) || receipt.resultOffset < 0 ||
            !Number.isSafeInteger(receipt.resultLength) || receipt.resultLength < 0) throw failure('NATIVE_RESULT_IDENTITY_MISMATCH');
        if (fs.statSync(location.archive).size > MAX_ARCHIVE_BYTES) throw failure('NATIVE_RESULT_TOO_LARGE');
        const archive = fs.readFileSync(location.archive);
        if (digest(archive) !== receipt.archiveHash || receipt.resultOffset + receipt.resultLength > archive.length) {
            throw failure('NATIVE_RESULT_HASH_MISMATCH');
        }
        const report = archive.subarray(receipt.resultOffset, receipt.resultOffset + receipt.resultLength);
        if (digest(report) !== receipt.resultHash) throw failure('NATIVE_RESULT_HASH_MISMATCH');
        return publicReceipt(receipt, includeResult ? report.toString('utf8') : undefined);
    }
    function persist(identityValue, { nativeStatus, endTime, archivePath, report }) {
        const identity = identityOf(identityValue), location = locations(identity);
        if (!STATES[nativeStatus] || archivePath !== location.resultRef || typeof report !== 'string' ||
            !Number.isSafeInteger(endTime) || endTime <= 0) throw failure('NATIVE_RESULT_UNCONFIRMED');
        if (fs.statSync(location.archive).size > MAX_ARCHIVE_BYTES) throw failure('NATIVE_RESULT_TOO_LARGE');
        const archiveFd = fs.openSync(location.archive, 'r+');
        let archive;
        try { archive = fs.readFileSync(archiveFd); fs.fsyncSync(archiveFd); }
        finally { fs.closeSync(archiveFd); }
        const reportBytes = Buffer.from(report);
        const suffix = Buffer.from(`## 最终执行结果\n\n${report}\n`);
        if (archive.length < suffix.length || !archive.subarray(archive.length - suffix.length).equals(suffix) ||
            !archive.toString('utf8', 0, 256).startsWith(`# 委托任务归档报告: ${identity.nativeTaskId}\n\n`)) {
            throw failure('NATIVE_RESULT_UNCONFIRMED');
        }
        const receipt = {
            schemaVersion: 1, ...identity, nativeStatus, state: STATES[nativeStatus], revision: 1, endTime,
            resultRef: location.resultRef, resultHash: digest(reportBytes), archiveHash: digest(archive),
            resultOffset: archive.length - reportBytes.length - 1, resultLength: reportBytes.length,
            summary: report.replace(/\s+/g, ' ').trim().slice(0, 800)
        };
        const serialized = JSON.stringify(receipt) + '\n';
        const temporary = path.join(directory, `.${identity.nativeTaskId}.${randomUUID()}.tmp`);
        let fd;
        try {
            fd = fs.openSync(temporary, 'wx', 0o600);
            fs.writeFileSync(fd, serialized, 'utf8');
            fs.fsyncSync(fd);
            fs.closeSync(fd); fd = undefined;
            // Link gives an atomic, non-overwriting publication of a terminal fact.
            try { fs.linkSync(temporary, location.receipt); }
            catch (error) {
                if (error.code !== 'EEXIST') throw error;
                if (fs.readFileSync(location.receipt, 'utf8') !== serialized) throw failure('NATIVE_RESULT_CONFLICT');
            }
            syncDirectory(directory);
        } finally {
            if (fd !== undefined) fs.closeSync(fd);
            try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        return read(identity);
    }
    return { persist, read };
}

module.exports = { createDelegationContinuity, identityOf, sameIdentity, STATES };
