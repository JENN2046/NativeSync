# Windows 宿主兼容预检与全量接入升级清单

2026-11-03（Asia/Shanghai）；最后代码复核为 UTC 07:56:42。结论：**可以按固定清单推进；Windows 代码安装、Source 扩围和手机全量验收均尚未执行。** 本轮只有 SSH 后的只读宿主核对、本机公开源码适配和合成验证，没有停止 VCPChat、修改其 AppData、改生产配置或发起真实模型/工具请求。

目标为 QLL-6 的 `P:\AGENTS_OS_Workspace\runtime\VCPChat`，数据根为其 `AppData`。SSH 别名为 `qll6`；用 `ssh -F /home/jenn/.ssh/config`。目标 Git HEAD 为 `49e7ced6ab4d70ee8d6c55879b8458daddd95df1`，分支为 `codex/local-native-owner-binding-20261030`；本次核对的 tracked 代码路径未见未提交改动。Electron 包版本为 44.0.0，本次不升级 Electron、依赖或原生模块。此前封存的 Linux 宿主补丁不适用于这个 Windows 组合。

原生配置登记 4 个 Agent、1 个群聊、31 个话题，31 份历史文件均存在，总计 36,590,839 字节，最大单话题 18,573,519 字节。附件目录有 16 个文件、41,841,204 字节，没有磁盘单文件超过 20 MiB；这不是消息引用及附件同步完成证明。未读取聊天正文、导出系统提示词或复制桌面设置/凭据。

设备、Source、空间与生产原绑定一致。当前 Source 是 limited 两话题，`publishExecutionConfigs=false`、附件同步关闭，尚无 `executionMode`。最后本地 cursor=417，Outbox/Inbox/pending/localCommits/drift 均为零；生产观测也无待导入、待提交或冲突。31 个话题加 5 个所有者的身份与其他 Source 定点核对，未发现归属碰撞。生产服务端附件能力已经开启，可用空间采样约 732 MiB；实际导入后仍须按占用和异常复核，不用文件夹体积冒充最终所需空间。

运行载荷沿用已安装生产候选 `a27f6019d931558a1914b719c6ff4a72b2217317`，原包 SHA256 为 `97fbdf0ca9d1dd62c5d84653cf6197bf34eb6a622ef73f16d49eec497ef76d6f`。84 项载荷不变；Windows 只使用其中 28 项桌面载荷。与现场相比，6 项一致、13 项需要替换、9 项需要新增。另有 3 处宿主补丁，合计 **25 项代码写入：16 替换、9 新增**。

| 类型 | 精确范围 | 处理 |
| --- | --- | --- |
| 现有且一致的载荷 | catalog、durableJson、initialImport、mergeTerminal、nativeTasks、sourceSnapshot | 保留，不覆盖 |
| 13 项载荷替换 | adapter、attachments、connection、executionConfigs、executionStatus、localAttachment、metadata、protocol、queries、runtime、sourceDirectory、sourceScope、sourceSync | 使用原候选对应文件；安装前逐项核对 before |
| 3 项运行模块新增 | contracts.generated.cjs、inboxPages.js、sourceExecutionPublication.js | 创建，目标已存在则拒绝覆盖 |
| 6 项设置 Feature 新增 | modules/nativeSyncSettings 下 feature.json、index.js、preloadApi.js、renderer.js、service.cjs、settings.css | 复用现有 Feature/设置/preload 框架 |
| main.js | 新增原生有效规则回调 | 复用 native normalizeOwner/resolveOverrides、Agent/群配置读取器与 Tavern store |
| Groupmodules/groupchat.js | 顺序群聊请求补 max_tokens | 保留 Windows 现有请求、轨迹及 JEV 接线 |
| modules/renderer/nativeExecutionStatus.js | 启动失败时显示具体降级原因 | 应用已验收的诊断补丁 |

全部 25 项 before/after、创建/替换类型见[机器清单](../provenance/windows-full-source-preflight-20261103.json)。[Windows 专用补丁](../compat/host-patches/VCPChat-qll6-full-source-20261103.patch)及[摘要/依赖约束](../compat/host-patches/VCPChat-qll6-full-source-20261103.json)仅适用于本次精确基线。

Windows 已有 HistoryMutationQueue、native-history IPC、原生删除提交、CDS 写边界、Feature 发现/注册、设置扩展和 preload registry。保留这些既有接线，不覆盖整个宿主。其 History 队列及 Feature 框架与已验证开发宿主对应文件一致；canonical/hash、DTO 及默认值均取自 Windows 实际公开源码并固定摘要。

