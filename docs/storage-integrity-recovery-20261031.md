# 服务端存储完整性修复：第一阶段

日期：2026-10-31。施工基线 `ededbcb5df2b4e99844e7f70952f23cbc2e8596c`，继续使用独立副本和 `experiment/contracts-boundary` 分支。只完成路线第一项；未推进生成器改造、通用纯内核、隔离回执或修复重发布协议。

## 已实现

1. **读取时核验事实。** `CentralStore.projectMessage`复用原有身份、内容hash、删除hash与metadata校验，统一检查Journal和当前messages投影；损坏、缺失、错误身份、错误摘要、无效墓碑、元数据权威列不一致均报`SYNC_STORAGE_CORRUPT`/500。读取范围仍先经过授权筛选。普通PWA当前历史查询补齐内部校验需要的列，返回字段保持原样。
2. **区分请求与服务器错误。** 同步HTTP的未知内部异常返回`SYNC_INTERNAL_ERROR`/500，已识别的账本损坏返回上述存储错误；服务端5xx不返回底层异常内容。显式4xx保留，503保留服务不可用语义。非法请求JSON、消息身份、内容和Source目录/旧域证明身份仍是4xx。PWA读取这些账本时使用同一存储校验，拿到明确500。
3. **旧库可直接增加的JSON写入约束。** 在messages、journal、applied_ops上各安装INSERT/UPDATE两个SQLite触发器，使用`json_valid`拒绝非法JSON。保留消息删除所需的NULL，不改表、不重编号、不重写旧记录。采用触发器是为了覆盖既存表，避免为增加CHECK重建账本；它们不替代语义校验，也不修复历史记录。
4. **保护已有回执。** 幂等重放先验证存储回执的seq/hash/deleted与元数据结构，并与原请求的内容hash和删除状态比较；损坏时拒绝返回伪回执。普通消息更新也先核验已有投影，不以新写入掩盖坏数据。新Journal与messages共用一次JSON序列化结果。
5. **只读历史检查。** 新增`tools/check_sync_storage.cjs`，用SQLite`readOnly:true`和`query_only`打开既有文件，在一个读取快照中执行quick_check、逐记录校验、当前投影与Journal双向引用核对，以及applied_ops回执引用核对。每页128行，按rowid继续，只保留最多20个问题样本。样本只包含表、rowid、问题类别，不输出消息正文或凭据。

产品修改仅四个既有文件：`sync/centralStore.js`、`sync/httpService.js`、`sync/sourceCatalog.js`、`mobile/portal.js`。没有新运行依赖、客户端状态格式或同步事件字段。SQLite会新增六个触发器，不能称为“零schema变更”。来源摘要追加在`provenance/storage-integrity-changes.json`。

## 检查方式与边界

在有该源码及Node24的环境，对已授权的数据副本运行：

```sh
node tools/check_sync_storage.cjs --db /absolute/path/to/authorized-copy.sqlite
```

退出0表示本工具检查范围内未发现问题；1表示发现问题；2表示文件不可访问、运行或检查条件不满足。缺失文件不会创建，旧schema不会由检查工具自动升级。它不实例化CentralStore，不安装触发器，不切换数据库journal_mode，不写修复值。WAL模式复制资料时，应保留一致的SQLite备份，不能随意只复制主文件。

检查范围限于messages/journal/applied_ops，不是整个宿主数据库或所有业务表的完整审计；quick_check也不等于物理介质可靠性证明。检查成功不证明工具副作用、AA或生产使用已成功。

遇到既存损坏：保存可靠备份与原始证据，在副本中确认seq、消息身份、hash与metadata；仅在有可信来源时恢复原内容。未知内容继续阻止跨越，不用墓碑替代，不跳过，不把旧版本追加成“最新”。本轮没有自动修复程序或生产操作。

## 直接验证

- 固定旧运行副本执行首批10项定向用例：4通过、6失败，复现了缺少JSON约束、错误400、错误内容仍被PWA输出、坏幂等回执和内部错误外泄分类等问题。只读检查工具当时已是新代码，不能把该10项称为“纯旧版整体测试”。原始TAP保留。
- 修复后的11项定向回归全部通过：覆盖旧表/seq41→42→43、非法JSON写入拒绝、合法NULL墓碑、读取损坏变体、真实Desktop/手机HTTP500及游标不动、恢复后继续同步、坏回执拒绝与原请求重放、授权外损坏不解码、4xx/5xx兼容、Source非法身份保持4xx、只读检查与坏引用。
- 原209项联合运行：最终25文件共**220/220**，失败/取消/跳过均0。包括原AA原生整链、派发屏障、人工退出、崩溃恢复和范围转换回归；反例测试通过仍不代表那些错误策略可上线。
- 联合首轮217/219：两项范围转换故障注入还期待服务器公开`INJECTED_SCOPE_FAILURE`。更新为严格期待500/SYNC_INTERNAL_ERROR，原“所有表与授权状态完全回滚”断言保留。原始失败没有删除。
- 联合通过后，仅优化只读检查工具的按rowid分页，补充超过128行及负rowid检查；再次单独执行上述11项，11/11通过。产品四文件与联合通过时一致。
- 干净检查前后主数据库与WAL字节摘要相同，业务行/指标/schema相同；坏数据检查也没有改动字节。缺失文件、缺列旧库场景分别验证无创建/无迁移。
- 生成产物一致性、来源链、禁止文件扫描和差异空白检查通过。PWA源码未变，未新增浏览器、手机设备或Windows现场验收。没有付费provider、真实工具或生产数据访问。

证据目录：`.local/contracts-experiment/storage-integrity-before/`、`storage-integrity-first/`、`storage-integrity-final/`、`storage-checker-final/`。前两份含预期复现和首轮失败，后两份含通过证据。

## 尚未完成的产品能力

本阶段解决存储损坏识别、写入语法约束、错误归类与只读检查；**没有解决损坏话题修复期间其他授权话题持续前进的可用性问题**。现有接收游标继续拒绝跨越坏记录。此前“原opId重发布天然兼容”的反例仍成立，隔离、快照或重发布需另行明确完整性与兼容合同。

该候选尚未合并或安装；主开发副本保持`9dc099b`。实际安装需核对目标宿主版本、完整候选依赖和数据库备份/恢复条件，不能把这个实验分支的四文件差异直接覆盖到任意历史版本。
