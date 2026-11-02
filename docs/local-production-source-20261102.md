# 本机真实 VCPChat 全量接入生产：历史与附件读取交付

用户明确选择将本机日常VCPChat改连生产后端，随后选择保留“工作区目录感知”规则，本轮先交付全量历史与附件读取。不是将合成开发库当作真实来源。

## 当前结果

- 日常宿主：`/home/jenn/AGENTS_OS_Workspace/runtime/VCPChat`，资料目录为其`AppData`；聊天后端现为`https://vcp.skmt617.top/v1/chat/completions`。
- 初始盘点5个Agent、23个话题、325条消息。接入期间用户确认删除Baseline（2个话题、6条原历史），随后在JSO新建“NativeSync 接入验收”空话题。最终手机有效目录为**4个Agent、22个话题**，均历史就绪；群聊当前为0。
- 初始325条历史在中央账本中的身份、canonical内容hash全部匹配。Baseline按原生显式删除记录退出活动目录，已接受历史保留；不从备份恢复用户删除的目录。
- 14处附件引用对应13个不同文件，合计10,200,551字节；全部引用的中央文件字节摘要与原件一致。无本轮缺失或单文件超过20MiB的原件。
- 新建空话题自动发现并完成接入。桌面最终`cursor=376`，Outbox、Inbox、待提交、localCommits、drift均0，24份历史计划完成、无计划错误，原生删除记录已发布。
- 原生产47条messages / 50条Journal及回执的既有行均保留；最终全库373条messages / 376条Journal / 376条applied_ops，只读体检0异常。

## 版本、宿主适配与备份

日常宿主Git底座为`fb37badf5a302a6e8768a3e4b0b1e6d50efa085d`，原来未接入NativeSync且有本地未提交修改。先在代码副本中适配，保留凭据捕获、会话覆盖、立绘优化、音乐偏好、原音频端口及现存main.js增量；没有整棵覆盖日常宿主。

安装52个文件：28个已验收桌面载荷，加24个宿主接线文件。52项目标语法检查通过；接入设置15项、原宿主历史队列及单聊请求13项定向回归通过。压缩兼容补丁在独立目录应用后，24个结果文件逐字节匹配；安装后52项摘要复核通过。

精确宿主适配：[说明与前后摘要](../compat/host-patches/VCPChat-jenn-linux-fb37-native-sync.json)、[压缩补丁](../compat/host-patches/VCPChat-jenn-linux-fb37-native-sync.patch.gz)。补丁仅适用于所列before摘要；先`gzip -dc`解压，再在匹配副本中应用。不是通用上游补丁。

用户正常退出日常VCPChat后才安装，随后使用未改动的`/home/jenn/.local/bin/start-vcpchat`批准入口重启。没有关闭Electron沙箱。仅修改桌面`vcpServerUrl`、`vcpApiKey`两项，其余设置和既有JSO所有者绑定不变；Key未输出或另存为凭据文件。

本机私有备份：`/home/jenn/NativeSync-Local-Backups/production-full-source-20261102`。其中`native-chat-before.tar.gz`只备份Agents、AgentGroups、UserData、设置和Tavern配置，不复制浏览器Cookie、缓存或整个浏览器配置。备份SHA256 `3b14ee10847bf771181914c7ebf7bea322484a03af621ad9cbbf1f78a42b35cf`。代码备份及安装回执也在该目录；这些私有数据不进入Git或交付包。

## 生产授权与手机

为本机创建独立Source，显式批准full范围和`all-supported`配置发布，开启既有附件能力。通过原接入服务预览/保存：Source、设备、空间、来源根、目录数量及服务器能力均经核对。保留原Windows Source及其两话题范围，不将Windows与本机冒充同一来源。

手机通过官方配对接口建立新的本机Source会话，范围含本来源及未来新增内容。旧3条手机会话的权限记录经只读比对保持，新配对只使用一次；未读取或导出Cookie。原生产图标与Chrome使用同一生产域名，旧本机测试域名不承担此次接入。

