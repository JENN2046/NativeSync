# 原生有效规则发布与多来源展示候选

本轮按用户收敛范围开发：保留现有备份与回执，先补原生有效规则发布，再补多来源统一展示。没有改全局规则、手机会话权限或运行配置。用户授权后，已于2026-11-02（America/Adak；UTC为2026-11-03）安装到日常桌面和生产实例。

## 已实现

桌面增加可选的`readEffectiveTavernRules(descriptor)`宿主回调，复用原生`conversationContext.resolve`，按Agent或群聊取得覆盖后的实际规则。投影只保留既有快照允许的字段，剔除`globalEnabled`、`overrideEnabled`、`overrideKey`等观察字段。读取失败不回退成全局配置，也不改既有快照。

复用现有版本、摘要、Source配置调度及冻结请求机制。旧宿主未接回调时保留原行为。日常宿主还需应用包内`compat/host-patches/VCPChat-effective-owner-rules.patch`的一行接线；其JSON记录精确before/after，先在独立代码副本应用并通过语法检查，本次已按匹配摘要安装至日常宿主。

PWA新增已授权来源筛选，显示服务端配置的来源名称。同名Agent仍按原内部身份分开；切换来源或话题保留各自草稿。筛选只影响展示，不授予读取或操作权限。

配对接口增加显式的多来源选择，仍只接受服务器已批准的Source：每一项必须明确`sourceId`和`snapshot`。旧会话不变，不自动建立联合配对。单一Source及原选定话题接口继续兼容。

## 联合配对的准确范围

先确认`GET /mobile/api/connection`返回`capabilities.multiSourcePairing=true`，再由已有受保护的宿主配对入口提交。例如：

```json
{
  "scopeMode": "sources",
  "sources": [
    {"sourceId": "windows-source", "snapshot": true},
    {"sourceId": "linux-source", "snapshot": false}
  ]
}
```

示例ID是占位符。`snapshot:true`冻结该来源当前已就绪话题；`false`明确授予该已批准来源及未来新增内容。不会改服务器Source授权。带单一Source范围的请求不能借此添加其他Source；未知来源、重复来源、缺少明确snapshot选择均被拒绝，失败不生成配对。

联合配对产生新会话，复用原有scope数组；不扩权旧手机会话、不合并同名Agent或消息，不增加数据库迁移。既有跨Source内部身份碰撞继续拒绝。旧服务器不支持该请求时应停止，不降级为更宽授权。

## 验证与交付边界

- 12项直接相关配置/Source检查通过，包含原生覆盖投影、单聊/群聊、规则变化与缓存、读取失败、冻结快照、runtime回调实际串联。
- 3项多来源检查通过，包含固定话题与未来来源混合、旧会话及服务器授权不变、范围外拒绝、同名Agent，以及实际Chrome 390×844移动视口来源切换、草稿保留和零聊天提交。
- PWA构建通过；宿主一行补丁独立应用及语法核对通过。未重跑历史AA、工具、安装故障矩阵。

测试均在本机隔离夹具、临时SQLite和loopback服务上运行，复用已安装依赖，未调用真实模型。本轮移动UI证据是Chrome移动视口，不冒充Android实机验收。

候选通过统一组装生成，实际源码提交与载荷摘要见包内MANIFEST。范围保持：日常全局规则和只读状态继续保留，现有手机仍按原授权访问。日常宿主接线、生产服务/PWA的安装与重启需要集中维护窗口；安装时先核对当前目标和有效配置，不覆盖其他任务增量，不自动新建联合配对。

证据保留在`/home/jenn/NativeSync/.local/effective-rules-multisource-20261102`，包括两组TAP、移动视口截图和候选；可在下一次已接受版本交付时复核这些可重建材料。不扩建恢复工具，不恢复旧数据库、state、游标或Source绑定。


## 日常与生产安装回执

