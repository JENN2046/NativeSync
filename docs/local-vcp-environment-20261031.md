# 固定本机 VCP 开发环境

2026-10-31（America/Adak）。当前环境为 `/home/jenn/NativeSync-Dev`，完整 VCPToolBox 与
VCPChat Electron 应用均已实际启动。前面 `.local/linux-dev`、`local-validation`仍是模块/安装夹具，
不能代替本套完整应用环境。开发源码继续位于当前 NativeSync worktree，完整宿主供运行与兼容开发。

## 入口与数据

```sh
/home/jenn/NativeSync-Dev/start
/home/jenn/NativeSync-Dev/status
/home/jenn/NativeSync-Dev/stop
```

启动顺序：本地模拟提供者、真实server.js/adminServer.js、本地HTTPS代理；等待模型与同步服务
就绪后，运行官方Electron managed launcher，再等待真实主窗口及同步状态就绪。启动失败返回非零。
所有六个端口17650—17655均已核对为127.0.0.1监听，音频使用独立17655，未停止原有63789服务。

完整源码分别在`VCPToolBox/`与`VCPChat/`，独立依赖在`.dependencies/`，运行数据在`data/`。
`config/`只包含本环境新生成的凭据与证书，没有复制日用聊天数据、业务配置或原有凭据。
启动脚本源在`tools/dev-environment/`，固定环境运行副本在`bin/`。config/data不提交Git。
浏览器入口为`https://127.0.0.1:17653/mobile/`；桌面界面标题为`NativeSync Dev · VCPChat`。

## 来源与边界

- ToolBox完整Git基础：`afc089973f0c34b6cab2d5d67f0f97f204ba7a56`。
- Chat完整Git基础：`fb37badf5a302a6e8768a3e4b0b1e6d50efa085d`。历史0eafb锚点未能取回，
  没有声称准确重建该提交；使用已有完整源码，再叠加已交付的匹配公开宿主文件层。
- 匹配宿主公开增量782项，以及5b59803候选77项，详见固定环境`matched-overlays.json`。
- 完整后端启动时额外恢复了两个缺失的公开模块`nativeConversationTransport.js`与
  `pluginRuntimeEnvSandbox.js`，来自本机完整公开源码，记录在`evidence/startup-closure-recovery.json`。
- 两套node_modules独立复制。后端Node24/ABI137、better-sqlite3 12.4.1；桌面Electron44/ABI149，
  better-sqlite3 13.0.3及原生音频已实际加载。没有修改原宿主依赖。
- 本配置启用NativeSync、AgentAssistant；其他插件源码保留、manifest为block。CDS镜像初始关闭。
  HTTPS代理覆盖HTTP路径，尚未提供可选插件的WebSocket转发。

## 本轮实际验证

完整后端知识库原生模块初始化成功、AdminPanel Vue构建完成、Electron renderer-ready、Rust音频就绪。
通过真实桌面输入/发送按钮和真实Chrome移动视口PWA验证：

1. 桌面写入原生History并收到本地模拟回复，中央Journal同步后PWA读取相同消息。
2. PWA页面认证并发送新请求，真实宿主完成执行，消息及回复回到原桌面界面。
3. 往返结束后History 6条、cursor=6、Outbox=0、Inbox=0，任务completed。
4. 停止后重新启动成功，原数据与同步进度保留。只读核对6条原生/中央消息ID与内容哈希逐项一致，任务attempts=1，重启后的模拟提供者调用数为0。未重新发送旧请求。

证据在固定环境`evidence/desktop-roundtrip.{png,json}`、`mobile-roundtrip.{png,json}`、
`SETUP_STATUS.json`。最初调试因桌面API地址缺少`/v1/chat/completions`产生的404消息仍保留，
后续修正并成功，未删除失败证据。此前还补齐了开发空历史的首次接入SHA指纹。

这些结果覆盖本机Linux Electron和Chrome移动视口、真实应用接线与合成模型响应。
不代表Windows、实体手机、真实模型、工具副作用或所有可选插件的验收。本轮没有连接服务器。

## 继续开发：启动失败反馈

实测发现：Bridge返回`enabled:false,degraded:<原因>`时，桌面任务面板无条件隐藏，接入失败
与没有配置无法区分。已在专用宿主修正只读显示：失败时显示“NativeSync 接入未完成”及错误码；
正常关闭继续隐藏，恢复后清除旧错误并显示正常状态。不增加自动提交或恢复动作。

补丁及准确before/after摘要在`compat/host-patches/VCPChat-startup-diagnostics.{patch,json}`，
只改`modules/renderer/nativeExecutionStatus.js`。已用实际Electron模块测试关闭、失败、恢复、
再次关闭四种状态，全部通过，回执`evidence/desktop-diagnostics-regression.json`。
这是独立宿主兼容增量，未修改原5b59803候选，也尚未组装或推送新发布包。原220项模块与
8项安装回退结果仅保留为此前候选证据；本轮界面改动按直接影响路径做浏览器检查。

## 系统调整

初次启动确有inotify耗尽：约65390/65536，Rust watcher报告MaxFilesWatch/ENOSPC。
在已说明该阻塞和具体调整方案后，按用户“搭好后继续开发”执行了本次开机的
`fs.inotify.max_user_watches=262144`，没有写持久配置或停止其他应用。
原额度65536，重启后若再次耗尽需重新处理。Chokidar轮询仅限本套子进程。
TLS只通过本环境进程的额外CA与测试浏览器精确证书SPKI使用，没有改系统信任库。

## 后续稳定交付

本轮已完成[稳定交付验收](local-stable-closeout-20261031.md)。当前临时监听额度经用户明确确认由262144提高到1048576，仍未持久化；正常桌面退出已改走原生受保护closeApp。上述首次搭建记录保留为历史，不代表当前仍停在初始候选或额度。
