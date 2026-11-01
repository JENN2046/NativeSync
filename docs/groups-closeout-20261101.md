# NativeSync 群聊完整应用交付

群聊阶段完成，新候选已安装到固定本机开发环境 `/home/jenn/NativeSync-Dev`，实例正常运行。
只修复了一处宿主参数遗漏；NativeSync 的83项运行载荷与上一附件候选逐项相同。

## 修复与范围

桌面顺序群聊已经解析成员 maxOutputTokens 并生成 max_tokens，却在构造实际请求时遗漏该字段。
旧完整应用现场中，桌面两次请求未携带上限，而手机请求分别携带512和256。
修复在 `VCPChat/Groupmodules/groupchat.js` 的顺序请求中补传已解析的 max_tokens，
与原有人工邀请路径及PWA配置快照对齐。不改变模型解析、发言模式、步骤身份、超时或工具调度。

补丁有精确前后摘要，列为第三项宿主兼容补丁；前两项仍是启动诊断和Linux PDF兼容。
本机安装器增加该单一明确目标，没有目录覆盖。新目标存在未知修改时已实测拒绝，写入和备份均未发生。
未新增公开协议、数据库迁移、状态格式、恢复枚举或产品故障接口。

## 同一候选的验证

- 235/235联合回归与八项公共夹具安装/回退通过：`.local/groups-accepted-validation/`。
- 原有14项完整应用全部重新通过：`/var/tmp/nativesync-full-runtime-1000/runs/20261101T091303391988Z/`。
- 下列五项群聊专项，以及群聊数据上的安装/回退/再安装通过：
  `/var/tmp/nativesync-full-runtime-1000/runs/20261101T091127640442Z/`，原始回执共6行。

这些是分开的验证配置，不能把安装场景重复相加成新的功能总数。回执均引用同一MANIFEST摘要。
群聊配置用五个群话题和三个Agent话题，仍为8个，没有放宽选择范围上限。

| 群聊专项 | 完整应用证据 |
| --- | --- |
| 顺序接力 | 桌面及PWA都按Beta→Alpha；三个回合共六次请求，模型/温度/输出上限一致；核对第二手机回合的完整上下文次序、双方全部消息身份/内容/哈希；重启无重派发 |
| 人工邀请 | 用户消息不会自动触发成员；PWA显式邀请只执行Beta；同请求重放不增加执行或虚假用户消息；拒绝非成员，JEV保持只读 |
| 自然随机计划恢复 | 已保存发言计划、用户消息尚未提交Journal时退出真实后端；恢复阶段禁止再次调用选择器，仍使用原计划、原步骤和原配置快照；每个已选成员只执行一次 |
| 步骤提交恢复 | 回复意图已保存与Journal已接受两个退出窗口；保留原replyId/stepId和配置快照；不重复执行已完成成员，只执行剩余已知步骤 |
| 未知效果与人工放弃 | 合成工具写入并fsync标记后退出后端；原群暂停且不重跑，另一群继续；第二会话不能取消/放弃；原PWA确认放弃后保留原因及旧attempts，只有新显式请求继续，副作用总计一次 |

真实安装场景还比较群计划、位置、步骤身份、attempts、人工处理标记与已接受附件事实。
模型调用记录和副作用标记跨后端重启保留，不仅检查终态或队列为空。
顺序群聊两端截图保存在群聊运行目录的 `evidence/group-sequential-desktop.png`、
`group-sequential-mobile.png`；已人工复核。组装、故障钩子与运行方式见包内GROUPS.md。

原失败现场保留：`/var/tmp/nativesync-full-runtime-1000/runs/20261101T090302924375Z/`。
该轮因桌面请求缺少max_tokens而失败，未改写或计入最终通过。

## 固定副本安装

固定副本只替换一个文件。安装、代码回退、再次安装后，原14条消息、连接配置、settings和state字节摘要一致，
消息/任务身份保留，启动没有调用模型。本轮未向固定副本再添加群组或改变已有设备同步范围；群聊验收使用新建的独立完整应用副本。

最终逐项核对83项运行文件及三项宿主补丁。当前cursor14、Outbox0、Inbox0、无同步/配置/附件错误，输入区可用。
回执：`/home/jenn/NativeSync-Dev/evidence/groups-accepted-installed.json`。

最新安装备份：`/home/jenn/NativeSync-Dev-Backups/groups-accepted-reinstalled-20261101`。
首次备份`groups-accepted-20261101`已经实际回退，状态为rolled-back。
最新备份回退只撤销此次群聊参数补丁，先前附件修复和PDF兼容仍保留。
全过程没有回退数据库、state、游标或聊天数据。

## 版本与交付

- 来源提交：`cf43bd00eca83fc44a6d947c3f94b9a59cdf64d1`，构建时工作树干净。
- 包目录：`.local/release-assembly/groups-accepted`。
- ZIP：`.artifacts/NativeSync_Groups_Accepted_20261101.zip`。
- ZIP SHA256：`7d9cc36351ac0cc3720004775015363df71678526377448199d4ab43f2f8f8c8`。
- MANIFEST SHA256：`22b5e135c40dd38f4de11f3f635d02218959a4e668c4a64ee51a3bd457ad8f4e`。
- 版本、回执、截图和安装备份对应关系：`provenance/groups-accepted-20261101.json`。

ZIP独立解包后，83项载荷和辅助文件完整校验通过。包内含GROUPS、ATTACHMENTS、SETTINGS、LOCAL_INSTALL说明，
宿主清单、三项兼容补丁及本机安装器。本机CONFIG已指向新候选。

验收限本机Linux Electron、Chrome移动视口、本地模拟模型与受控合成工具。
JEV/game没有新增手机执行支持；Windows、实体手机、真实业务工具和群聊内AA委托组合尚无本轮完整应用验收。
未连接服务器、调用付费模型、推送或合并；主开发副本仍保持9dc099b。