源码`a27f6019d931558a1914b719c6ff4a72b2217317`；候选`NativeSync_Effective_Rules_MultiSource_20261102.zip`，SHA256：`97fbdf0ca9d1dd62c5d84653cf6197bf34eb6a622ef73f16d49eec497ef76d6f`。本节是安装后记录，不改变候选包对应的源码版本。

用户确认保存草稿、托盘正常退出日常VCPChat并暂停生产新请求。核对生产hostname/user、现有56项载荷、配置摘要与模型/工具/AA/同步在途均为零后安装。Windows旧观察记录中的pending=1是历史观察，未清理或伪造该记录。

- 日常`/home/jenn/AGENTS_OS_Workspace/runtime/VCPChat`：只更新`main.js`与`modules/services/nativeSync/{executionConfigs,runtime}.js`。通过启动器共用的排他锁，备份并原子替换；语法和28项载荷及宿主补丁摘要通过。停机期间AppData逐文件摘要不变；原启动器恢复服务，PID为2128718。
- 生产`/opt/AGENTS_OS_Workspace/runtime/VCPToolBox`：只更新`Plugin/NativeSync/mobile/{portal,connection}.js`、`apps/mobile/dist/index.html`并增加`assets/index-DGmMOFfB.js`。保留旧`index-BcpsuVsp.js`。正常停启主服务，PID由1346476变为1582318；管理服务PID1233828保持。
- SQLite backup API生成含已提交WAL的一致快照，SHA256：`b770db98f0f9ea90e599dc62ac07716eb120fa3e12d6a10c5ead76e9849ebbc8`。安装前后停机快照所有表完全一致；启动后仅`source_observations`正常刷新。401条messages、406条journal/applied_ops、附件、Source绑定、执行记录、旧配对和手机会话均保持原摘要。存储只读检查零异常。
- 生产56项载荷、桌面28项及main.js摘要匹配候选/兼容补丁。实际生产HTTPS和本机代理路径均返回200及`multiSourcePairing:true`。日常cursor=406，Outbox/Inbox/pending/localCommits/drift均为0；原设置、连接、规则与历史文件保持。
- 当前24个话题历史全部就绪，executable=0：23个`DESKTOP_CONTEXT_REQUIRED`，1个`CONFIG_PROMPT_SNAPSHOT_UNAVAILABLE`。保留原生全局规则、只读状态、旧手机会话及授权，未新建联合配对、未调用真实模型或工具。当前ADB没有连接设备；本轮没有Android实机验收，浏览器现有页未配对，也未替用户创建会话。

安装过程保留两处诊断细节：生产脚本首次在停机前遇到局部变量名冲突，原服务/代码未变；修正后使用新的备份目录完成。Python自动外网探测返回403且非JSON，改由生产Node核对实际公网HTTPS返回200，未修改网关或权限。专项只读检查器初次将“缺少快照”错误计入可执行计数，按实际产品的snapshot/assertRunnable契约修正后核对只读；未因此改动产品。

私有备份：桌面`/home/jenn/NativeSync-Local-Backups/effective-rules-multisource-20261102`；生产`/opt/AGENTS_OS_Workspace/backups/NativeSync/effective-rules-multisource-20261102-r2`。首次准备目录`effective-rules-multisource-20261102`原样保留。逐文件before/after、备份位置及服务回执在各自`INSTALL.json`；本机集中证据在上述`.local/effective-rules-multisource-20261102`的`DESKTOP_INSTALL.json`、`PRODUCTION_INSTALL.json`、`DESKTOP_ACCEPTANCE.json`、`PRODUCTION_ACCEPTANCE.json`、`RUNTIME_ACCEPTANCE.json`。

需要代码回退时，先正常退出桌面并结清生产工作，核对当前文件等于INSTALL的after，只恢复上述3个桌面和3个被替换的生产文件；新前端静态资源可保留，旧index仍引用保留的旧资源。正常重启后复核身份、只读状态与账本。不得恢复数据库、state、游标、规则或授权；未知改动时停止覆盖，保留现场。此次未额外执行生产回退演练，不复用旧版本回退结果冒充本次实测。