启动顺序需要单独处理：Windows 在初始化 workspace/conversationContext 之前启动 NativeSync。直接照搬 Linux 的 `.resolve()` 回调会产生尚未初始化的窗口。本补丁保持早期 History 恢复边界的位置，使用原生 `normalizeOwner` 校验身份、原生配置读取器及 `resolveOverrides` 得到有效 rules；rules 的计算与 workspace 选择独立。单聊、群聊结果已与实际 Windows 原生完整 resolver 比较；读取失败不回退到全局规则。没有修改原生规则、覆盖设定或另造规则算法。

验证采用本机公开代码副本和临时合成资料。23 个 JavaScript 目标语法通过；3 个宿主文件独立应用补丁后逐字节匹配。4 项设置/IPC/接入保护检查通过；3 项有效规则/版本/实际 runtime 发布接线检查在补齐 Windows 原有公开依赖后通过。另核对早期规则可用、身份/路径拒绝、单聊/群聊原生等价、读取失败、Feature/preload 发现，以及顺序群聊实际请求参数包含 max_tokens。未运行历史大矩阵，没有运行真实 Windows Electron 新组合，也没有把 Linux 合成验证称为 Windows 安装或 Android 验收。

失败证据保留：最初公开夹具缺 canonical/hash，随后缺 DTO/defaults，相关测试因此加载失败；补齐 Windows 现场真实文件后，仅重跑失败的 3 项。产品运行文件未因此修改。最终复核 25 项安装目标加 12 项保留依赖，共 37 个路径，现场无漂移；Windows VCPChat 仍运行。

接入按以下顺序执行，实际操作前复核即时队列、目标摘要和生产在途状态：

1. 进入本次维护窗口，保存草稿，从 Windows 托盘正常退出 VCPChat，暂停新的生产请求；不强杀，也不把 sourcePaused 当作停机。确认所有已接受工作结清。
2. 在 Windows 私有备份目录保存 16 个旧代码文件、安装回执及非凭据连接前态；按现有备份方式保留聊天/附件和同步状态，备份不进入 Git 或交付包。生产用现有 SQLite backup API 做含已提交 WAL 的一致快照并只读体检。备份只作恢复证据，正常代码回退不得恢复数据库、state、游标或范围。
3. 依据机器清单安装 22 项变化载荷及 3 处宿主补丁。安装器只改代码；配置变更作为后续独立步骤。逐项复核 after，保护现有身份和其他宿主改动。
4. 保留原 Windows Source 的 scope，单独为它增加 `approvedScope:{mode:"full"}` 和 `executionMode:"all-supported"`。不修改 Linux Source、全局 Agent 映射或静态旧话题配置。沿用现有生产正常停启流程，使配置生效。
5. 客户端保留 sourceId/deviceId/spaceId/sourceRoot，明确设置 sourceScope full、executionMode all-supported、自动发布和附件开关；保存一次生成的 scopeTransition opId 与原 expectedScopeHash。通过原 SourceSync.verify 启动路径发起受控 CAS；不得手工改 DB pin、直接覆盖 state.binding 或新建 Source。当前 limited Source 的设置页会正确保持 managed/read-only，不能把它当成“全新选定话题转全量”绕过转换。
6. 正常启动 Windows，核对扩围回执、原消息身份/进度保留、31 话题历史及后续发现。支持附件按真实消息引用、字节摘要确认；缺失或不支持单列。有效配置按原规则发布，桌面上下文/JEV/game 依赖仍显示不可续聊原因，不关闭原规则来制造可执行状态；不主动调用真实模型。
7. 原手机会话由既有范围转换事务冻结为旧精确话题权限，不能自动扩大。全量稳定后，另以明确 Source 范围生成新的手机配对；Windows 与 Linux 的联合配对也需要明确包含两者及未来内容的选择。

代码回退边界：若文件替换失败且新版尚未启动，按回执恢复 16 个旧文件，并仅移除本安装新增且摘要未变的 9 个文件；保留数据。若新版已启动或扩围已接受，原 Windows 旧代码组合的兼容降版尚未验证，不列为支持。它还会拒绝 executionMode/scopeTransition 等新增连接字段，不能直接退旧文件并恢复 limited 状态。此时保留已接受 full 范围和数据，以候选及本宿主补丁向前恢复；需要降版时另行验证只改代码/兼容配置、保持 full 读取的组合。

本轮产物是可审查的升级清单与宿主补丁，不是已上线回执。证据保留于 `/home/jenn/NativeSync/.local/windows-full-source-20261103`；未复制 Windows node_modules、聊天、浏览器配置、真实 SQLite 或凭据到本机。
