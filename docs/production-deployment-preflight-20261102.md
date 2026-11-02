# NativeSync 生产只读预检及安装/回退清单

日期：2026-11-02，时区Asia/Shanghai。**本轮仅获只读预检授权；未安装、备份、停启、修改配置或发布到生产。** 本地候选依旧是已签字版本，没有修改同步内核。

结论：生产的旧版NativeSync和现有数据具备进一步准备升级的基础，但**现在不能直接运行本机安装器上线**。目标差异清单已明确；下一步只需补目标专用安装入口、针对这个旧基线的一次升级/代码回退验证，以及独占维护窗口和生产签字，不必重跑历史测试矩阵。

## 当前核实事实

| 项目 | 结果 |
| --- | --- |
| SSH及身份 | `ssh -F /home/jenn/.ssh/config tencent-prod`；`VM-0-13-ubuntu`，`ubuntu` |
| 主服务/管理服务 | `vcptoolbox.service` / `vcptoolbox-admin.service`，最后采样均active/running |
| 工作目录 | `/opt/AGENTS_OS_Workspace/runtime/VCPToolBox`，不是release/current链接 |
| 宿主Git锚点 | `77aa55797057800261d8417fea6ca2156c81c7bb`；工作树含729项差异，很多来自运行数据迁出和配置链接；不是干净提交对应的安装树 |
| 实际Node | `.runtime/node-v24.22.1-linux-x64/bin/node`，24.22.1，ABI137，SQLite3.53.4，Linux x64；`.runtime/node`指向它。非交互PATH没有node，不应误判缺少运行时 |
| NativeSync | 已加载并持有活动DB/WAL/SHM，属于已有实例升级 |
| 数据目录 | `/opt/AGENTS_OS_Workspace/runtime-data/NativeSync/r21`；17:22采样仅3个普通文件，无符号链接，共5,246,528字节 |
| 现有Source | 1个来源，显式limited范围，仅2个话题；手机静态配置登记1个话题。没有启用`all-supported` |
| 附件/凭据交换 | 附件关闭，凭据交换关闭；本轮升级方案均保持 |
| PWA实际位置 | `apps/mobile/dist`；生产配置不使用候选默认的`Plugin/NativeSync/mobile-dist` |
| HTTPS静态入口 | `https://vcp.skmt617.top/mobile/`默认TLS验证及GET200通过；不带凭据/cookie，仅请求静态壳 |
| 空间 | `/opt`、`/home/ubuntu`和`/var/tmp`同一文件系统，采样约1.02GiB可用；不可把它们当成独立备份盘 |

宿主的`server.js`、`Plugin.js`和AA主文件已有接线且各有本机调整；两个集成模块`modules/requestExecutionContext.js`与`Plugin/AgentAssistant/delegationContinuity.js`已与候选相同。静态核对存在移动路由、请求上下文、执行端点及`beginDrain`出口。本方案**不替换上述宿主文件、不更新宿主Git、不运行git reset/pull**。

### 账本只读检查及时间边界

17:16:06，使用目标实际Node运行候选检查逻辑，模块仅经stdin载入内存；只读打开现有库并设query_only，不运行NativeSync初始化或`CentralStore`构造函数：

- `quick_check`、逐行内容/引用检查：20条messages、23条Journal、23条applied_ops，0项异常。
- 将候选的真实`projectRows`方法用于只读查询门面，按128行核对当前投影、Head及历史归属关联：23条Journal、20条投影均通过。没有建索引或触发器。
- 1个执行任务为completed，原生子任务为0。当前JSON触发器为0，三个待新增索引均不存在。
- Source观测显示待导入、待操作、冲突及目录错误均0；这是当时的同步器观测，不能证明整个VCP、客户端Outbox或AA全局空闲。

17:22:36的关闭采样已增长为**23条messages、26条Journal、26条回执，headSeq=26**；执行任务仍1个completed、原生任务及调用均0。后增3条不冒充已在17:16完成完整性检查；**生产仍在接受增量，停机窗口必须重新核对最新数据**。没有导出生产聊天正文或数据库。

只读SQL连接会使用SQLite正常的WAL读锁/共享内存机制；这里承诺的是不写业务表、不改变schema、不运行恢复任务，不能把“只读”夸大成操作系统层零读锁或零访问日志。

### 预检期间的其他变更

