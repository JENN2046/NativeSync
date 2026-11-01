import { registerSettingsSection, requestSettingsSection } from '../settings/extensions.js';
import { section, custom } from '../settings/schema/kernel.js';

const messages = {
    SYNC_CONNECTION_REQUIRED: '同步已停用，原绑定与待同步数据保留。',
    APPROVED_HISTORY_SNAPSHOT_REQUIRED: '首次历史尚未确认，请检查并保存接入配置。',
    SYNC_HTTPS_REQUIRED: '请先在「服务器连接」中保存 HTTPS 地址。',
    EXISTING_DESKTOP_KEY_REQUIRED: '请先在「服务器连接」中保存访问 Key。',
    DESKTOP_BACKEND_IDENTITY_MISMATCH: '当前服务器连接与原同步绑定不一致，请恢复原连接后再操作。',
    SETUP_CONNECTION_CHANGED: '服务器连接已改变，请重新检查。',
    SETUP_CONFIG_CHANGED: '配置已被其他操作更新，请刷新后重新确认。',
    APPROVED_HISTORY_CHANGED: '所选历史在检查后发生了变化，请重新检查并确认。',
    SETUP_CONFIRMATION_REQUIRED: '请先检查连接与历史，并勾选确认。',
    SETUP_SERVER_TOPIC_REQUIRED: '服务端尚未配置这个话题的手机接续入口，请先完成服务端绑定。',
    SETUP_SCOPE_CHANGE_REQUIRED: '已有绑定的范围需要通过受控范围变更处理，不能在这里直接改写。',
    SETUP_SOURCE_READ_ONLY: '此环境由 Source 范围管理，本面板只显示状态。',
    SETUP_TOPIC_UNAVAILABLE: '所选话题已不存在，请刷新列表。',
    OWNER_PATH_ALIAS: '所选目录或文件存在路径别名，请先核对本机数据位置。',
    OWNER_PATH_CONFLICT: '所选话题映射到同一历史文件，请核对原生话题身份。',
    SETUP_BINDING_MISMATCH: '保存的配置与原同步身份不一致，已保留原数据并停止修改。',
    SETUP_RECOVERY_REQUIRED: '现有同步处于恢复保护，不能作为全新接入处理；原绑定与数据会保留。',
    INVALID_SYNC_STATE: '同步状态需要核对；本面板不会重置数据或游标。',
    NETWORK_UNAVAILABLE: '服务器暂不可达，请检查连接后重试。',
    AUTH_FAILED: '服务器认证失败，请核对「服务器连接」中的 Key。',
    INITIAL_IMPORT_CONTENT_CONFLICT: '本机与服务器的同一消息内容不一致，已停止接入。',
    INITIAL_IMPORT_REMOTE_TOMBSTONE: '所选本机消息在服务器已有删除记录，已停止接入。',
    SETUP_DURABILITY_UNCONFIRMED: '配置内容已经写入，但持久确认未完成。请刷新核对，暂勿退出。',
    SETUP_SAVE_UNCONFIRMED: '保存结果未能确认，请刷新核对，暂勿退出。',
    ENOENT: '未找到已保存历史，请先在桌面打开并保存所选话题。',
};
const key = d => JSON.stringify([d.itemType || 'agent', d.itemId, d.topicId]);
const explain = code => messages[code] || `暂未完成，请核对后重试。（${code || 'SETUP_UNAVAILABLE'}）`;

