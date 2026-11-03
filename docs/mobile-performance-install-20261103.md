# 手机性能修复生产安装回执

2026-11-03（America/Adak）。用户批准候选 `a78ce02` 追加安装并暂停生产新请求后，已完成腾讯生产后端正常停启及四路径安装。Windows文件未修改，无需退出或重新配对。**代码安装与服务端检查通过；Android实际性能、保存和重开仍待用户确认。**

## 安装与保留

- 候选源码：`a78ce02139c6246df72f3a594184dc78d1be6318`；ZIP SHA256：`4a1fb00213e2771ad52349a09c8e89d1b193c212c9a52a6e1a2b9eac1706ccae`。
- 目标核对为 `VM-0-13-ubuntu / ubuntu`。全部57项旧生产载荷、配置及四项目标摘要核对通过，模型、AA、工具、同步在途数均为0；备份空间满足本次一致快照及保留余量。
- 只替换 `Plugin/NativeSync/mobile/attachments.js`、`apps/mobile/dist/index.html`，新增 `assets/index-CcV6qDxz.js` 和 `assets/index-PVIWXUde.css`。旧PWA资源保留。完整候选85项载荷及38项支持文件在暂存处校验通过。
- 备份：`/opt/AGENTS_OS_Workspace/backups/NativeSync/mobile-performance-20261103`，含被替换代码、`INSTALL.json` 和包含已提交WAL的一致 `consistent.sqlite`。SQLite快照SHA256：`ab34cc4ca04b593e38fa9825e85a1ef90ce8064605cfe81a5156d8f2c733229c`。
- `vcptoolbox.service` 正常停止后安装并启动，PID由1790222变为1821319，状态active/success；管理服务PID、根配置和插件配置均保持。没有恢复数据库、state、游标或授权。

## 直接核对结果

安装停止期间所有数据库表事实摘要恒等；重启后只有桌面定期上报的 `source_observations` 更新。1170条消息、1175条Journal、1175条回执、两个Source绑定、原执行记录、5个手机会话及12个配对记录均保持，旧权限无扩大。Windows原809条消息在服务端身份/hash全匹配，32/32话题历史就绪，Journal head仍1175。存储只读检查issues=0。

新候选全部57项生产文件摘要匹配。后端私有回环入口的页面、新JS和CSS均返回200且响应字节摘要匹配；Source数据v2、桌面引用和联合配对能力保留。最终生命周期为RUNNING，模型、工具、AA及同步执行在途均0。未发送真实模型或工具请求，也未修改Cloudflare策略。

本轮复用[本机性能修复](mobile-performance-20261103.md)的直接回归与候选浏览器证据，没有重跑旧安装矩阵或AA／工具场景。部署期间没有操作Windows数据或进程；现有31项续聊配置限制、两项不支持附件及桌面活引用边界保持，不将它们宣称为本轮修复完成。

## 实机与恢复边界

已请用户刷新既有生产手机页面，对原卡顿会话的载入、切换、更早消息、大文本，以及文件保存和重开集中验收。无需清数据或重新配对。源站检查和本机Chrome结果不替代Android性能验收。

本次代码备份覆盖两项替换文件，两个新增静态资源保留也不影响旧页面入口。若出现回归，须核对当前代码与在途状态后按四路径处理代码恢复；不得恢复旧SQLite、state、游标、Source范围或手机会话。本次没有实际执行回退，不将其记作回退验收通过；也不承诺整个旧候选可降版读取Source数据v2。

机器回执与证据摘要见[安装记录](../provenance/mobile-performance-install-20261103.json)。详细现场保留于 `.local/mobile-performance-20261103/`，不含在公开运行载荷内。