17:16:51主服务从PID1233827换到1251194。systemd记录为正常Stopping/Stopped/Started，Result=success、NRestarts=0；未见这次事件属于崩溃/OOM自动重启的证据。发起者未核实，**本轮未发出停启命令**。管理服务PID1233828未变。

重启后关闭采样确认：所检查公开代码摘要、PWA文件及非敏感配置投影未改变。该事件仍说明生产有其他操作，正式发布需指定唯一操作者与维护窗口；不能凭本次报告跳过当场复核。

公网HTML为931字节，磁盘index为564字节；Cloudflare响应增加了insights脚本，正文不能逐字节等同。实际HTML引用的JS/CSS均与磁盘旧版资源名一致。该检查证明静态入口及资源引用，不证明登录、续聊、模型或手机实际使用已验收。

## 固定候选和准确文件映射

候选：`NativeSync_Online_Read_Integrity_20261101.zip`，418,871字节。

- ZIP SHA256：`35b7e67055fb07b8d27221f231d77e8d9fb771b1774a0957055b187ec8c2cd30`
- MANIFEST SHA256：`91134a1656d23ee80b8aa3550fb0f85e8ab55e0893eece5590e4bded195dad95`
- 运行源码：`144e0dc4681dbd94410dd9a4a44d93c23f61e320`；本机签字记录提交`4254822`。

原包84项载荷中28项属于VCPChat，不安装到无桌面的服务器。56项服务端载荷按生产路径映射后：**36项只核对不写入、15项替换、5项新增，共20项写入**。包的完整摘要和部署路径映射分开保留，不能把改过目录的服务器文件集冒充原包原路径清单。

所有目标的before/after SHA256、长度、创建/替换及回退动作见[机器可读清单](../provenance/production-deployment-preflight-20261102.json)。现有14个差异服务端文件分别匹配本仓历史`65fd586`或`354d52a`的准确字节，未发现需要盲目覆盖的未知改动。

| 作用 | 目标路径（相对宿主根） |
| --- | --- |
| 替换14个服务端文件 | `Plugin/NativeSync/mobile/{attachments,execution,executionConfigs,groupTurn,portal,submissionRecovery}.js`；`Plugin/NativeSync/native-sync.js`；`Plugin/NativeSync/sync/{centralStore,httpService,metadata,protocol,sourceCatalog,sourceHttp,sourceScope}.js` |
| 新增3个支持文件 | `Plugin/NativeSync/config.env.example`、`Plugin/NativeSync/mobile/executionPages.js`、`Plugin/NativeSync/sync/contracts.generated.cjs` |
| 替换PWA入口 | `apps/mobile/dist/index.html` |
| 新增2个PWA资源 | `apps/mobile/dist/assets/index-BcpsuVsp.js`、`apps/mobile/dist/assets/index-RI3Q4bWS.css` |

当前PWA的5个公共图标/manifest/sw文件与新包相同，只核对。保留旧`assets/index-DI5CQjGO.js`及`assets/index--gXYP5bX.css`，不要用目录同步的`--delete`删除。现有`SOURCE_PROVENANCE.json`作为历史来源记录保留，以新增安装回执表达当前部署版本。

当前代码将由首次启动自动补**3个普通索引**：`idx_journal_message`、`idx_mobile_execution_topic`、`idx_mobile_execution_request`，以及messages/journal/applied_ops的INSERT/UPDATE共6个JSON触发器。比本机旧候选更早的生产基线还缺分页相关两个索引，不能写成“只新增一个索引”。不新增表、列、迁移版本或同步协议；索引/触发器是schema对象变化，首次构建有时间和空间开销。

## 待批准后的安装清单（本轮未执行）

