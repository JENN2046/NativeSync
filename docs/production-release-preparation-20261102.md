# NativeSync 生产发布工具与本机旧基线验证

日期：2026-11-02（Asia/Shanghai）。本轮完成“生产专用安装/回退入口 + 已核对旧基线的本机验证”。**没有向生产上传文件、安装、停启服务或修改业务数据/配置。** 生产操作仅限只读取回公开代码/Node和复核非敏感授权摘要。

[此前只读预检](production-deployment-preflight-20261102.md)及[原始目标清单](../provenance/production-deployment-preflight-20261102.json)保持原样。它们描述当时的现场；本文补齐其中安装入口和定向升级/回退验证两项，不将旧快照当成未来维护窗口的实时状态。

## 已完成

- `tools/install_production.py`：固定目标、候选和路径映射的生产专用入口；不放宽原公共夹具或本机安装器。
- `tools/production_db_snapshot.cjs`：只读体检/结清检查、SQLite backup API一致快照及逻辑摘要核对，不初始化插件，不恢复数据库。
- `tools/validate_production.py`及对应夹具：真实公开生产宿主、原Node、真实server.js和Chrome PWA的本机流程。
- 四个阶段及六项新入口保护检查通过。机器可读结果与输入摘要见[验证回执](../provenance/production-release-preparation-20261102.json)。

**可以开始确认实际发布窗口。** 尚需独占窗口、全局/客户端收尾和明确生产授权；窗口内先重采基线，发现漂移即停，不强行套用本清单。

## 安装入口边界

生产身份固定为`VM-0-13-ubuntu` / `ubuntu`；根固定为`/opt/AGENTS_OS_Workspace/runtime/VCPToolBox`，数据目录固定为`/opt/AGENTS_OS_Workspace/runtime-data/NativeSync/r21`。没有任意`--root`或远端执行功能。

候选运行源码仍为`144e0dc4681dbd94410dd9a4a44d93c23f61e320`。原ZIP SHA256仍为`35b7e67055fb07b8d27221f231d77e8d9fb771b1774a0957055b187ec8c2cd30`；MANIFEST SHA256仍为`91134a1656d23ee80b8aa3550fb0f85e8ab55e0893eece5590e4bded195dad95`。本轮运行载荷修改0项。

原目标清单的原始字节SHA固定为`dd40b094183c30a516c0806114bec4dee9ad3ad4694b7c4d64ec7736e7a7a4fb`。56项服务器映射中36项只核对，首次安装15项替换、5项新增；PWA映射到现有`apps/mobile/dist`。保留旧PWA资源；回退后再次安装可复用相同摘要的新不可变资源，此时少写两个资源文件，不改变逻辑清单。

保持当前limited Source的2话题、1个手机话题配置、附件关闭和`all-supported`未开启。非敏感标量设置和**完整授权JSON文档的摘要**都已固定；新加`approvedScope`、别名/模型等字段也会改变摘要，不能因它不在某个投影白名单而漏检。只存摘要，不向报告输出私密配置或凭据。

生产写入前要求：

1. 另有生产授权并由操作者传入`--window-confirmed`，表示已停止新请求、结清客户端及整个VCP/模型/工具/AA工作。这是明确的人工作业确认，不能声称工具能凭NativeSync队列自动证明全局空闲。
2. 主服务已inactive且MainPID=0，并拒绝另一个同用户进程仍持有该账本。管理服务正常不用重启，但窗口内不得编辑配置或通知重载。
3. 逐项核对56项载荷before、5项受保护宿主/集成文件、旧PWA资源和授权配置；拒绝未知漂移及目标路径链接。配置原文件只做私有备份和摘要复核，不被写回。
4. 新建私有备份目录，先对现有库做只读体检及未结清任务检查，通过Node SQLite backup API制作含已提交WAL的一致快照，检查快照全部应用表摘要与原库相等；随后保存原数据旁文件、原代码、完整PWA和私密配置副本。备份失败时尚未写入目标代码。
5. 保存并fsync安装回执后逐文件替换，记录已完成项；每次写入前继续检查服务/持有者、配置和该文件摘要，index最后发布。中断不自动启动服务；用同一回执检查before/after混合状态后恢复。

所有备份只用于灾难恢复留存；工具**没有恢复数据库/state/游标的代码路径**。安装期间和回退期间，在服务停止状态下核对应用表逻辑摘要不变。新索引与6个JSON触发器由候选首次正常启动创建，代码回退后保留。

本轮发现的工具问题也已修正：最初配置摘要沿用了预检的字段投影，可能忽略新加的授权键。最终入口改为对完整JSON授权文档求规范摘要；“原两个话题不变但额外增加approvedScope=full”已取得拒绝证据。

## 目标旧基线的本机验证

通过SSH只读取回1086项公开代码/运行时文件（含一个未被Git列出的公开接线模块），不复制生产配置、Agent正文、聊天、数据库或AA运行记录。复核代码仍匹配预检before。公共夹具归档SHA256：`4dccfffe56d52f55cd934badd8450826d3d81bf864a5fc00a4dcae7eafc652fb`。

实际使用原生产Node二进制，SHA256：`e32e2d16081cf644f88392934288086e7662529d0d43277c34f7aad2207cfafb`；实测Node24.22.1、ABI137、SQLite3.53.4、Linux x64。npm依赖复用既有本机冷启动安装闭包，**本次不是再次独立安装依赖的证明**。

