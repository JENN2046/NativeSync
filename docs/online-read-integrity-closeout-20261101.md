# 在线读取加固与 Linux 宿主独立冷启动

日期：2026-11-01（America/Adak；执行回执 UTC 为 2026-11-02）。

本轮完成了限定范围的在线读取加固、定向回归、候选组装和独立宿主冷启动。**未完成历史归属根治，不授予“黄金基线”结论；未合入主开发分支、推送或部署。** 用户已明确同意“完成加固与冷启动，列明剩余边界”，最终合入仍待签字。

## 实现与准确边界

应用提交：`144e0dc4681dbd94410dd9a4a44d93c23f61e320`。
维护源码位于 `overlays/VCPToolBox/Plugin/NativeSync/`。本轮只修改以下六个运行文件：

| 文件 | 结果 |
| --- | --- |
| `sync/centralStore.js` | 统一同步读快照、按128行分块的投影/Head/最新seq核对，以及真实幂等重放时的回执引用核对 |
| `sync/sourceCatalog.js` | Source基线分页与旧历史证明复用统一屏障；先验证授权及证明身份，再读取正文 |
| `mobile/portal.js` | 手机当前历史分页在同一读快照中查询和校验，完整成功后才返回 |
| `mobile/execution.js` | 单聊历史及前驱查询在同一快照中校验；派发前存储错误保留`SYNC_STORAGE_CORRUPT`分类 |
| `mobile/groupTurn.js` | 群聊受理历史与冻结上下文读取均校验 |
| `mobile/attachments.js` | 附件关联、定位及状态读取复用屏障，避免从消息读取旁路漏出不一致记录 |

`effectiveContext.js`仍为纯组装函数；调用方先取得已验证历史，无须为了覆盖文件名修改它。

读取规则如下：

1. `pull`先扫描有界路由列、按授权集合筛选，再定点加载正文。其他出口沿用原会话/Source授权后读取。未授权正文不参与解码；合法字段错归属可能伪装成授权行，剩余边界见下节。
2. 对页面涉及的消息身份查询投影。投影必须存在，且`last_seq >= journal.seq`。旧历史行允许内容/hash/墓碑不同于最新版本；不会以最新投影覆盖合法旧历史的语义。
3. 按`last_seq`及完整身份反查Head，核对hash、墓碑与元数据；按同一身份查询最大seq，拒绝头部空洞、错指或更新的悬挂Journal。投影、Head及页面本身均做语法、内容摘要和元数据校验。
4. 查询与校验共享一个同步SQLite读事务快照；已位于受理写事务中时复用该事务。拒绝异步读回调跨出事务生命周期。
5. 不把`applied_ops`当作Journal的1:1索引。真实操作重放才核对其回执引用的seq、身份、hash、墓碑和元数据；多个操作合法共用一个已接受seq正常通过。不对每页反扫整张回执表。
6. 关联查询按当前页身份集合执行`json_each`定点JOIN/查找，每块最多128行。新增普通索引`idx_journal_message(owner_type,owner_id,topic_id,msg_id,seq)`，现有库首次打开会构建该索引，需要一次性建索引时间和磁盘空间。**没有新增列、同步协议、持久状态格式或数据库迁移版本**；不能把新增索引说成schema字节完全未变。

EXPLAIN实测：投影走复合主键；Head走Journal整数主键；最大seq走新增覆盖索引。新增验证查询不扫描全库。宿主原有整话题历史读取、基线CTE和JSON历史存储未重做；不宣称整个请求成本或总内存恒定。损坏时拒绝当前授权读取请求，不引入跳行、话题暂扣或双游标协议。

## 必须保留的未解决边界

**共享消息ID与旧历史行错归属：本轮新候选仍可泄露该旧正文，离线检查也会漏检。**

合成数据中A与F合法使用相同`msg_id`：A的v1为seq1，F自己的版本为seq2，A的v2为seq3。只将Journal seq1的`owner_id`从A改为F，保留其余字段。F确实存在同身份投影，其Head为seq2且一致；被篡改seq1又是合法旧版本。因此六条关联条件均可通过。

