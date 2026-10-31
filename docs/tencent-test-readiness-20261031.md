# 腾讯测试服务器：只读核对与独立试装

日期：2026-10-31。目标通过`ssh -F /home/jenn/.ssh/config tencent`连接，hostname为
`VM-0-12-ubuntu`，账户ubuntu。本轮核对和独立试装已完成；未切换或重启共享服务。
候选固定为5b598034c57f083df0ea6e6087a44fdee54bec83。

## 当前事实

|项目|已核对结果|
|---|---|
|Node|`/home/ubuntu/.local/node/bin/node`，v24.22.1，ABI137，Linux x86_64|
|共享服务|vcp-main.service active，PID2177756，启动时间2026-10-31 02:52:48 CST|
|实际代码目录|`/mnt/datadisk0/apps/AGENTS_OS_Workspace/runtime/VCPToolBox/releases/ce904c47-toolchain-20261022-r1`|
|来源记录|release-manifest.json声明source_sha=ce904c476f58e0857aa9ee828619158a82d75e7e；安装树不是Git检出|
|NativeSync安装前载荷|本机对应的56个ToolBox/PWA目标路径全部不存在；21个Windows文件不属于本机|
|宿主接线|server.js和Plugin.js没有NativeSync观察/路由接线，两个关联模块不存在；AA仍是接线前基线|
|现有账本|检查的NativeSync目录不存在，当前进程未持有NativeSync/central.sqlite文件；没有可核对迁移的既存NativeSync账本|
|磁盘|检查开始系统盘约1.3GB可用/97%，数据盘约2.1GB/96%；试装后系统盘约1.2GB/98%|

没有从私密配置读取实际业务数据目录、Topic、origin或凭据。因此“未发现账本”
限于所检查的安装目录和活动文件描述符，不宣称整台机器从未存放NativeSync数据。
非交互shell没有node的PATH项，不代表没有安装Node。

## 宿主兼容差异

原`compat/host-patches/VCPToolBox-native-execution.patch`在独立Git根目录中检查失败：
当前server使用localListenArguments，PluginManager的执行与审批上下文也已有变化。
不能将旧包的整文件或旧补丁直接覆盖当前接受版本。

已将原有接线移植到独立源码副本，补丁及三个文件的before/after摘要保存在
`compat/test-hosts/tencent-ce904c47/`。当前版本的监听设置、审批/信任授权、工具上下文
和stdio逻辑保留。AA的before与既有兼容基线一致，after同为9d6c94b1…。
本轮没有把此补丁应用到正在运行的共享服务。

## 服务器上的独立试装

目录：`/home/ubuntu/nativesync-trials/20261031-5b59803-r1`，最终约152MB。
数据盘根和apps父目录不可由ubuntu写入，未用sudo或更宽权限绕过，使用账户自己的目录。
只复制公开源码、公共夹具、锁定公共PWA依赖和原候选ZIP；不复制当前配置、账本或其他业务数据。

试装使用本机实际Node和现有node_modules，以及从当前宿主读取的127个静态相对JS依赖
和公开package/AA manifest；与已有公共夹具组合。接线补丁只应用到试装代码副本，
数据库和模拟模型均为新建合成输入，HTTP仅本机回环，不调用真实provider。

实际结果：

- 远端重新构建的77文件及整个ZIP与本地候选逐字节相同。
- ZIP SHA256：`d78990fef7c226a4d0fc5141b95f30679a2712f1d479fd396fa4d8fff427e6e9`。
- 安装、异常回退、实际进程exit76后恢复、脏文件拒绝、升级后新数据保留等8项检查通过。
- 原任务ID及seq保持，attempts=1，review_required保留，自动重派发为0；代码回退后新消息仍在。
- 真实MobilePortal提供全部8个PWA文件，HTTP正文摘要与包清单一致。
- 25文件联合检查220/220，失败/取消/跳过均0；包含测试专用模型和负面对照。
- 共享服务PID、启动时间及三处宿主源码摘要前后相同，没有停服务或更改其配置。

最初两次调度失败也保留：一次是转移后的PWA依赖目录未命名node_modules，导致Node
无法解析同级包；恢复标准目录结构后修复。另一次是续跑脚本引用旧输出目录，
修正显式路径后继续。没有因此修改候选产品或跳过验证。

本轮没有完整启动server.js，没有真实手机、TLS、浏览器缓存、Windows/NTFS验收，
也没有把现有业务账本复制进试装或验证历史数据迁移。共享服务尚未启用NativeSync。
试装资料和证据留存，未清理其他项目以腾空间。

## 共享实例接入前的具体范围

若继续接入当前vcp-main，这将是**新增56个运行文件及三处宿主接线**，不是旧NativeSync
实例上的四文件升级。必须先明确：

1. 采用目标专用补丁并重新核对逐文件before，按当前共享实例的发布流程建立新release；不编辑current或接受release。
2. 确定独立NativeSyncDataDir、启用模式、手机入口、话题/来源授权及已有凭据绑定；未确定的值不从其他项目配置猜测或复制。
3. 核对共享服务的模型、工具及AA活动，确定停启窗口；插件drain状态不能代表整台宿主空闲。
4. 空间和备份安排：保存实际before代码，保留未来已接受任务/数据；不能把9dc包当成这台机现有版本的回退快照。
5. 完整宿主启动与既有业务回归，再进入手机配对/真实使用验收。

当前任务的服务器核对与独立试装已经完成。共享实例激活属于额外影响范围，尚未执行；
远端工作区AGENTS.md将current定义为生产入口，并要求具体部署/重启目标的授权。

## 访问记录说明

初始检查脚本曾为了筛选非敏感字段读取config.env，这不符合随后读取到的远端工作区
“不得读取私密配置内容”规则；没有向输出、资料包或报告写入密钥值。发现后停止该方式，后续
检查仅用非敏感源码、路径、版本和服务元数据；该问题没有被隐去或视为额外授权。
