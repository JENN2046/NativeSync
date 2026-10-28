'use strict';
const owners = new WeakMap();

// Fixed, read-only IPC contract. The Bridge owns registration and cleanup.
function registerNativeSyncQueries({ipcMain,getRuntime}) {
    if (owners.has(ipcMain)) throw Object.assign(Error('SYNC_ALREADY_ATTACHED'),{code:'SYNC_ALREADY_ATTACHED'});
    const owner = {}, registered = [], pending = new Set();
    let stopped = false, closing;
    owners.set(ipcMain,owner);
    const register = (name, action, fallback) => {
        ipcMain.handle(name, (...args) => {
            if (stopped) return Promise.resolve({success:false,error:'SYNC_BRIDGE_CLOSED'});
            const operation = Promise.resolve().then(()=>action(...args)).catch(error=>({success:false,error:error.code || fallback}));
            pending.add(operation); operation.finally(()=>pending.delete(operation));
            return operation;
        });
        registered.push(name);
    };
    try {
        register('native-sync:executions',async (_event,itemId,itemType,topicId,refresh=true)=>{
            if (typeof refresh !== 'boolean') throw Object.assign(Error('INVALID_EXECUTION_QUERY'),{code:'INVALID_EXECUTION_QUERY'});
            const runtime=getRuntime();
            if (!runtime) return {success:true,enabled:false};
            return {success:true,...await runtime.getExecutionStatus({itemId,itemType,topicId},{refresh})};
        },'EXECUTION_STATUS_UNAVAILABLE');
        register('native-sync:task-result',async (_event,itemId,itemType,topicId,executionId,nativeTaskId)=>{
            if ([executionId,nativeTaskId].some(v=>typeof v!=='string'||!v||v.length>512||/[\x00-\x1f]/.test(v))) throw Object.assign(Error('INVALID_NATIVE_TASK_QUERY'),{code:'INVALID_NATIVE_TASK_QUERY'});
            const runtime=getRuntime();
            if (!runtime) throw Object.assign(Error('NATIVE_TASK_RESULT_UNAVAILABLE'),{code:'NATIVE_TASK_RESULT_UNAVAILABLE'});
            return {success:true,...await runtime.getNativeTaskResult({itemId,itemType,topicId},executionId,nativeTaskId)};
        },'NATIVE_TASK_RESULT_UNAVAILABLE');
    } catch (error) {
        for (const name of registered) ipcMain.removeHandler(name);
        if (owners.get(ipcMain) === owner) owners.delete(ipcMain);
        throw error;
    }
    return {
        close() {
            if (closing) return closing;
            stopped=true;
            closing=(async()=>{
                await Promise.allSettled([...pending]);
                if (owners.get(ipcMain) === owner) {
                    for (const name of registered) ipcMain.removeHandler(name);
                    owners.delete(ipcMain);
                }
            })();
            return closing;
        },
    };
}
module.exports = { registerNativeSyncQueries };