已针对**独立解压的新候选**再次执行：仅授权F的`CentralStore.pull`仍返回原A的seq1正文；`check_sync_storage.cjs`报告0项问题。证据为`boundary/after-fix.json`，不是仅沿用修复前观察，也不是要求产品永远保留此行为的通过测试。

这说明当前存储缺少可独立验证的历史接受归属见证；内容hash不绑定归属，回执的request_hash也不能反推出原请求。新屏障能发现缺投影、Head不一致、孤儿尾部等单表/跨表不一致，**不能证明每条旧历史的原始归属**。该限制比“攻击者同时改所有表并重算hash”更宽：本例只改一个字段。协调一致篡改同样不在保证范围内。

不在本轮偷偷增加归属账本、协议或迁移。`haltedTopics`实验原地封存；`packages/execution-decisions`与`halted-topics`均明确排除于`release/scope.json`及84项运行载荷之外。历史实验报告保留其当时版本结论。

## 定向回归

回执以独立文件保留，**不将失败批次和重试简单相加、不混入历史220+/239或整机矩阵**：

| 组 | 实际结果及含义 |
| --- | --- |
| 存储完整性原有11项 | `storage-first.tap`：11通过 |
| 扩展存储专项16项 | `storage-targeted-1.tap`：15通过，1项暴露执行预派发将存储错误泛化为模型失败；已修正分类 |
| 错归属失败项重测 | `storage-routing-retry.tap`通过；随后收紧为只改`owner_id`的精确反例，`storage-owner-exact.tap`：1通过 |
| 直接关联路径 | `affected-regressions.tap`：58通过、2项夹具装载失败；不是60通过 |
| 夹具补齐后附件路径 | `attachment-regressions-retry.tap`：3个实际用例通过；失败的桌面测试文件此时展开为两个用例，不能与原失败占位数相加 |
| 旧版本重新发布反例 | `republication-barrier.tap`：1通过；当前屏障拒绝新增旧Journal但投影未推进的尾部，桌面游标不动，v2保留 |

扩展16项分别取得通过证据：合法v1→v2→墓碑及冻结旧基线、多个操作复用seq、原反例5跨出口500、投影空洞/错指/悬挂尾部、双连接并发更新时的一致快照，以及跨128行边界的索引查询。精确错归属测试覆盖Core Pull、实际Source HTTP、手机events、桌面/手机基线、当前投影、操作重放及单聊/群聊上下文；单聊在派发前停止，不调用模型。范围外损坏不解码、不阻断授权话题。HTTP返回经清理的`500 SYNC_STORAGE_CORRUPT`。

附件夹具问题分别为未提供`NATIVESYNC_ASSEMBLY`和缺少公开测试helper。重试补充原有公开helper并记录摘要；上传内核测试使用旧PWA构建（其字节与本轮相同）。这是定向测试输入，**不是冷启动运行时借用旧依赖**。未重跑无改动的AA、工具、Android或完整安装故障矩阵；本轮没有新增手机实机验收。

## 独立重建与真实冷启动

重建目录：`/var/tmp/nativesync-independent-cold-1000/20261102T042444849122Z`。现场保留；含新凭据的config、数据库和原始日志不进入交付证据ZIP。

输入封存包`NativeSync_Linux_Host_Baseline_20261101.zip`，SHA256：
`c16a81d1338dc9d5febad066a4190846a4c6f699f2a8685bb9d4b8ada5781bfd`。
在新目录逐项验证清单并用包内独立脚本重建5901项公开宿主文件，随后覆盖已核验候选84项载荷；17项宿主指纹全部匹配。候选PWA和三个既有宿主补丁与原C相同。

两个宿主分别在自己的真实`node_modules`目录执行锁定`npm ci`，使用全新HOME、各自空缓存及两个不同的空npm配置文件。后端安装751包、桌面937包；独立重建必要原生模块并下载Electron。未链接或复制旧`NativeSync-Dev/node_modules`。使用封存包内公共原生二进制，不从旧模块树取用。

