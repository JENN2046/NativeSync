# 本机稳定候选：使用、试装与恢复

适用范围：本机 Linux 专用 VCP 环境。真实 VCPToolBox、Electron、Chrome 移动视口与
AgentAssistant 原生查询链路；模型回复和外部效果均为本地合成。不是服务器或 Windows 安装说明。

## 版本与组成

候选包含运行载荷（数量以MANIFEST为准）、完整PWA、宿主兼容清单和已声明的桌面补丁。
若包中包含SETTINGS.md，NativeSync接入管理面板的操作与边界以该文档为准。
附件使用与Linux PDF兼容条件见包内ATTACHMENTS.md；Linux图片回退需要本机pdfinfo/pdftocairo。
全量Source接入、授权及兼容回退前提见FULL_SOURCE.md。启用全量自动续聊后，不能直接照搬早期选定话题的降版步骤。
运行文件逐项SHA见MANIFEST.json，补丁前后SHA见hostPatches，完整本机宿主指纹见
compat/dev-hosts/linux-full.json。固定宿主的历史源码基础和匹配增量见开发环境原有来源记录；
不能把该组合冒充另一个完整Git提交。包不包含依赖、凭据、聊天、SQLite或state。

本轮没有更改同步协议、状态格式或数据库迁移，没有引入新的恢复调度器。
故障测试的脚本化模型、代理、预加载和合成插件都在独立验证实例中，不进入运行载荷。

## 日常启停

```sh
/home/jenn/NativeSync-Dev/start
/home/jenn/NativeSync-Dev/status
/home/jenn/NativeSync-Dev/stop
```

start等待后端与NativeSync就绪，再等待桌面就绪；stop通过VCPChat原生closeApp执行受保护退出，
随后停止后端并等待排空。不以强制终止绕过busy拒绝。已退出的僵尸PID、被复用的外部PID不算活跃实例。
后端17650、管理17651、模拟模型17652、HTTPS17653、桌面调试17654、音频17655均使用本机回环。

PWA入口：https://127.0.0.1:17653/mobile/ 。证书只属于本机开发环境，系统信任库没有修改。
自动浏览器验证使用精确证书SPKI。默认只有NativeSync和AgentAssistant启用；可选插件不在本验收范围内。

## 安装与代码回退

使用候选包内的tools/install_local.py；它只接受固定开发根，或验证入口生成且有专用标识的本机目录。
公共夹具安装工具的限制保持不变。安装前正常停止本套实例，已存在的未知代码差异会导致拒绝安装。

以下路径中的候选、前一包和新备份目录必须实际存在或按说明新建，不能把任意旧包当作前一版本：

```sh
/home/jenn/NativeSync-Dev/stop
python3 /absolute/candidate/tools/install_local.py install \
  --package /absolute/candidate \
  --previous /absolute/known-previous-package \
  --backup /home/jenn/NativeSync-Dev-Backups/new-install
/home/jenn/NativeSync-Dev/start
```

前一包必须从该目标当前安装记录和逐文件摘要核对，不使用文档中的历史包名猜测。
如当前已经应用桌面提示补丁且其摘要准确匹配，重复安装可为零文件替换；这不等于没有校验。
新备份必须位于开发根之外，工具拒绝覆盖已有备份。

回退使用该次安装自己的备份，不使用其他版本的历史备份：

如果目标旧包不支持全量自动续聊，必须先完成FULL_SOURCE.md中的排空检查和source_compat.py prepare，
再执行下面的代码回退。全量阶段实际核验的旧目标为5a4ee82附件修复候选；SCOPE中的9dc099b只用于历史公共夹具组装，
不能把它当成本轮全量Source的安全降版目标。重新安装新代码后，停止状态下restore同一兼容回执，再启动。

```sh
/home/jenn/NativeSync-Dev/stop
python3 /absolute/candidate/tools/install_local.py rollback \
  --backup /home/jenn/NativeSync-Dev-Backups/new-install
/home/jenn/NativeSync-Dev/start
```

回退只恢复代码，保留安装之后接受的消息、任务身份、数据库、收件页、state和游标。
损坏或被修改的回退目标、备份会被拒绝。未知退出点先检查备份目录的INSTALL.json及当前逐文件摘要，
通过同一工具恢复；不要手工重置运行数据。工具的进程中断恢复不构成物理断电持久性证明。

## 重复验收与证据

源码提供tools/dev-environment/verify_full_runtime.py：每轮在/var/tmp/nativesync-full-runtime-<uid>/runs/
创建新实例，分别记录源码和控制脚本摘要、日志、截图、任务身份与独立调用计数。支持--cases定向场景，
失败现场保留；正常结束后恢复固定开发实例。使用--prepare-only只准备，不启停应用。

完整场景包括正常往返/重启、离线Outbox、已接受响应丢失、启动失败/恢复、两个回复持久化中断点、
工具未知结果与人工放弃/跨会话拒绝、AA终态查询/只读报告，以及真实代码安装/回退/再安装。附件双向、续传、回执丢失与按话题权限另列四项。
既有联合模块检查和八项公共夹具安装/回退单独记录，不与整机场景数量相加。

本轮经用户明确确认，fs.inotify.max_user_watches从262144临时提高到1048576，未写持久配置。
原262144额度已被当前桌面应用的监听占用耗尽；验证目录移到/var/tmp以减少工作区重复监听。
没有停止其他应用，未改变Rust知识库监听实现。重启机器后额度可能恢复为系统原值。
