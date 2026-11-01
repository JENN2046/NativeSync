# 本机开发与测试副本

完整可启动VCP专用环境现已固定在`/home/jenn/NativeSync-Dev`，见[完整环境与实际浏览器验收](local-vcp-environment-20261031.md)。以下`.local/`目录仍是隔离模块/安装测试副本。

当前用户要求：开发、构建、测试副本安装和验证全部在本机进行。此前腾讯机的核对和试装
只保留为历史证据，不再是后续执行入口。本机验证工具不调用SSH、SCP或远端部署命令。
服务器上已存在的试装资料本轮没有操作，也不因这条范围调整自动删除。

## 当前本机位置

- 开发副本：`/home/jenn/.codex/worktrees/nativesync-contract-experiment/NativeSync`。
- 主开发副本：`/home/jenn/NativeSync`，仍保持独立，不自动合并实验分支。
- 配置：`.local/local-validation/CONFIG.json`，保存本机Node、依赖、候选包和公开源码模板路径，不提交。
- 模板：`.local/local-validation/templates/`；测试安装、备份、合成数据和回执位于
  `.local/local-validation/runs/<profile>/<UTC时间>/`，每轮使用新目录。

## 统一入口

```sh
# 现有公开宿主的本机安装/回退/联合验证
npm run test:local

# 在本机复现腾讯ce904c47宿主代码版本；不会连接腾讯服务器
python3 tools/validate_local.py --profile tencent-ce904c47

# 只准备本机模板并打印执行计划
python3 tools/validate_local.py --profile tencent-ce904c47 --prepare-only
```

`public`使用现有公共夹具；`tencent-ce904c47`使用本机已保存的127份非私密源码快照，
把目标专用接线应用到本机模板，依赖仍使用本机缓存。它不等于复制远端运行环境，
也不代表Windows、手机或服务器现场验收。

配置字段为`workspace`、`candidate`、`previous`、`publicHosts`、`node`、`dependencies`、
`pwaDependencies`、`tencentCodeSnapshot`。输入必须是现有本机文件路径，安装输出固定在
当前开发副本的`.local/`内。配置不保存账号凭据或真实业务配置。

入口复用`validate_release.py`：在本机安装前一包、安装候选、注入安装异常与进程退出、
恢复代码、再次安装，并运行已安装载荷的联合检查。保留原消息/任务身份、v3状态和
配置哨兵；不会打开本机真实聊天数据。HTTP与模型夹具仅使用本机回环和合成输入。
结果写入`RESULT.json`及`LOCAL_EXECUTION.json`，后者记录实际执行主机和本机安装路径。

最初候选为5b59803的77文件包，回退验证基线为支持v3的9dc099b代码包；本次只调整
开发与验证入口，没有修改候选运行代码或重建发布包。后续功能修改通过同一组装流程
在本机生成新候选，再更新本机配置中的包路径。

本轮已在本机 `jenn-System-Product-Name` 实际安装目标版本副本：220/220联合检查及8项安装/回退场景通过。最新本机回执位于 `.local/local-validation/runs/tencent-ce904c47/20261031T162120827352Z/`；该结果不是复用远端通过记录。

最新稳定候选、完整应用恢复验证入口和本机安装方式见[稳定交付验收](local-stable-closeout-20261031.md)及[操作说明](local-stable-install-20261031.md)。本机CONFIG中的候选已更新为stable-local-delivery。

此前候选推进至desktop-setup-final，增加全局设置中的NativeSync面板，见[桌面接入管理交付](desktop-sync-settings-closeout-20261031.md)。旧稳定包保留为兼容回退资料，不被新记录覆盖。

当前本机CONFIG已指向groups-accepted，群聊五项专项与原有14项整机分别运行，见[群聊交付](groups-closeout-20261101.md)。运行载荷83文件，三个宿主兼容补丁；固定环境已安装并保留原14条开发消息。
