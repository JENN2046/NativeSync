# 专用本机环境脚本

这些文件的安装位置为 `/home/jenn/NativeSync-Dev/bin/`，运行时相对该目录解析开发根。
当前固定环境已经安装，不需要重新复制原配置或数据。

`dev.py start|stop|status` 管理本环境进程；`desktop-ready.cjs`只读核验实际Electron和同步就绪。
`local-provider.cjs`提供明确标识的本机模拟回复；`https-proxy.cjs`使用config内本环境新生成的证书。
`verify-desktop-diagnostics.cjs`在实际Electron内创建临时测试面板，验证四种状态。
`verify-mobile.cjs`用独立Chrome配置与本地证书SPKI执行浏览器验证，会向本开发话题发送消息。

这些脚本不生成或携带凭据，不建立服务器连接，也不是通用VCP安装器。完整源码/依赖来源、
启动方式与限制见 `docs/local-vcp-environment-20261031.md`。config和data不纳入Git。

## 完整应用恢复验收

```sh
python3 tools/dev-environment/verify_full_runtime.py --package /absolute/candidate
# 定向复现；默认全部九个场景
python3 tools/dev-environment/verify_full_runtime.py --package /absolute/candidate --cases effect,aa
```

该入口会正常停止固定开发实例，在`/var/tmp/nativesync-full-runtime-<uid>/runs/`建立新源码、
数据、证书和浏览器配置，运行真实server.js/adminServer.js/Electron/PWA，结束后恢复固定开发实例。
`RESULT.json`、`PROVENANCE.json`、`logs/`及`evidence/`保留，包括失败现场。`--prepare-only`不停止应用。
`--resume`仅用于继续已有测试实例，不重置其数据；需要重测首次接入或一次性故障时使用新实例。

`full-support.cjs`是仅限隔离目录的模型/HTTPS代理测试夹具，支持断同步与丢弃已接受响应；
`full-preload.cjs`只通过测试启动命令的`--require`加载，复用现有执行故障钩子；
IsolatedEffect是该实例新生成的direct hybridservice插件，只写入并fsync一个合成效果标记。
它们不进入产品运行载荷，没有增加产品故障接口。

`install_local.py`用于固定开发根及本入口生成的实例，要求停止本套进程，核对完整宿主和前一包摘要，
只替换包内代码及已声明的桌面补丁；拒绝未知目标和脏文件。回退仅恢复备份代码，不回退数据库或状态。
候选包内`tools/install_local.py`与`tools/install_release.py`可独立配合使用，公共夹具安装器限制保持原样。
