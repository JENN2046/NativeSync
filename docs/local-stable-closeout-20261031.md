# NativeSync 本机稳定交付验收

2026-10-31（America/Adak）。已完成本轮批准的“现有流程稳定交付”范围。
候选来源7274711，构建时工作区干净；维护分支为experiment/contracts-boundary。
主开发副本仍为9dc099b且干净，没有合并、推送、服务器连接或部署。

## 交付物

- ZIP：`.artifacts/NativeSync_Local_Stable_Delivery_20261031.zip`。
- SHA256：`cc208198c29f6129d42a2a44bec63e86f17dfa313ce5e2b4c75ae4a0eaed8a08`。
- MANIFEST摘要：`0f41dac24df49fe40a78694beb86ea926bd71539a80414d088952cebb1ee0858`。
- 包含77文件运行载荷、完整PWA、宿主补丁及指纹、公共夹具和专用本机安装工具、LOCAL_INSTALL.md。
- [可重复操作说明](local-stable-install-20261031.md)；机器可读汇总为`provenance/local-stable-delivery-20261031.json`。

77项运行载荷与5b59803候选逐字节相同，本轮将已验证的桌面诊断补丁、完整本机宿主要求和安装能力收拢进交付。
没有为已有正确恢复路径增加新框架。新修复集中在开发控制器：正确识别僵尸/外部PID，后端提前退出时停止等待，
通过原生closeApp完成受保护桌面退出，并等待managed-ready，避免把提前强制结束误报为应用启动故障。

## 同一交付包的实际验证

|层次|结果|范围|
|---|---|---|
|公共宿主模块联合回归|220/220，失败/取消/跳过0|安装载荷、合成HTTP/SQLite、原AA整链等既有检查|
|公共夹具安装/回退|8项通过|篡改/脏文件拒绝、中途异常、实际子进程exit76恢复、数据保留、静态资源等|
|完整VCP整机|9项通过|真实server.js/adminServer.js、Electron、Chrome移动视口、本地脚本化模型|
|ZIP解包验证|77项及辅助文件摘要一致|独立解包后运行包内校验工具|
|只读账本检查|问题0|完整测试实例21条，固定开发实例6条；messages/journal/applied_ops及引用|

完整场景分别为正常双向往返及重启、离线Outbox保留原opId、已接受但响应丢失后核对/显式重放、
缺少首次历史证明的可见失败与修正、reply-intent进程退出、reply-applied进程退出、
工具效果未知与人工放弃/跨会话操作拒绝、AA归档终态查询与只读报告，以及实际代码安装/回退/重装。
后端两个回复中断点恢复后模型次数不增加；效果文件始终只有一次写入；AA子模型调用保持1次，
原任务/调用身份不变，查看报告不追加聊天。父任务按自身已有事实处理，不因AA终态而伪造成功。

完整实例位于`/var/tmp/nativesync-full-runtime-1000/runs/20261101T054715291512Z/`，
RESULT.json、PROVENANCE.json、日志及截图均保留；源码和验证脚本摘要可定位该轮代码。
正常桌面退出日志FATAL计数0，指定崩溃点仍使用真实后端子进程exit78；均不是物理断电测试。
公共夹具回执在`.local/stable-local-validation-delivery/`。三个安装/整机回执引用同一个MANIFEST摘要。

初期失败资料没有删除：包括PWA选择值/界面加载时序、测试插件类型不匹配、共享监听额度耗尽，
以及旧测试停机方式造成的Electron异常日志。修正测试接线和停机方式后，使用全新实例完成上述最终整轮。

## 固定开发环境

`/home/jenn/NativeSync-Dev`已用包内专用工具完成校验安装并重新启动，桌面与后端就绪。
其原有运行文件与桌面补丁已经完全匹配，因此此次实际替换0文件；没有将幂等校验冒充77次替换。
独立整机实例则实际完成了桌面文件替换、回退和重装，验证代码回退后消息、Journal、原任务及attempts保留。
固定环境原6条消息、任务身份和attempts完全保留，cursor=6、Outbox=0、Inbox=0。
备份与安装计划位于`/home/jenn/NativeSync-Dev-Backups/install-20261031-stable-delivery/`。

已在用户明确确认后，将本次开机inotify额度262144→1048576；没有写持久配置，没有结束其他应用。
测试副本放在本机/var/tmp，未改Rust知识库监听实现。原始日用数据、业务凭据没有复制进测试实例。

验收覆盖Linux Electron与Chrome移动视口、模拟模型和合成效果；Windows、实体手机、真实模型与业务工具
仍未验收。没有新增协议、迁移、数据修复工具或损坏隔离能力；这些不作为本轮交付前置条件。