实体Android经已授权USB调试核对：目录4个Agent / 22个话题，所有历史就绪，新空话题可见；页面刷新保持登录；随后从已安装的生产WebAPK入口打开，`display-mode: standalone=true`，DOM目录为4个Agent、API目录22话题，未刷新或重新配对即显示正确来源。代表图片733,912字节、文本6,155字节在真实手机页面预览及下载读取，HTTP200且SHA256匹配。通过产品“保存文件”按钮操作后，ADB在Download中找到两份匹配摘要的文件。文本追加了一次真实触摸事件核对；不把脚本click无用户激活导致的下载限制当作产品失败。未独立记录保存前文件列表，因此不宣称证明两份都是本次首次新建。

## 续聊边界与本轮修复

一次Nova验收请求已接受为seq376，唯一任务`job_4a56d224a768881187d3c35c6b935607`在派发前以`DESKTOP_CONTEXT_REQUIRED`失败，`attempts=1`、`request_dispatched=0`、`tool_started=0`，无AA或工具调用。新消息经Source Pull到达桌面，身份/hash一致；没有模型回复，不能称手机模型往返成功，也不自动重跑该失败请求。

最初把原因判断为原生提示词展开，后核对真实冻结快照纠正：系统提示词不含桌面占位符，**生效的全局Tavern规则“工作区目录感知”**包含工作区占位符。执行阶段正确拒绝，目录先前却仍显示部分话题可续聊。

修复`mobile/executionConfigs.js`：在Source配置发布及已有冻结快照读取时，核对展开后提示词、群设定/成员提示词和实际作用域生效的Tavern规则；停用或其他作用域的规则不误杀。legacy selected路径保持原规则。9项直接正负回归通过；未改同步协议、数据库迁移、任务状态或原提示词。

统一候选源码提交`222c164f37d5e46075cd61d604557734913f5e98`，84项载荷中仅上述一个服务端文件不同于`144e0dc`候选，83项相同。生产在实时空闲核对、一致备份、正常停启后仅替换这一文件；管理服务未重启。56项映射服务端载荷全部匹配新候选，日常桌面28项载荷亦一致。固定合成开发副本`NativeSync-Dev`本轮未升级，不将其旧证据冒充新补丁整机验收。

用户选择保留原规则，故最终**22个话题均准确显示DESKTOP_CONTEXT_REQUIRED，只读开放，续聊未验收通过**。17项发布错误来自原本身依赖桌面上下文的提示词；另外5项已接受配置也因全局规则被读取屏障判为不可续聊。没有清空异常或删除冻结配置制造全绿。

候选：[NativeSync_Source_Context_Readiness_20261102.zip](/home/jenn/下载/NativeSync_Source_Context_Readiness_20261102.zip)，SHA256 `62580f363888220ab28428c8bb0989cdd8fae8c6999f50c2328ad162affe41fa`。这份统一候选仍要求匹配宿主；不能用固定开发副本安装器盲目覆盖本机日常宿主或套用旧生产固定清单。

## 回退与后续

生产私有备份依次位于`/opt/AGENTS_OS_Workspace/backups/NativeSync/`下的：

- `production-linux-source-20261102`：新来源及附件配置前的私有配置与一致库快照。
- `production-linux-nova-alias-20261102`：为3个来源话题补原生Nova显式别名的配置回执。
- `production-source-context-readiness-20261102`：单文件校验修复的旧代码、一致快照及INSTALL.json。

这些是恢复证据，不是恢复数据库的许可。保留本机新Source、设备/空间、state、游标、已接受身份及用户删除记录；不恢复旧数据库或原生历史来撤销已接受事实。

日常宿主原代码没有NativeSync，直接退回整套旧代码不能承诺继续同步/写入保护，**本轮未声明或验证这种整套回退组合**。故障优先以本候选和原状态向前恢复；确需退单个代码文件时先结清、正常停止并核对INSTALL.json的before/after，保留原规则和全部数据。原生产安装器对配置摘要漂移仍会拒绝，不绕过其校验。

后续若要开放手机续聊，需另定可移植的会话配置或明确发布桌面上下文；本轮按用户选择保留现状。未执行远端Git推送、main合并、原Windows来源扩围或额外模型请求。没有创建定时后台监控。

机器记录：[local-production-source-20261102.json](../provenance/local-production-source-20261102.json)。本轮代码副本、定向测试和非敏感证据保留在`/home/jenn/NativeSync/.local/local-production-source-20261102`供审阅；早期仅检查别名展开的候选已移至该目录标为superseded，不作为交付。私有配对文件不打包。USB转发在收尾时移除。
