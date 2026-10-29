# NativeSync R2.1

NativeSync 独立源码仓库。服务端插件、Windows Bridge、PWA与宿主兼容补丁分开管理；仍复用VCPToolBox/VCPChat的原生History、CDS、工具和AgentAssistant能力。

## 当前边界

- C1 Windows离线Outbox、修订版C2手机真实发送及跨端接续已有接受记录。
- 完整功能核心减法已安装：AgentManager恢复原基线，插件内展开不可变快照；完整执行模式仍有3处宿主补丁。
- 限域11份产品已按#70回执安装，首批两条旧历史入云与手机两话题只读查看已获列明范围审核；本仓新M2/M3冲刺不部署、不触碰生产、不推送。范围合同见 docs/limited-source.md。
- 这次是新的、可核对的源码快照导入，不冒充重建两个上游仓库的完整Git历史，也不是Release或生产安装。

## 目录

- overlays/VCPToolBox/Plugin/NativeSync：现役插件（含复用的原生纯规则）。
- overlays/VCPChat/modules/services/nativeSync：现役Bridge专属模块。
- overlays/VCPToolBox/apps/mobile：PWA源文件及锁定依赖；不提交dist。
- compat：独立宿主兼容补丁、原公开基线、依赖摘要与历史参考。stdio扩展不入本仓。
- provenance：逐文件来源、字节摘要、上游Git锚点与PWA构建对照。
- tests：纯函数测试、原分批反例修复验证及定向边界测试。

这些overlay保留部署相对路径，不通过大规模改import伪装为零宿主依赖。不要将compat基线或历史patch整文件覆盖到生产；当前生产已含这些接线，重复应用会冲突。

## 验证

`npm test`仅运行无凭据的纯函数测试。`python3 tools/verify_source.py`核对来源和禁止文件。

PWA：在overlays/VCPToolBox/apps/mobile使用锁定依赖构建；当前已实跑8/8产物摘要与已部署版本一致，具体见provenance/mobile-build-verification.json。构建不连接真实API。

完整集成测试需要匹配的公开宿主源码和独立依赖，不包含真实AppData或数据库。参见tests/README.md和compat/README.md。

## 协调及许可

当前唯一协调入口仍为[JENN2046/VCPChat #70](https://github.com/JENN2046/VCPChat/issues/70)，不自动迁移或重开旧接受结论。

保留上游CC BY-NC-SA 4.0文本和署名。原文本分别位于LICENSES/；NOTICE.md记录来源与修改边界，不将作者框架声明为本项目原创。

真实Key、配置、历史、Journal、execution、设备/空间状态和证据中的私有元数据不入仓。生产独立于此检出目录。初始提交已按授权首次推送，见 provenance/first-push-fact.json；原 pushed:false 记录保留为推送前事实。本次限域候选不Push、不改部署。

## M2/M3 隔离进度

`docs/m2-m3.md` 区分已支持路径与既有绑定扩展的缺口。`test:m2-m3` 运行定向合成集成
及真实进程退出；保留一个明确失败的必需升级探针，退出2表示PARTIAL，不代表全绿。
原两话题持续写入的生产授权仍待决定；隔离测试不授予实际部署、更多真实资料或发布权限。
