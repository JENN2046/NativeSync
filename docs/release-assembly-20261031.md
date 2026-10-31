# NativeSync 本地试装候选：统一组装与代码回退

日期：2026-10-31。当前工作在独立副本；主开发副本仍为9dc099b，没有合并、推送、生产安装或真实设备操作。候选用于下一轮测试环境准备，不是已批准的生产安装包。

## 候选范围

|进入候选|保留为测试实验，不安装|
|---|---|
|停止受理/排空、收件页、任务分页、空写消除|纯执行决策的逐行SQLite适配器|
|packages/sync-contracts的共享确定性规则|谓词分组原型、基准工具|
|存储完整性读取校验、JSON写入约束和5xx分类|损坏记录跳过、修复重发布或隔离协议|

执行器恢复为0c5cf07中的原批量SQL/原Journal收尾路径。`packages/execution-decisions`与`tests/fixtures/executionLifecyclePrototype.cjs`继续提供模型对照，不进入运行包。

源码overlays不再保存任何generated业务副本。原适配器仍按部署相对路径加载契约文件；`tools/build_contracts.mjs`只往显式组装目录生成两个CJS和一个ESM文件。转换使用PWA锁文件已有的rolldown，不再用正则删除export或手写导出名单；构建根目录固定，输出不依赖调用者cwd。

## 包中有什么

完整安装载荷77文件：VCPChat Bridge 21、ToolBox插件与已有集成模块48、PWA静态产物8。ToolBox的两项集成模块是`modules/requestExecutionContext.js`与`Plugin/AgentAssistant/delegationContinuity.js`；既有server.js/Plugin.js/AgentAssistant.js接线继续属于宿主要求，不自动重打补丁。

- `payload/`：安装载荷，包括默认`Plugin/NativeSync/mobile-dist/`的PWA。
- `MANIFEST.json`：每项载荷的相对路径、字节数、SHA256，以及源码输入摘要、构建配方摘要、实际构建依赖版本和辅助文件摘要。
- `SOURCE_INPUTS.json`、`SCOPE.json`：来源及候选取舍。
- `compat/`、`LICENSES/`、`NOTICE.md`：宿主要求、历史兼容资料与署名。compat中的补丁和基线不是自动覆盖清单。
- `diagnostics/check_sync_storage.cjs`：候选包的只读账本检查工具，默认读取同包中的运行校验代码。
- `tools/install_release.py`：仅操作带公共夹具标识的隔离目录，可验证、试装和恢复代码。

包中不含node_modules、测试宿主、实验模型、config.env、AppData、UserData、state、SQLite或构建缓存。组装目录中的`assembled/`供构建和测试使用，不放进安装ZIP。PWA源码也不安装到服务端运行目录；测试中的PWA源内核明确从assembled读取。

## 本地构建

使用Node24及依照`overlays/VCPToolBox/apps/mobile/package-lock.json`准备的依赖目录。本轮实际使用Node24.22.1、Vite8.3.5、Vue3.5.44、plugin-vue6.0.10、rolldown1.2.15；不新增依赖，不在构建时联网安装。

```sh
python3 tools/assemble_release.py \
  --out /absolute/new/candidate \
  --node /absolute/node24 \
  --pwa-dependencies /absolute/locked/node_modules \
  --zip /absolute/candidate.zip
```

生成器和PWA共用已有锁定构建能力。每次只使用新输出目录；组装前后核对产品来源摘要。ZIP使用固定条目顺序/时间戳，安装日志不混入ZIP。重复构建的payload、清单和ZIP摘要见最终本地回执，不把“相同版本号”当成字节一致的证明。

完整隔离验证可用以下入口（所有路径均指本地合成环境）：

```sh
python3 tools/validate_release.py \
  --candidate /absolute/candidate \
  --previous /absolute/previous-package \
  --template-hosts /absolute/public-host-template \
  --out /absolute/new/validation \
  --node /absolute/node24 \
  --dependencies /absolute/locked/host/node_modules \
  --pwa-dependencies /absolute/locked/pwa/node_modules
```

验证解包后的包：`python3 tools/install_release.py verify --package /absolute/candidate`。包校验不等于目标宿主就绪。

## 隔离试装与代码回退

试装工具要求目标含`.nativesync-isolated-test-root`且内容为`public-fixture-only`，不提供绕过该限制的生产模式。它核对现有宿主摘要要求与前一包的逐文件before，拒绝脏文件、符号链接和越界路径；先备份受影响代码，保存安装计划，再逐文件替换。

```sh
python3 tools/install_release.py install \
  --package /absolute/candidate \
  --previous /absolute/previous-package \
  --isolated-hosts /absolute/public-host-fixtures \
  --backup /absolute/new/code-backup
python3 tools/install_release.py rollback --backup /absolute/new/code-backup
```

回退只恢复代码文件，不恢复state、收件页、SQLite或配置。回退前先完整核验当前文件和备份；安装后有本地改动会拒绝覆盖。旧PWA带hash静态资源保留，避免清理仍被旧页面引用的文件。新增JSON触发器可在兼容旧代码下保留，不靠删库或撤回已接受事实回退。

本轮兼容回退基线是本地候选`9dc099b6007e018a9743d72048d5e6fbb43b94e7`，同样支持v3/native-message-intents-v2。**它不是当前生产before快照，历史354d52ac也不能当成v3数据上的安全降版目标。** 原始生产回退范围必须在实际试装前重新核定。

## 实际验证

- 完整链路使用公共宿主副本，从9dc包启动、安装候选、回退代码、再安装；每个运行版本用新子进程加载，避免require缓存伪造版本切换。
- 原消息seq=1、原op回执和任务ID保持，attempts一直为1，未知工具的父任务仍是review_required，自动派发为0。Journal行数2→3→4：候选新增的消息在回退后仍存在，回退后也能接受合法新写入。
- 独立v3状态哨兵与config.env字节保持；实际Adapter迁移/恢复由联合架构回归覆盖，哨兵本身不是Windows文件系统验收。
- 真实安装进程在两个代码文件替换后exit76，后续进程根据prepared计划恢复；中途普通异常也恢复。该证据不等于物理断电或磁盘持久性验收。
- 脏目标、被篡改载荷、脏回退被拒绝。试装后由真实MobilePortal按默认路径提供全部8个PWA文件，HTTP正文摘要与安装清单相同；没有浏览器渲染验收。
- 对已安装载荷运行25文件、220项联合检查，未再把源码覆盖到宿主。包括测试专用模型/负面对照，不能把220解释为220次真实设备使用；安装前后实际载荷摘要另行核对。
- 首轮217/220：两项生成检查揭示cwd导致编译注释路径变化，一项PWA附件测试仍找旧源码位置。修复构建根目录与夹具源路径后通过。原始失败证据保留，没有跳过断言。

## 进入测试环境前仍需确认

当前生产/测试目标尚未做这轮readiness核对。需要确认实际Node/ABI、宿主接线版本、dirty内容、完整before清单、停启窗口、数据备份和v3向前恢复路径；配置了`NativeMobilePwaDir`时，还要明确静态产物的实际发布位置。包中的历史兼容资料不能代替这些当前事实。

Windows/Electron、NTFS替换/权限、真实手机、TLS和浏览器缓存更新仍未验收。损坏Journal仍不允许被静默跨越。这些限制没有因打包或本地测试通过而消失。