| 实际运行 | 版本 |
| --- | --- |
| 后端Node / ABI / SQLite | 24.22.1 / 137 / 3.50.4 |
| Electron / 内置Node / ABI / SQLite | 44.9.3 / 24.22.0 / 149 / 3.53.4 |
| better-sqlite3（后端/桌面） | 12.4.1 / 13.0.3，分别以各自真实运行时打开内存库成功 |

新生成独立凭据、证书、Source授权、连接配置、Agent和空历史。首次后端启动后、桌面启动前，messages/Journal/applied_ops均为0，六个JSON触发器及新索引自动存在。没有复用旧DB、state、配对或会话。

真实`server.js`和Electron宿主入口均启动。桌面Source接入及配置发布完成后，通过真实`native-history:messages` IPC提交一条合成消息；后端按同Source授权Pull返回相同消息身份及内容hash。最终三表各1条，cursor=1、outbox=0、inbound=0、配置待发布/错误均0。模型请求、embedding请求均0。

预加载记录1267条不同应用模块路径，均在新冷启动根中；实际Electron `main.js`已记录。`/usr/bin/npm`诊断工具自身另有510条全局工具链路径，单列而非伪装为应用闭包。子进程环境、依赖软链接、数据路径和代码摘要另行核对；无旧开发模块加载。该记录是CommonJS解析审计，不是系统级全文件访问追踪。

退出使用桌面原生`closeApp`及后端SIGTERM；冷启动子进程均已退出，日常实例已恢复。保留两个限制：

- 宿主音频服务的`/shutdown`返回404，宿主日志虽写“Force killing”，源码实际调用默认SIGTERM，Rust日志确认收到SIGTERM并进入关闭；不是本轮控制器SIGKILL，也不是验证所有音频功能。
- 脚本等待退出且主控制脚本成功，但没有逐一持久化Electron等子进程的OS退出码；只能声称受保护退出、后端退出日志及进程消失已核实。

首次npm因把user/global配置均设为`/dev/null`而拒绝双重加载；改成两个独立空文件后安装成功。首次冷启动端口探测因未用SO_REUSEADDR报EADDRINUSE，尚未创建库或启动新服务；保留现场，修正探测后完成本次首次建库启动。失败未通过清空数据规避。

## 候选与签字状态

候选：`NativeSync_Online_Read_Integrity_20261101.zip`。

| 绑定项 | 值 |
| --- | --- |
| ZIP SHA256 | `35b7e67055fb07b8d27221f231d77e8d9fb771b1774a0957055b187ec8c2cd30` |
| MANIFEST SHA256 | `91134a1656d23ee80b8aa3550fb0f85e8ab55e0893eece5590e4bded195dad95` |
| SOURCE_INPUTS SHA256 | `5d9d72597609be3f142aeb13c3dcc0b66e90f40a9449bdec6b70c7060f3983d6` |
| 候选源码 | `144e0dc4681dbd94410dd9a4a44d93c23f61e320`，干净源码组装 |
| 冷启动代码对应 | 84项载荷全部相同，17项宿主指纹相同 |

包已独立解压并用`install_release.py verify`通过。实验组件未进入载荷。冷启动工具原样归档在`tools/dev-environment/independent-cold/`；具体执行输入摘要随证据包提供。

证据包只含审查过的JSON摘要、TAP、截图、脚本和候选版本清单；不包含原始配置、凭据、证书私钥、数据库或原始后端日志。源码快照与Git变更另附。

`/home/jenn/NativeSync`保持`fix/architecture-recovery`、`9dc099b6007e018a9743d72048d5e6fbb43b94e7`且干净；它是当前实验分支的祖先，可在签字后按已审查提交推进。日常`/home/jenn/NativeSync-Dev`已恢复原全量C，未安装这次加固包。签字应明确接受上文剩余历史归属边界；未签字前不合并、不称黄金基线。