1. **制作目标专用安装入口并做一次针对性验证。** 原包公共夹具安装器和固定本机安装器均不接受此生产目录，且不支持此次PWA映射。保持原限制，不伪造标识或放宽白名单。新入口只允许此主机、根目录、20项写入和明确before/after，拒绝链接及未知漂移，记录中断点和代码回退回执。先用观察到的公开宿主代码/旧载荷验证一次升级、已有selected/limited Source兼容和代码回退，不调用付费模型、不复制真实聊天；不能把之前本机全量C→新候选的结果当成本生产旧基线证据。
2. **确认生产授权及独占窗口。** 核实所有模型/工具/AA在途与未知结果，并让现有客户端完成原Outbox/提交收尾；暂停新请求和管理面板的配置编辑、重载通知。再次核对主机、PID/Invocation、20项before及受保护宿主摘要、非敏感配置范围和最新账本。旧的两个话题授权保持，不在本次顺带转全量或开启附件。
3. **正常停止主服务。** 拟停启仅`vcptoolbox.service`；管理服务不加载NativeSync执行实例，正常无需重启，但维护窗口内不能向主服务发配置/重载操作。主服务systemd stop预算45秒，宿主自身force-exit预算60秒；必须预先结清工作，不能把发stop当作安全排空的证明，也不以强杀满足安装条件。
4. **制作一致备份并体检。** 确认所有实际持有该NativeSync库的进程退出后，使用目标Node SQLite backup API保存包含已提交WAL的快照，并留存停止状态下存在的原DB/WAL/SHM。数据库、私密配置备份目录0700、文件0600，不打印内容；用候选`diagnostics/check_sync_storage.cjs`检查原库及快照，失败即中止。另保存20项目标的原始代码/缺失标记、完整旧PWA静态清单、宿主/配置摘要及Source绑定/回执身份摘要。不要只备份主sqlite遗漏WAL，也不要在活动库上凭tar三文件宣称一致。
5. **校验并写入。** 拟暂存目录`/home/ubuntu/nativesync-release-stage/144e0dc-20261102-r1`，拟新备份目录`/opt/AGENTS_OS_Workspace/backups/NativeSync/144e0dc-20261102-r1`；本轮都未创建，执行时需拒绝已有/别名目标并重新计量。先校验原ZIP/清单，再按专用映射逐文件原子替换；先资源、后index。代码before当前只有176,053字节，新写入代码/资源337,078字节，NativeSync目录采样约5MiB；实际还要预留一致快照、WAL增长及日志空间。无需上传429MB宿主封存包或重新安装npm/Node，不自动清理其他业务文件。
6. **启动与最小验收。** 通过既有systemd入口启动主服务，确认PID/新进程、插件就绪、3索引和6触发器、最新既有消息/回执/任务身份及Source pin均保留。对原授权范围做读与原操作回执核对、已有客户端重连和PWA有网重开；需要实际收发时再使用约定的明确测试请求。检查实际上下文、模型/副作用计数，不能仅以队列为空或HTTP200判定成功。不要自动重新派发旧任务，不新配对、不清客户端存储。无关AA/工具/格式矩阵不重复跑。

## 代码回退清单（方案，尚未完成目标基线验证）

- 使用**本次生产安装自己的原始before回执**回退，目标不是本机的旧全量C，也不是宿主Git锚点`77aa557`。宿主含既有调整且NativeSync有额外载荷，`git reset`不能还原实际生产安装。
- 同样先禁止新请求、确认任务/提交已明确收尾，再正常停止主服务。完整预检各目标当前必须匹配已安装after，备份必须匹配before；有并发编辑或未知结果则保留现场，先查明，不能强行覆盖。
- 将15个替换项恢复到精确before；3个新增支持文件仅在仍匹配after时移除。旧PWA入口恢复，新增内容寻址JS/CSS可作为不被旧index引用的静态资源保留，避免打断已有页面资源读取；旧资源始终保留。
- **不回退数据库、state、游标、Source scope/绑定、执行快照、已接受消息和任务。** 新索引及JSON触发器不通过数据库回退或DROP删除。全量自动续聊本方案始终关闭，不套用仅面向固定本机的`source_compat.py`。
- 启动旧代码后核对新增数据仍可读取、原身份和回执仍在。手机有网重开以取回旧入口，保留会话；当前SW为网络优先，不能把保留的旧离线缓存当成已完成前端回退。不能正常读取/收尾时，不恢复旧DB，保留现场并按同一回执向前恢复新候选。

## 放行前尚缺什么

本轮完成的是目标/版本/差异/配置范围/账本快照只读核对。**未完成目标专用安装器、该生产旧基线的实际升级与代码回退、真实提供者接线验收、Windows/手机实际互通，以及维护窗口确认。** 后续只补直接受影响的最小路径，不能宣称已有完整生产验收。

还需明确在生产接受“共享`msg_id`旧历史错归属仍有盲区”的边界。本机签字保留，但不自动授权生产风险和写入。`execution-decisions`和`haltedTopics`继续排除，不在上线准备中重启架构实验。

这份清单适用于**保留现有有限授权的代码升级**，不等于生产全量同步接入计划。若要同步所有Agent/群聊、启用附件或全量自动续聊，应另核对客户端版本、未结清队列及新的Source配对授权，不能与此次代码发布混在一起。