最终现场：`/var/tmp/nativesync-production-validation-1000/production-installer-work-20261102T095412Z-r3`。重新生成凭据、CA、Agent、工具禁用配置、limited Source和空白数据库，使用独立回环端口；没有停止日常开发实例。仅启用NativeSync和AgentAssistant，未请求真实AA委托或业务工具。

| 阶段 | 真实后端/PWA与数据结果 | 合成聊天模型累计调用 |
| --- | --- | --- |
| 生产旧字节 | 完成目录、初次接入、原生别名冻结、请求重放、首个明确请求；浏览器能读取消息和回复 | 1 |
| 安装候选 | 旧协议Source info/push/pull继续工作；原seq/hash不变；原手机Cookie无需新配对；新明确请求一次 | 2 |
| 代码回退 | 升级后新增消息和任务仍可读，原任务attempts均1；旧代码继续接受一个新请求 | 3 |
| 再安装候选 | 全部消息、任务和Source空间保留；只查询/重开，不自动重跑 | 3 |

每个明确请求重复提交一次仍返回原任务，没有产生第二次模型调用。独立提供者核对请求中冻结别名内容的标记、最新历史v2、前驱回复及temperature/max_tokens；不只凭任务状态判定成功。每阶段拒绝跨来源owner写入。

浏览器是实际Chrome，用复用的会话Cookie和独立浏览器配置加载真实旧/新PWA资源，选择已配置话题并对消息/回复DOM断言、截图。旧/新JS资源名随代码正确切换。第二个未配置续聊的话题继续可读且显示缺配置原因。此证据不替代Windows实体客户端、Android已安装应用缓存或真实提供者验收。

初始旧库备份中6个JSON触发器和3个新增索引均不存在；代码回退后保存的快照与最终库中均为6个触发器、3个索引。最终7条消息、8条Journal、8条操作回执、3个完成任务；客户端游标依次4→6→8→8。

六项直接相关保护检查通过：

- 活动账本持有者存在时，拒绝安装且不建立备份或修改代码。
- 新增授权字段时，拒绝配置漂移，两个原话题不变也不能绕过。
- 脏回退目标拒绝且整组代码不变。
- 脏安装目标拒绝且不建立新备份。
- 修改清单映射以逃逸目标目录时，被固定清单摘要拒绝。
- 测试子进程在第二个目标rename后立即exit86、来不及记录该项；回执仍是prepared、只记录1次完成，通过真实before/after摘要恢复旧代码，再装候选。全过程所有应用表摘要及客户端状态字节保留。

故障注入只存在于测试子进程，未给生产CLI增加故障开关。这是进程中断恢复证据，不是物理断电持久性证明。测试结束后无本轮实例进程残留。

### 保留的失败现场

首轮夹具缺少宿主启动必需的JEV配置；随后测试提示词使用未识别的引用写法，导致冻结上下文断言失败。已生成禁用的合成工具配置，并改为当前原生支持的`{{agent:SyntheticLegacy}}`；未修产品来迁就夹具。

另一份早期补充检查将PWA读取新建的基线计划误当成“所有表都应不变”，错误门槛失败；它没有证明账本变化。最终区分了应用读取期间允许变化的读取计划/会话选择，与**安装器停机操作期间全表不应变化**的约束。最终版在新独立目录重跑四阶段，先前目录和失败记录均保留，不删除数据制造通过。

## 操作说明（仅供之后获批的窗口）

工具包解压到全新暂存目录后，先验证外层SHA256SUMS，再解出原候选到`candidate/`。以下均为将来在生产机上执行的命令，本轮没有执行：

```sh
# 先核实 hostname / id -un，以及已有授权、唯一操作者和当前实际业务收尾。
python3 tools/install_production.py preflight --plan TARGET_PLAN.json --package candidate

# 在确认的窗口正常停止主服务；inactive、PID=0后才安装。
sudo systemctl stop vcptoolbox.service
python3 tools/install_production.py install --plan TARGET_PLAN.json --package candidate \
  --backup /opt/AGENTS_OS_Workspace/backups/NativeSync/144e0dc-20261102-r1 \
  --window-confirmed
sudo systemctl start vcptoolbox.service
```

`preflight`不创建备份、锁文件或安装回执；安装工具不会自行停启服务。备份目录必须全新，工具拒绝重复使用。主服务stop预算45秒，宿主退出上限60秒，不能用强杀替代事前结清。磁盘余量按窗口现场重新计量，不复制完整宿主或重装Node/npm。

有错误时先读私有`INSTALL.json`及当前文件摘要。服务仍停止时，中断恢复或完整代码回退使用同一入口：

```sh
python3 tools/install_production.py rollback --plan TARGET_PLAN.json --package candidate \
  --backup /opt/AGENTS_OS_Workspace/backups/NativeSync/144e0dc-20261102-r1 \
  --window-confirmed
```

回退拒绝未知代码/配置漂移，不修改数据库、游标、Source绑定或执行快照。PWA的新内容寻址资源可保留，旧index恢复；手机需有网重开核对旧入口，不能以清站点数据或重新配对作为回退手段。不能读取或状态不明时保留现场，以同一清单向前恢复；不要手工覆盖整目录。

仍接受此前“共享msg_id旧历史行错归属”的存储边界，不称归属根治或黄金基线。实验仍封存。本工具只准备既有有限授权的代码升级，不包含全量Source接入、启用附件、生产真实模型请求或远端Git推送。
