# Source 数据 v2：Windows／生产安装与全量历史收尾

2026-11-03（America/Adak）。Jenn在候选与Windows3文件／生产7路径清单明确后要求继续推进。实际安装源码为`00d7c9a063fb05df44d80d51c5014135edcdf141`，统一包SHA256为`8cdd4d2a65820d62903278d6406d20d41550c004a2e1fc1b64b83a912966dbec`。**本次实际完成Windows32/32话题、809条原消息，以及14个受支持普通附件引用的原件核对；2项不支持类型、63个桌面引用和续聊配置限制继续单列。**

## 安装事实

Windows此前按Jenn明确指令经命令行强制结束，不能写成原生受保护退出。仅结束经路径、父子关系和会话核实的VCPChat进程树；停止前同步待落盘队列为0，停止后游标1110保持。重新确认进程已停止后才进行本次一致备份；没有依靠强杀绕过在途检查或把未完成群聊状态清空。

生产复核目标为`VM-0-13-ubuntu / ubuntu`，宿主模型请求、AA、工具及同步执行在途均为0。所有既有候选文件、目标before摘要、配置摘要及备份空间核对后，正常停止`vcptoolbox.service`，以新codec检查旧数据并通过SQLite backup API生成含已提交WAL事实的一致快照，再替换7路径。停机期间1105条messages、1110条journal和1110条applied_ops及其余事实摘要保持。启动后PID1790222、active/success；管理服务原PID保持，原配置摘要不变。

生产备份：`/opt/AGENTS_OS_Workspace/backups/NativeSync/source-data-v2-20261103`；一致库SHA256：`bc547626e253d6b3434db4b363f69f2489ca082f72ad6610c98cde49839a01d7`。

Windows仅替换runtime、sourceSnapshot及生成合同3文件，原生依赖和宿主补丁前置摘要保持，99个数据／状态文件在代码安装期间逐项摘要不变，原设置及connection配置不变。原生聊天SQLite一致备份quick_check通过。随后从原入口`P:\AGENTS_OS_Workspace\runtime\VCPChat\StartVCPchat.exe`启动，保留原生JSO绑定。

Windows备份：`P:\NativeSync-Local-Backups\QLL6-source-data-v2-20261103T135131392Z`；一致库SHA256：`5d8a45793e5149e518e3e0655daca7c786874798262314f935aa6ca58bb8e5fb`。

运行后全候选核对：Windows28项载荷、3项既有宿主补丁、生产57项载荷全部匹配。旧前端资源保留，没有恢复数据库、state、游标、Source绑定、授权或执行快照；未修改全局Agent映射，未推送或合入main。

## 实际数据与恢复结果

- 原32个导入计划全部完成。最后群聊保留原planId，从capturing/localIndex0推进到complete/localIndex65；没有换身份重新导入。游标从1110推进到1175，Inbox、Outbox、pending、localCommits、drift均为0。
- Windows原809条消息全部可由新codec规范化，本地原身份/内容摘要809/809保持；生产按相同身份/hash809/809匹配，未接受0、不匹配0。不能仅用计划完成或队列空代替这些核对。
- 升级前生产1105条messages、1110条journal、1110条applied_ops逐项核对，缺失0、改变0。原3个执行任务、原生任务/调用表以及2个Source绑定事实摘要保持，代理没有发送模型或业务工具请求。
- 原群聊大消息正文保持，70次原生附件引用的完整数组摘要相同；63个桌面活引用逐项原始记录相同，6,155,669字节历史提取文本保持。7次普通附件引用对应6份唯一元数据，重复次数没有减少；没有读取当前工作区文件。
- 当前1170条messages、1175条journal、1175条applied_ops的只读存储检查issues=0。此检查使用实际新codec，未用旧codec错误解码新表示。
- 原16次普通附件引用中14次原件可用，实际文件长度和SHA256匹配；2次被现有类型规则明确拒绝，消息与引用保留，不计为附件完成。63个桌面活引用也不计为原件已同步。重复文件按引用次数计数，服务器CAS按内容去重。

实际大消息约13.88MB已通过Windows生产HTTPS路径受理。附件仍按原64KB顺序上传；本轮约40MB群聊原件从开始补传到最后完成耗时约26分钟，明显偏慢，列为后续性能问题。等待期间持续按服务器offset核对，不把慢传伪装为完成、重新请求模型或用旁路复制替代产品上传。本次没有扩建分块/调度机制。最终所有受支持原件均已核对，不再有活跃上传。

首次只读群聊保留检查把原生FileManager的nullable字段直接送进wire字段提取而报错；改为使用宿主实际canonicalSourceSnapshot路径后通过。失败输出保留，没有改运行代码或放宽校验。

## 手机联合接入与已知限制

Jenn另外明确批准Linux本机＋Windows两个已批准来源的全部及未来新增内容。通过既有受保护配对入口创建联合配对，逐项明确snapshot:false；实际范围为Linux当前24话题和Windows当前32话题。新码已兑换，服务器核对新会话恰好包含这两个来源；原4个手机会话和原11个配对的身份、有效期及权限保持，没有静默扩权。配对码和cookie不进入本报告或公开清单。

用户已确认手机连接后能看到两个来源。Windows群聊历史、长文本、文件保存及重开保持会话的一次集中实机验收后，用户报告消息条数多的会话载入卡慢，**手机性能验收未通过，文件保存及重开不先记通过**。后续先在本机区分历史传输、处理和渲染瓶颈，生产保持本次版本，修复上线另确认。本机Chrome候选验证仍单列，不能替代Android操作。

本机urllib探测`/mobile/`、新脚本和connection接口均收到Cloudflare403。源站私有回环检查实际首页/脚本为200且摘要匹配，能力sourceDataV2为true；Windows同域HTTPS实际同步与用户手机联合目录访问均通过。本轮未更改Cloudflare规则，不将程序化403等同于手机访问失败。

历史和附件完成不代表所有会话已可手机续聊。Windows仍有31个话题报`CONFIG_PROMPT_SNAPSHOT_UNAVAILABLE`，既有配置/全局规则和只读约束保留；1项既有配置仍按原路径提供。本轮没有新增真实模型续聊验收，也不解除桌面引用依赖。

生产可用空间在收尾采样时约379MB，现有备份均保留。后续应优先安排明确范围的容量处理；本轮没有自行删除备份、日志或其他业务数据。旧codec直接降版仍不在支持组合内：保留新codec向前恢复，禁止回滚数据库、state、游标、范围、授权或执行快照。

[机器可读回执及证据摘要](../provenance/source-data-v2-install-20261103.json)。原始证据保存在本机`.local/source-data-v2-20261103/`，不加入运行载荷；源码与候选详见[本机开发交付](source-data-v2-local-20261103.md)。
