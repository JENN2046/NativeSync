'use strict';
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const quitAdmission = require('../services/quitAdmission.cjs');
const { NativeSyncSettings } = require('./service.cjs');

function register(host) {
    const service = new NativeSyncSettings({ appDataRoot: host.appDataRoot, historyQueue: host.historyQueue, readSettings: host.readSettings });
    return registerIpc(host, service, require('electron').ipcMain);
}

function registerIpc(host, service, ipcMain) {
    const ipc = quitAdmission.guardIpcMain(ipcMain);
    const registered = [];
    const target = pathToFileURL(path.join(host.projectRoot, 'main.html')).href;
    const bind = (channel, action) => {
        ipc.handle(channel, async (event, input) => {
            const window = host.mainWindow;
            if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url.split(/[?#]/)[0] !== target) {
                return { success: false, error: 'SETUP_WINDOW_REQUIRED' };
            }
            try { return { success: true, ...await action(input) }; }
            catch (error) { return { success: false, error: /^[A-Z][A-Z0-9_]{0,79}$/.test(error.code || '') ? error.code : 'SETUP_UNAVAILABLE' }; }
        });
        registered.push(channel);
    };
    bind('native-sync-setup:overview', () => service.overview());
    bind('native-sync-setup:preview', input => service.preview(input));
    bind('native-sync-setup:save', input => service.save(input));
    return {
        async dispose() {
            await service.close();
            for (const channel of registered) ipc.removeHandler(channel);
        },
    };
}
module.exports = { register, registerIpc };
