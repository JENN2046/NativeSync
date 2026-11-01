'use strict';
const { invoke } = require('../../preloads/core/define');
module.exports = {
    handlers: ['modules/nativeSyncSettings/index.js'],
    roles: ['chat'],
    api: {
        nativeSyncSetupOverview: invoke('native-sync-setup:overview'),
        nativeSyncSetupPreview: invoke('native-sync-setup:preview', 'selection'),
        nativeSyncSetupSave: invoke('native-sync-setup:save', 'confirmation'),
    },
};
