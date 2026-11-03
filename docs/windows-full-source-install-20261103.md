# Windows 全量升级：已安装部分与新增转换修复

2026-11-03（Asia/Shanghai）。用户先批准按[精确清单](windows-full-source-preflight-20261103.md)执行，随后补充批准服务端单文件修复。**25项Windows代码及服务端修复均已安装，同一Source full转换已受理；32话题中29个历史就绪，仍不是全量交付完成。** 以下按阶段保留实际结果和剩余边界。


**补充授权后的最新状态（UTC 09:29，上海17:29）：** sourceCatalog.js修复已获批准并安装，服务PID1696555 active/success，管理服务未重启，配置保持a100摘要。备份`/opt/AGENTS_OS_Workspace/backups/NativeSync/windows-multisource-transition-fix-20261103`，一致SQLite快照SHA256 `a9bf76a07cc897a68b0234ed5289df70af145c02cd516116f26f0effa85fb941`。服务端56项运行载荷与新候选匹配，存储检查零异常。

Windows从用户确认的`P:\AGENTS_OS_Workspace\runtime\VCPChat\StartVCPchat.exe`重开后，原操作ID成功受理full转换，本地binding full已持久保存。共发现32话题，29个历史就绪；cursor=1073，Inbox69、Outbox0，三个未完成话题的断点和已接收记录保留。早期31话题是预检采样；维护备份/实际发现已包含新增的辅助对话。

剩余实际边界为两条超1MiB长文本和群聊中63个桌面活引用，后者没有普通原件内容哈希。它们不是SQLite字节损坏，不能静默删引用或截断正文。备份审计共809条原生消息；808条可规范化消息本地身份/哈希全部不变，另1条原始记录未变。服务器已匹配707条原始有效消息，101条有效消息及1条未规范消息尚未全部接入；现有原412条messages、417条Journal/applied_ops逐行保持。4个旧会话、11个配对身份保持，只有预期的一组旧来源动态权限冻结为原精确两话题，无越权扩大。

16处普通附件引用对应的本地原件哈希均匹配；服务器4处链接/文件哈希确认，12处仍未就绪。63个活引用及其约6.15MB历史提取文本仍在桌面，本轮没有访问实时工作区。手机新配对和Android本轮验收未进行。续聊配置仍有28项CONFIG_PROMPT_SNAPSHOT_UNAVAILABLE等限制，不通过改全局Agent映射掩盖。兼容施工范围需按[修订计划](windows-source-data-compat-plan-20261103.md)明确后再继续，当前不是全量交付完成。

安装前复核 QLL-6/617，Windows VCPChat PID 为零，37 个代码/依赖路径与清单匹配，连接摘要仍为 `c9ef83c39562c21518e28d7927897be351910abfe2ff2c34f84e234d2837e65c`；cursor=417，Outbox/Inbox/pending/localCommits/drift 均为零。生产模型、工具、AA 和未完成同步执行均为零。

Windows 私有备份为 `P:\NativeSync-Local-Backups\QLL6-full-20261103T082519399Z`：16 个旧代码文件、69 个聊天/附件/目录/同步状态文件、SQLite backup API 生成的原生聊天库一致快照均已保留。SQLite 快照 SHA256 为 `43f8d91c2f5c9aa0ac0ee39ae97b4dca48f8c484ba2270890c87f915219ca142`。代码安装完成后，25 个 after 摘要及 Windows Node v24.21.0 语法核对通过；69 个原数据文件与设置摘要未变。没有恢复任何数据。

首次通过 SSH 默认 Windows PowerShell 5.1 执行文件时被执行策略拒绝，未产生代码写入。核对 PowerShell 7 的现有有效策略为 RemoteSigned 后，以 PowerShell 7.6.9 正常执行本机生成脚本；未设置 Bypass，也未更改任何执行策略。

生产私有备份为 `/opt/AGENTS_OS_Workspace/backups/NativeSync/windows-full-source-20261103`。先正常停主服务，完成含已提交 WAL 的一致快照和零异常体检；412 条 messages、417 条 Journal/applied_ops、Source 绑定、手机会话/配对及 3 个旧执行记录均保留。快照 SHA256 为 `a10e30f83f89573c292b15d6aaf0880d1318b4a7df5d71b88ae940a79d9801fe`。仅为原 Windows grant 增加 approvedScope full 与 executionMode all-supported，配置摘要从 `c4334b1c4357cb5cc8d81e6d3bd87dbb5c2a2f2cf9695c310abc33c057a69df7` 变为 `a100a61f87ae6f0e87a09659731a2bb9e234cbf10810645ed10341de4fe414ab`。其他来源和静态话题配置保持；主服务新 PID 1687302 active/success，管理服务 PID 1233828 保持。

