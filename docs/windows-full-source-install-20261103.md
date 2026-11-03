# Windows 全量升级：已安装部分与新增转换修复

2026-11-03（Asia/Shanghai）。用户已明确批准按[精确清单](windows-full-source-preflight-20261103.md)执行，并确认 Windows 正常退出、生产新请求暂停。**25 项 Windows 代码已安装；全量扩围仍未受理，31 话题导入尚未完成。** 这份记录不把源码修复、代码安装和全量接入混为同一结果。

安装前复核 QLL-6/617，Windows VCPChat PID 为零，37 个代码/依赖路径与清单匹配，连接摘要仍为 `c9ef83c39562c21518e28d7927897be351910abfe2ff2c34f84e234d2837e65c`；cursor=417，Outbox/Inbox/pending/localCommits/drift 均为零。生产模型、工具、AA 和未完成同步执行均为零。

Windows 私有备份为 `P:\NativeSync-Local-Backups\QLL6-full-20261103T082519399Z`：16 个旧代码文件、69 个聊天/附件/目录/同步状态文件、SQLite backup API 生成的原生聊天库一致快照均已保留。SQLite 快照 SHA256 为 `43f8d91c2f5c9aa0ac0ee39ae97b4dca48f8c484ba2270890c87f915219ca142`。代码安装完成后，25 个 after 摘要及 Windows Node v24.21.0 语法核对通过；69 个原数据文件与设置摘要未变。没有恢复任何数据。

首次通过 SSH 默认 Windows PowerShell 5.1 执行文件时被执行策略拒绝，未产生代码写入。核对 PowerShell 7 的现有有效策略为 RemoteSigned 后，以 PowerShell 7.6.9 正常执行本机生成脚本；未设置 Bypass，也未更改任何执行策略。

生产私有备份为 `/opt/AGENTS_OS_Workspace/backups/NativeSync/windows-full-source-20261103`。先正常停主服务，完成含已提交 WAL 的一致快照和零异常体检；412 条 messages、417 条 Journal/applied_ops、Source 绑定、手机会话/配对及 3 个旧执行记录均保留。快照 SHA256 为 `a10e30f83f89573c292b15d6aaf0880d1318b4a7df5d71b88ae940a79d9801fe`。仅为原 Windows grant 增加 approvedScope full 与 executionMode all-supported，配置摘要从 `c4334b1c4357cb5cc8d81e6d3bd87dbb5c2a2f2cf9695c310abc33c057a69df7` 变为 `a100a61f87ae6f0e87a09659731a2bb9e234cbf10810645ed10341de4fe414ab`。其他来源和静态话题配置保持；主服务新 PID 1687302 active/success，管理服务 PID 1233828 保持。

Windows 连接作为独立步骤保存：同一 sourceId/deviceId/spaceId/sourceRoot，明确 full、all-supported、附件和白名单配置发布，并保存稳定操作 ID `win_full_20261103_ccef75206691487dbf8950e80ba5807c`。连接 after SHA256 为 `0c3f33b879923fee5147532dc508372d4548d262a0c730a14268f574cc3a9d78`。state 字节未变，cursor 仍为417；没有手工修改本地 binding 或服务器范围 pin。

用户从原入口启动后，实际 Windows 进程已经运行，但 Source state 仍为原 limited 两话题，生产也没有转换回执。没有把新配置的 full 字段当作已接受的全量范围。新的 runtime 保留已知绑定的恢复保护，未自动重跑模型请求。现有远程会话缺少原生 JSO 启动变量，故没有用临时启动器替换用户原入口。

根因是服务端 `sync/sourceCatalog.js` 的 full 转换前置判断：只要 `source_catalog_entities` 中存在任何其他 Source 行，就报 SOURCE_IDENTITY_COLLISION。现有 Linux Source 因此足以挡住 Windows，尽管对 5 个所有者和31个话题的实际身份核对均无碰撞。它是转换路径原有的保守限制，不是本次数据损坏，也不是重试或改 opId 可以解决的问题。

本机修复仅移除这条“存在其他来源即拒绝”的判断，保留以下既有屏障：独立的 approvedScope full、设备/空间及旧 scope 摘要、已结清的旧话题、同一 SQLite 转换事务及回执、旧手机精确权限冻结、catalog 的真实归属唯一性，以及从各来源目录派生的 Pull/Push/基线范围。**full 授权受理不等于未知目录已获归属**；未来遇到真实同身份碰撞，catalog 仍原子拒绝，不把其他来源话题交给该客户端。

两个新增用例先在未修复服务夹具中复现 SOURCE_IDENTITY_COLLISION；修复后9项直接检查通过：多来源 full 转换、对等数据不变、旧手机/未使用配对仍限旧两话题、Source Pull 不读到对端内容、外来源 push/基线读取及目录抢占均被拒绝、重放/重开保持，以及既有批准/错误绑定/事务失败/响应丢失控制。所有数据和请求均为本机合成 loopback；未调用真实模型或工具，未重跑历史大矩阵。

这次服务端代码修复超出原25项 Windows 文件清单，**尚未安装生产**。新增目标仅为 `/opt/AGENTS_OS_Workspace/runtime/VCPToolBox/Plugin/NativeSync/sync/sourceCatalog.js`；不改协议格式、数据库结构或迁移，不删除其他来源，不放弃目录冲突检查。待明确批准该新增修复后，复核实时空闲和摘要、正常停启、按现有流程备份并只替换此文件。随后正常重开 Windows，使其按相同操作 ID 重新走原转换路径；不清状态、不换 Source、不撤回已接受事实。

当前生产仍以原两话题 pin 生效，现有账本和旧手机权限保持。下一步的结束证据应是：转换回执被接受、Windows binding full 持久化、31话题及真实附件引用完成或列明异常、原接受身份/哈希保留，并另作明确的新手机配对。上述证据当前尚未取得。

本机集中证据：`/home/jenn/NativeSync/.local/windows-full-source-20261103`，含 CODE_INSTALL、SOURCE_STAGE、PRODUCTION_GRANT_INSTALL、PRODUCTION_BEFORE_CLIENT_START、Windows progress、转换反例及9项回归。私有备份留在各自宿主，不进入 Git 或交付包。
