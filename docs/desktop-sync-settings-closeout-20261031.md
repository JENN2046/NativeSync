# 桌面接入管理交付

本轮第1项已完成并安装到固定本机环境。入口为「全局设置 → NativeSync」，已打开该面板。

功能源码提交cf5ba57，最终候选来源66c94fd（构建时干净）。新功能使用宿主已有Feature、设置扩展、
preload与退出保护；没有给main.js、renderer.js或全局设置核心增加NativeSync专属分支。

## 已交付

- 首次选择1—8个已保存话题，检查现有HTTPS连接与双方历史，明确确认后保存。
- 首次确认披露所选历史和手机续聊所需助手设定的上传范围；Key不复制到接入配置，不返回面板。
- 查看当前同步状态、待同步/冲突/已接收待写入数量与错误；区分已保存意图和当前运行配置。
- 保存后通过原生受保护退出，再从原启动入口重新打开生效；不在运行中切换Bridge。
- 已有绑定停用/恢复保留设备、范围、游标与Outbox；历史只同步配置不被自动改成上传私密执行设定。
- 已有范围锁定；Source模式只读。保留服务端现有话题绑定要求，不自动扩权。

[使用与接口说明](desktop-sync-settings-20261031.md)。三项chat专用IPC在主进程再次验证主窗口主frame；
首次检查为只读，配置保存走原有durableJson，不写历史、state或数据库。连接校验仅提取现有语义函数复用，
同步协议、状态格式和数据库没有迁移。

## 验证与实际安装

同一最终包的233项联合检查全部通过（原220项加13项接入设置用例），八项公共夹具安装/回退通过。
十个完整应用场景全部通过：保留原九项，并加入实际设置页首次接入、历史变更拒绝、重开生效、停用与恢复。
恢复后原deviceId及游标保留，设置场景没有新增模型请求。正常桌面关闭的FATAL日志为0。

完整实例：`/var/tmp/nativesync-full-runtime-1000/runs/20261101T063449751830Z/`。
模块与公共安装回执：`.local/desktop-setup-final-validation/`。
三个整机/公共安装/固定环境回执引用同一MANIFEST摘要，见`provenance/desktop-sync-settings-20261031.json`。
ZIP独立解包后83项运行载荷及辅助文件校验通过。

固定环境`/home/jenn/NativeSync-Dev`实际更新7个代码文件（新Feature六文件及连接校验模块一文件）。
原6条开发消息、连接配置和state的字节摘要未变，消息/任务身份与attempts也保持；当前Bridge正常运行。
界面截图：`/home/jenn/NativeSync-Dev/evidence/native-sync-settings-installed.png`。
新备份：`/home/jenn/NativeSync-Dev-Backups/desktop-setup-final-20261031/`。

## 本轮发现并修正的问题

初始设置服务会把启动时一次读取失败永久留在基线中，导致原路径问题修正后刷新仍失败；
现区分不可读启动基线，允许查看修正后的文件，并明确要求重新启动。目录别名和硬链接拒绝断言保留。

实际固定目录试装发现专用安装器未创建新Feature父目录，自动回退完成，未改数据。
补齐父目录创建，并让整机升级测试先移除目标空目录，验证真正的“目录不存在”路径。
原失败备份`/home/jenn/NativeSync-Dev-Backups/desktop-setup-20261031/INSTALL.json`保留rolled-back状态。
公共脏目标测试原先假定候选排序首文件必定属于旧版本，新增Feature使假定失效；改为选两包共有文件，
脏目标拒绝的条件和断言未放宽。早期失败资料仍保留，没有把这些失败计入最终通过结果。

## 候选与边界

ZIP：`.artifacts/NativeSync_Desktop_Setup_Final_20261031.zip`。
SHA256：`a3e44906c211b88fbe4a950939a6b03c6ab37078ad0b0f8b100cddbd8b9a36c2`。
MANIFEST SHA256：`019a1ff7eca7225576c402892517ec946e7bd1c78d00ae48760e3fb30653b419`。
包内含SETTINGS.md、LOCAL_INSTALL.md和本机安装工具；运行包由77增至83文件。

仅本机Linux Electron/Chrome移动视口、模拟模型和合成效果验收；Windows、实体手机、真实模型/业务工具未验收。
未连接服务器、未合并或推送，主开发副本保持9dc099b。没有新增修复工具、隔离协议或Source范围迁移。
