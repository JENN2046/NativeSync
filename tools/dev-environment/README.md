# 专用本机环境脚本

这些文件的安装位置为 `/home/jenn/NativeSync-Dev/bin/`，运行时相对该目录解析开发根。
当前固定环境已经安装，不需要重新复制原配置或数据。

`dev.py start|stop|status` 管理本环境进程；`desktop-ready.cjs`只读核验实际Electron和同步就绪。
`local-provider.cjs`提供明确标识的本机模拟回复；`https-proxy.cjs`使用config内本环境新生成的证书。
`verify-desktop-diagnostics.cjs`在实际Electron内创建临时测试面板，验证四种状态。
`verify-mobile.cjs`用独立Chrome配置与本地证书SPKI执行浏览器验证，会向本开发话题发送消息。

这些脚本不生成或携带凭据，不建立服务器连接，也不是通用VCP安装器。完整源码/依赖来源、
启动方式与限制见 `docs/local-vcp-environment-20261031.md`。config和data不纳入Git。
