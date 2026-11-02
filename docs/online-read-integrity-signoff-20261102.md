# 在线读取加固：正式签字与本机升级

日期：2026-11-02（Asia/Shanghai）。用户已明确批准本次本地主分支推进及专用开发环境升级，并另行批准固定Electron路径的AppArmor规则。此前的[验收报告](online-read-integrity-closeout-20261101.md)保持原样，是签字前记录。

## 接受范围

接受“共享`msg_id`的旧Journal行错归属”仍可能同时通过在线与离线校验的边界，以及`idx_journal_message`首次打开既有库时的一次性建索引时间和空间开销。本版本不称“归属根治”或“黄金基线”。签字不扩大为V2协议、归属账本或数据库迁移施工。

`/home/jenn/NativeSync`的`fix/architecture-recovery`从`9dc099b6007e018a9743d72048d5e6fbb43b94e7`以`--ff-only`推进至`0da22c4d357febb1ab01dde24c332c78c9f72655`，包含应用提交`144e0dc4681dbd94410dd9a4a44d93c23f61e320`及此前交付。无合并冲突，没有推送或访问服务器。本文及安装回执随后单独提交，不改变已验收运行代码。

`release/scope.json`继续明确排除`packages/execution-decisions`运行接线和`haltedTopics`协议；候选84项载荷中均不存在这两个实验组件。

## 日常开发环境升级

目标仅为`/home/jenn/NativeSync-Dev`。候选ZIP SHA256仍为：
`35b7e67055fb07b8d27221f231d77e8d9fb771b1774a0957055b187ec8c2cd30`。
MANIFEST SHA256：`91134a1656d23ee80b8aa3550fb0f85e8ab55e0893eece5590e4bded195dad95`。

1. 逐项核对现装全量C的84个运行文件及17项宿主指纹，确认没有未知改动；核实Source计划、队列和在途任务已结清。
2. 通过原生受保护退出正常停止本套应用。对NativeSync `central.sqlite`及知识库`knowledge_base.sqlite`分别使用SQLite backup API制作包含已提交WAL的一致快照，逐表逻辑摘要与原库相等，`quick_check`通过；同时保留当时存在的原始DB/WAL/SHM旁文件。
3. 使用候选内`diagnostics/check_sync_storage.cjs`检查NativeSync原库和备份，均0项异常。原有messages、Journal、applied_ops各14条。
4. 复用候选包本机安装器，只替换已声明的6个服务端文件。安装期间15个受保护配置/历史/状态文件逐字节不变；84项运行载荷全部匹配新候选。安装器未修改数据库或状态。
5. 启动并核对真实Electron及后端：Source全量模式、cursor=14、Outbox=0、inbound=0、导入/配置待发布=0，无降级或配置错误。真实Source授权HTTPS Pull返回14个事件，全部hash与原Journal一致。
6. 重启后messages、Journal、applied_ops和3个已有执行任务的全部行摘要不变；设备、空间、Source绑定与连接配置保留。6个JSON触发器及新增索引存在；再次只读体检0项异常。模型调用为0，没有新增测试消息。

桌面正常刷新了`execution-status.json`的派生观察缓存；其Source绑定和缓存任务状态已与现存库核对。该文件不是History/Outbox或执行事实权威，不能用其观察时间更新误判接受数据变化。没有恢复任何旧数据库、state或游标。

备份与代码回退点：
`/home/jenn/NativeSync-Dev-Backups/online-integrity-signoff-20261102T082820Z/`。
其中`sqlite-backups/`为一致快照，`raw/`为原始旁文件，`code/INSTALL.json`为本次代码安装回执。目录为私有备份，不纳入公开交付或Git。

如果以后需要退回上一全量C，应先正常停止并核实排空，再使用本次`code/`回执执行代码回退；不恢复SQLite、state、游标、Source绑定或执行快照。本轮没有再次执行旧安装故障矩阵或实际回退，复用已有相同安装器证据。

## 本次启动现场与修复

初次升级启动时，后端就绪，但Electron在ready前被系统AppArmor拒绝创建用户命名空间。保留了`E_ELECTRON_CRASH_BEFORE_READY`诊断及内核拒绝记录，未将其归因于NativeSync读取校验。

用户另行明确批准后，安装并加载`/etc/apparmor.d/nativesync-dev-electron`：仅附着于`/home/jenn/NativeSync-Dev/.dependencies/VCPChat/node_modules/electron/dist/electron`，采用系统已有同类配置的`flags=(unconfined)`与`userns,`规则。语法检查及内核加载通过，实际Electron主进程已处于该profile。没有修改全局userns限制，也没有新增全局`--no-sandbox`参数；宿主原有部分preload窗口的`sandbox:false`设置保持原样，不宣称所有窗口都启用了渲染沙箱。

第二次启动揭示当前命令执行器未继承`DISPLAY`/`XAUTHORITY`。从同一用户现有图形会话读取限定的显示变量后，原启动器成功启动桌面；没有修改宿主代码或配置。后续从非图形终端启动时，也需要传入当前桌面会话的显示变量，不能永久写死临时Xauthority文件名。

最终provider/backend/admin/https/chat均运行，真实主窗口及NativeSync就绪。启动失败诊断保留，不删除现场或伪造首轮成功。

## 证据

机器可读回执：[签字与安装摘要](../provenance/online-read-integrity-signoff-20261102.json)。
本机原始现场：`/home/jenn/NativeSync/.local/online-integrity-signoff-20261102T082820Z`。

独立冷启动和专项逻辑回归沿用同一候选的既有证据；本轮新增的是实际主分支推进、日常副本一致备份、安装、真实既有历史读取及重启身份核对。没有新增Android、Windows或生产验收结论。