Windows 连接作为独立步骤保存：同一 sourceId/deviceId/spaceId/sourceRoot，明确 full、all-supported、附件和白名单配置发布，并保存稳定操作 ID `win_full_20261103_ccef75206691487dbf8950e80ba5807c`。连接 after SHA256 为 `0c3f33b879923fee5147532dc508372d4548d262a0c730a14268f574cc3a9d78`。state 字节未变，cursor 仍为417；没有手工修改本地 binding 或服务器范围 pin。

首次重开（服务端修复前），实际 Windows 进程已经运行，但 Source state 仍为原 limited 两话题，生产也没有转换回执。没有把新配置的 full 字段当作已接受的全量范围。新的 runtime 保留已知绑定的恢复保护，未自动重跑模型请求。现有远程会话缺少原生 JSO 启动变量，故没有用临时启动器替换用户原入口。

根因是服务端 `sync/sourceCatalog.js` 的 full 转换前置判断：只要 `source_catalog_entities` 中存在任何其他 Source 行，就报 SOURCE_IDENTITY_COLLISION。现有 Linux Source 因此足以挡住 Windows，尽管对 5 个所有者和31个话题的实际身份核对均无碰撞。它是转换路径原有的保守限制，不是本次数据损坏，也不是重试或改 opId 可以解决的问题。

本机修复仅移除这条“存在其他来源即拒绝”的判断，保留以下既有屏障：独立的 approvedScope full、设备/空间及旧 scope 摘要、已结清的旧话题、同一 SQLite 转换事务及回执、旧手机精确权限冻结、catalog 的真实归属唯一性，以及从各来源目录派生的 Pull/Push/基线范围。**full 授权受理不等于未知目录已获归属**；未来遇到真实同身份碰撞，catalog 仍原子拒绝，不把其他来源话题交给该客户端。

两个新增用例先在未修复服务夹具中复现 SOURCE_IDENTITY_COLLISION；修复后9项直接检查通过：多来源 full 转换、对等数据不变、旧手机/未使用配对仍限旧两话题、Source Pull 不读到对端内容、外来源 push/基线读取及目录抢占均被拒绝、重放/重开保持，以及既有批准/错误绑定/事务失败/响应丢失控制。所有数据和请求均为本机合成 loopback；未调用真实模型或工具，未重跑历史大矩阵。

这次服务端代码修复超出原25项 Windows 文件清单，**当时尚未安装生产；现已按补充批准完成，见顶部更新**。新增目标仅为 `/opt/AGENTS_OS_Workspace/runtime/VCPToolBox/Plugin/NativeSync/sync/sourceCatalog.js`；不改协议格式、数据库结构或迁移，不删除其他来源，不放弃目录冲突检查。待明确批准该新增修复后，复核实时空闲和摘要、正常停启、按现有流程备份并只替换此文件。随后正常重开 Windows，使其按相同操作 ID 重新走原转换路径；不清状态、不换 Source、不撤回已接受事实。

补充批准前，生产仍以原两话题 pin 生效，现有账本和旧手机权限保持。当时要求的结束证据为：转换回执被接受、Windows binding full 持久化、31话题及真实附件引用完成或列明异常、原接受身份/哈希保留，并另作明确的新手机配对。转换受理和full绑定现已取得；剩余历史、附件和手机证据尚未完成，见顶部更新。

本机集中证据：`/home/jenn/NativeSync/.local/windows-full-source-20261103`，含 CODE_INSTALL、SOURCE_STAGE、PRODUCTION_GRANT_INSTALL、PRODUCTION_BEFORE_CLIENT_START、Windows progress、转换反例及9项回归。私有备份留在各自宿主，不进入 Git 或交付包。

新增修复源码提交为 `79e2c3fbcb692cc8593b5d77306f2c5b22d8144e`。统一候选 `NativeSync_MultiSource_Transition_20261103.zip` 的 SHA256 为 `8204b9655c91d9cdfafdae4bb0f313d2d99b3dda22795952ad458910bad0308f`；84项运行文件中83项与原候选逐字节一致，只有 sourceCatalog.js 改变，38项支持文件和ZIP校验通过。生产目标 before 为 `efa70c1ab0c08ef2906dc4e04274cdc8dbba6f4c761a44b2dccddc833618f501`，拟安装 after 为 `7d957a3748cc4c776daa6d3f3e2d53801c285efabfd8590ca6f3bc4d3f04ba2b`；现场仍为 before。机器回执见[安装状态](../provenance/windows-full-source-install-20261103.json)。

补充附件诊断：16个原件本地哈希都匹配，不代表全部属于现有允许类型。已就绪话题中3处普通附件链接也尚未建立；其中首个上传为.ps1，服务端既有类型检测返回ATTACHMENT_TYPE_REJECTED，当前客户端把它当整轮错误而停止后续附件。9处未链接附件位于尚未完成的话题。后续应按原范围把不支持类型逐项报告并继续支持文件，不默默扩展格式。