function buildPanel(doc) {
    const panel = doc.createElement('div');
    panel.id = 'nativeSyncSetupPanel';
    panel.className = 'ns-setup';
    const api = doc.defaultView?.chatAPI || doc.defaultView?.electronAPI;
    const el = (tag, text, className) => {
        const node = doc.createElement(tag);
        if (text) node.textContent = text;
        if (className) node.className = className;
        return node;
    };
    const button = (id, label) => {
        const b = el('button', label, 'sidebar-button small-button');
        b.type = 'button'; b.id = id; return b;
    };
    const intro = el('p', '把电脑上的已保存话题接续到手机。首次接入会同步所选历史和手机续聊所需的助手设定（包括提示词）；遇到历史冲突会停止，不自动覆盖。访问 Key 沿用现有服务器设置。');
    const server = el('p'); server.id = 'nativeSyncServer';
    const connection = button('nativeSyncOpenConnection', '打开服务器连接设置');
    connection.onclick = () => requestSettingsSection('server-connection');
    const status = el('p'); status.id = 'nativeSyncCurrent'; status.setAttribute('role', 'status');
    const counts = el('p'); counts.id = 'nativeSyncCounts';
    const desired = el('label', '', 'ns-setup-switch');
    const enabled = el('input'); enabled.type = 'checkbox'; enabled.id = 'nativeSyncEnabled';
    desired.append(enabled, el('span', '下次启动启用同步'));
    const binding = el('p'); binding.id = 'nativeSyncBinding';
    const search = el('input'); search.type = 'search'; search.placeholder = '搜索助手、群聊或话题'; search.setAttribute('aria-label', search.placeholder); search.id = 'nativeSyncSearch';
    const selection = el('p'); selection.id = 'nativeSyncSelectionCount'; selection.setAttribute('aria-live', 'polite');
    const list = el('div', '', 'ns-setup-topics'); list.id = 'nativeSyncTopics'; list.setAttribute('aria-label', '可同步的话题');
    const review = el('section', '', 'ns-setup-review'); review.id = 'nativeSyncReview'; review.hidden = true;
    const reviewText = el('p');
    const confirmation = el('label', '', 'ns-setup-switch');
    const confirmed = el('input'); confirmed.type = 'checkbox'; confirmed.id = 'nativeSyncConfirmed';
    const confirmationText = el('span'); confirmation.append(confirmed, confirmationText); review.append(reviewText, confirmation);
    const actions = el('div', '', 'ns-setup-actions');
    const refresh = button('nativeSyncRefresh', '刷新状态');
    const preview = button('nativeSyncPreview', '检查连接与历史');
    const save = button('nativeSyncSave', '保存，重启后生效');
    actions.append(refresh, preview, save);
    const notice = el('p'); notice.id = 'nativeSyncNotice'; notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite');
    const quit = button('nativeSyncQuit', '退出 VCPChat'); quit.hidden = true;
    panel.append(intro, server, connection, status, counts, desired, binding, search, selection, list, review, actions, notice, quit);
    // This section has its own persistence authority; do not trigger global settings autosave.
    panel.addEventListener('input', event => event.stopPropagation());
    panel.addEventListener('change', event => event.stopPropagation());
    let view = null, approval = null, busy = false, selected = new Set();
    function invalidate() { approval = null; review.hidden = true; confirmed.checked = false; update(); }
    function update() {
        selection.textContent = view?.sourceMode ? '同步范围由 Source 配置管理' : `已选择 ${selected.size} / 8 个话题`;
        const blocked = !view || Boolean(view.error) || view.sourceMode;
        enabled.disabled = busy || blocked;
        preview.disabled = busy || blocked || !enabled.checked || !selected.size;
        save.disabled = busy || blocked || (!enabled.checked && !view?.configured) || (enabled.checked && (!approval || !confirmed.checked));
        refresh.disabled = busy;
        for (const input of list.querySelectorAll('input')) input.disabled = busy || blocked || view.bindingLocked || !enabled.checked;
    }
    function renderTopics() {
        list.replaceChildren();
        const choices = [...(view?.choices || [])];
        for (const d of view?.topics || []) if (!choices.some(c => key(c) === key(d))) choices.push({ ...d, ownerName: d.itemId, topicName: d.topicId });
        for (const topic of choices) {
            const label = el('label', '', 'ns-setup-topic');
            const input = el('input'); input.type = 'checkbox'; input.checked = selected.has(key(topic)); input.dataset.topicKey = key(topic);
            const copy = el('span'); copy.append(el('strong', topic.ownerName), el('small', `${topic.itemType === 'group' ? '群聊 · ' : ''}${topic.topicName}`));
            label.append(input, copy); label.dataset.search = `${topic.ownerName} ${topic.topicName}`.toLowerCase();
            input.onchange = () => {
                if (input.checked && selected.size >= 8) { input.checked = false; notice.textContent = '本模式最多选择 8 个话题。'; return; }
                if (input.checked) selected.add(key(topic)); else selected.delete(key(topic));
                invalidate();
            };
            list.append(label);
        }
        if (!choices.length) list.append(el('p', '还没有可选择的话题，请先在电脑上创建并保存话题。'));
        filter(); update();
    }
    function filter() { for (const row of list.querySelectorAll('[data-search]')) row.hidden = !row.dataset.search.includes(search.value.trim().toLowerCase()); }
    search.oninput = filter;
    async function load() {
        busy = true; update();
        try {
            const result = await api.nativeSyncSetupOverview();
            if (!result?.success) throw Error(result?.error || 'SETUP_UNAVAILABLE');
            view = result; enabled.checked = result.enabled;
            list.hidden = search.hidden = result.sourceMode;
            selected = new Set(result.topics.map(key)); invalidate();
            server.textContent = `服务器：${result.serverOrigin || result.backendOrigin || '尚未配置 HTTPS 连接'}`;
            const c = result.current;
            status.textContent = c.active ? '当前：同步已启动' : c.readOnly ? '当前：已绑定话题处于只读保护' : '当前：同步尚未启动';
            if (c.degraded) status.textContent += ` · ${explain(c.degraded)}`;
            if (result.restartRequired) status.textContent += ' · 配置已变更，重新启动后生效';
            counts.textContent = `本地待同步 ${c.pendingOperations ?? '待核对'} · 冲突 ${c.conflicts ?? '待核对'} · 已接收待写入 ${c.buffered ?? '待核对'}`;
            if (!c.active && !result.bindingLocked) counts.textContent = '尚未接入，接入后显示同步进度。';
            if (c.configurationError) counts.textContent += ` · ${explain(c.configurationError)}`;
            binding.textContent = result.sourceMode ? '当前采用 Source 范围管理，本面板只显示状态，不更改范围。' : result.bindingLocked ? '沿用已有设备和话题绑定。此处可停用或恢复；已有范围的变更需走受控范围流程。' : '首次接入请选择需要同步的话题，检查后再确认。';
            notice.textContent = result.error ? explain(result.error) : result.connectionError ? explain(result.connectionError) : '';
            if (!c.active && result.enabled && !result.restartRequired && result.topics[0] && api.getNativeExecutionStatus) {
                const d = result.topics[0];
                const runtime = await api.getNativeExecutionStatus(d.itemId, d.itemType, d.topicId, false);
                if (runtime?.degraded) status.textContent += ` · ${explain(runtime.degraded)}`;
            }
            quit.hidden = !result.restartRequired;
            renderTopics();
        } catch (error) { notice.textContent = explain(error.message); }
        finally { busy = false; update(); }
    }
    enabled.onchange = () => { invalidate(); notice.textContent = enabled.checked ? '先检查连接与历史，再确认保存。' : '保存后，下次启动停用同步；已有绑定、消息和待同步数据会保留。'; };
    confirmed.onchange = update;
    refresh.onclick = load;
    preview.onclick = async () => {
        busy = true; invalidate(); notice.textContent = '正在只读检查连接与所选历史…';
        try {
            const topics = [...selected].map(k => { const [itemType, itemId, topicId] = JSON.parse(k); return { itemType, itemId, topicId }; });
            const r = await api.nativeSyncSetupPreview({ expectedRevision: view.revision, topics });
            if (!r?.success) throw Error(r?.error || 'SETUP_UNAVAILABLE');
            approval = r.token;
            reviewText.textContent = r.existingState ? `已核对服务器 ${r.serverOrigin}，沿用 ${r.selectedTopics} 个话题的原绑定和同步进度。` : `已核对 ${r.selectedTopics} 个话题：本机 ${r.localMessages} 条消息，其中 ${r.identicalRemoteMessages} 条与服务器相同，${r.newLocalMessages} 条待上传，服务器另有 ${r.remoteOnlyMessages} 条待接收。`;
            confirmationText.textContent = r.existingState ? '确认使用原绑定恢复同步' : '确认将所选历史和手机续聊所需的助手设定同步到上述服务器';
            review.hidden = false; notice.textContent = '检查未修改本机历史或服务器数据。';
        } catch (error) { notice.textContent = explain(error.message); }
        finally { busy = false; update(); }
    };
    save.onclick = async () => {
        busy = true; update();
        try {
            const r = await api.nativeSyncSetupSave({ expectedRevision: view.revision, enabled: enabled.checked, ...(enabled.checked ? { approvalToken: approval, confirmed: confirmed.checked } : {}) });
            if (!r?.success) throw Error(r?.error || 'SETUP_UNAVAILABLE');
            await load();
            notice.textContent = r.warning ? explain(r.warning) : r.restartRequired ? '配置已保存。请退出后从原启动入口重新打开 VCPChat；当前运行配置尚未切换。' : '配置已保存，与当前运行配置一致。';
            quit.hidden = !r.restartRequired || Boolean(r.warning);
        } catch (error) { notice.textContent = explain(error.message); invalidate(); }
        finally { busy = false; update(); }
    };
    quit.onclick = () => api.closeApp?.();
    if (api?.nativeSyncSetupOverview) void load();
    else { notice.textContent = '此窗口未提供接入管理能力。'; update(); }
    return panel;
}

let installed = false;
export function install() {
    if (installed) return;
    installed = true;
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = new URL('./settings.css', import.meta.url).href; document.head.append(link);
    registerSettingsSection({ section: section('native-sync', 'NativeSync 接入', [custom('nativeSyncSetup', buildPanel)]), label: 'NativeSync', icon: 'refresh-cw' });
}
