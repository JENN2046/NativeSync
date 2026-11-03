# NativeSync 本机候选安装入口

本包适用于固定Linux开发副本或带本项目标记的本机合成验证目录，不包含服务器部署授权。
实际源码、运行载荷及宿主补丁均以本包MANIFEST.json为准；当前验收结果另见源码中的全量阶段交付记录。
历史阶段的测试数量、旧代码引用和旧回退组合不能替代本包的证据。

## 校验和安装

先验证解包内容：

```sh
python3 tools/install_release.py verify --package /absolute/candidate
```

固定开发副本的正常启停、目标摘要核对、前一包选择、外置备份及代码安装命令见LOCAL_INSTALL.md。
安装器核对MANIFEST、宿主要求和已声明补丁；未知改动会被拒绝。它只安装代码，不修改配置或恢复数据。
公共夹具安装器保留原有限制，不能用于任意宿主。

全部Agent／群聊模式先阅读FULL_SOURCE.md：客户端与服务器须明确批准同一Source和all-supported执行模式，
手机使用新的Source配对授予整个来源及未来话题权限；旧手机会话不会静默扩权。配置、群聊和附件细节分别见
SETTINGS.md、GROUPS.md、ATTACHMENTS.md，临时Android入口见ANDROID_TEST.md。

## 全量Source代码回退

**后续数据兼容限制优先：一旦接受desktop-references-v1或source-data-v2数据，本候选不声明下面旧包组合可直接读取。不得直接降至旧codec；保留新codec向前恢复，不恢复旧数据库、state或游标。以下是接受扩展数据之前的历史回退组合。**

只有导入、提交、执行及未知原生工作均已明确收尾，且本项目实例正常停止后，才运行source_compat.py prepare。
它保存并移除本来源新增配置键；随后使用该次实际安装的外置备份回退代码。
本阶段核验的旧候选为5a4ee82附件修复版，保留Source历史和读取，停用新增自动续聊模式。
重新安装新代码后，停止状态下用同一兼容回执restore配置，再启动。完整命令见FULL_SOURCE.md。

SCOPE.json的codeRollbackBaseline是早期选定模式的公共夹具组装输入，不是全量Source的降版承诺；
全量组合以fullSourceRollback字段和实际安装回执为准。检查失败时保留现场并向前恢复。
始终保留数据库、state、游标、范围、授权绑定和已接受执行快照，不通过删数据或恢复旧数据完成回退。

包中不包含凭据、聊天、SQLite、原生依赖或完整宿主。模型、手机、Windows与远端的支持边界以实际交付记录为准。

## 原生有效规则与多来源候选

新版桌面runtime支持可选`readEffectiveTavernRules(descriptor)`，应由匹配宿主调用原生`conversationContext.resolve`并返回其rules。包内`compat/host-patches/VCPChat-effective-owner-rules.patch`仅适用于JSON所列before摘要；现有固定开发副本安装器不会自动应用该日常宿主补丁。未接该回调的旧宿主继续使用全局规则。

手机只显示已有会话获准访问的来源，并可按来源筛选；同名Agent保持独立身份。新的联合配对需先确认`/mobile/api/connection`能力`multiSourcePairing`为true，然后使用原受保护配对入口提交`scopeMode:"sources"`与`sources:[{sourceId,snapshot}]`。每项snapshot必须明确为true（当前话题固定快照）或false（该已批准来源及未来新增内容）。未知/重复来源、缺少明确选择、单一来源请求试图添加其他来源均拒绝。

这些能力不修改已有Source授权或旧手机会话，不自动解除只读限制。日常/生产安装需使用当次匹配目标清单；不要因新候选存在就套用旧固定清单或恢复数据。

2026-11-02（America/Adak）已按用户授权安装`a27f601`至日常桌面及腾讯生产，精确目标、备份和回退边界见[本次安装回执](effective-rules-multisource-20261102.md#日常与生产安装回执)。旧手机权限及只读状态保留，联合配对未创建。

2026-11-03多来源转换修正：仅移除full转换对“任意其他来源存在”的整库排斥；真实目录身份碰撞和按来源读写屏障保留。Windows安装已完成但扩围受阻，生产单文件修复尚待批准，见[执行记录](windows-full-source-install-20261103.md)。

真实历史兼容候选增加desktop-references-v1元数据能力，Source操作有界4MiB、批量传输60秒，旧选定模式限制保持。先安装新服务端/读取屏障，再安装匹配桌面；已有新引用后不支持直接退旧codec，保持full范围及数据向前恢复。临时拒绝附件诊断沿用既有列，原件不删。详见[开发交付与降版边界](windows-source-data-compat-delivery-20261103.md)。


## Source大历史与重复文件引用（source-data-v2）

本候选支持Source单操作16MiB、附件元数据合计2MiB；无附件的控制元数据仍受原768000字节限制。旧选定模式保留1MiB请求限制，不能发布扩展表示。Source info须声明sourceDataV2、maxOperationBytes和maxMetadataBytes；桌面先核对Source/设备/空间及实际载荷所需限额，再发送。新读取者声明`source-data-v2`，旧客户端命中扩展历史页返回409；普通删除事件没有扩展正文时继续兼容。

相同附件id的规范化元数据完全一致时存一份attachmentData，消息体保留每次引用与顺序；同id不同hash/提取文本/帧元数据继续拒绝。桌面入站按出现次数保留对应原生句柄，手机按出现位置显示重复引用，不重命名、不造hash、不截断正文。

服务端新codec、能力屏障及PWA应先于桌面安装。发布边界变化不授予新Source或手机权限；原有只读原因和格式限制保持。源码候选不等于Windows/生产安装或Android实机验收；以本次安装授权、精确前后摘要及实际回执为准。
