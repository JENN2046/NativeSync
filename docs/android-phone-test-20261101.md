# Android 实体手机测试准备

本工具准备独立本机完整VCP实例，入口只供同一路由器普通局域网的Android Chrome访问。
电脑接网线、手机连Wi-Fi可以测试；访客网络或AP隔离可能阻止互访。
不要将电脑浏览器移动视口的预检结果记为实体手机验收。

## 本机侧

```sh
python3 tools/dev-environment/phone_test.py prepare \
  --address <电脑当前局域网IPv4> --package .local/release-assembly/phone-readiness
python3 tools/dev-environment/phone_test.py start --root <上一步生成的独立目录>
python3 tools/dev-environment/phone_test.py status --root <独立目录>
```

prepare只复制公开代码及已核验载荷，重新生成凭据、数据、证书、Agent和群组。
四个合成话题为普通聊天、顺序群聊、邀请群聊、自然随机群聊。模型均为本机脚本化回复。
不复制原聊天、私密提示词、凭据或AA运行记录，不修改固定开发副本的设备/同步范围。
start正常停止固定开发实例，使用同一组17650—17655端口；不能并行启动原实例。

仅17663的移动HTTPS和17664的公共证书下载绑定所选局域网地址，且限同子网访问。
管理、模型、调试和桌面同步端口保持127.0.0.1；手机网关拒绝非mobile路径、路径混淆、
错误Host/Origin、Bearer请求及Key登录路径。没有修改系统防火墙、路由器或端口映射。
新入口默认四小时后关闭，测试CA和叶证书有效期两天。CA签发私钥在签出唯一测试叶证书后删除。
证书下载页不包含凭据；日志不记录查询、Cookie、配对码或请求正文。

## 手机接入

1. 手机Chrome打开本机给出的HTTP证书下载地址，确认网络可达。
2. 对照电脑上的证书名称和SHA256，下载并通过Android系统设置安装为用户CA证书。
   品牌入口不同，可在设置中搜索“安装证书”或“CA证书”。不是给电脑安装根证书。
3. 打开对应HTTPS移动入口。证书仍报错时先核对信任和手机时间，不把绕过警告当作安装/离线验收。
4. 在电脑执行以下命令，然后打开其打印的本机私有页面，手机扫描页面二维码并点击“连接会话”：

```sh
python3 tools/dev-environment/phone_test.py pair --root <独立目录>
# 电脑本机查看二维码：http://127.0.0.1:17652/phone-pair
```

二维码使用已有三分钟、一次性的配对码，授权范围仅这四个合成话题，不包含后端Key。
码放在URL片段中，加载及同页片段导航时立即从地址栏移除，只在内存预填，必须显式确认才配对。
已连接会话遇到新配对链接会保留原会话，不自动切换、发送或重跑任务。
配对码不写入聊天、日志或浏览器持久存储；二维码只在电脑回环入口显示。

## 分清预检与实机结果

`verify-phone-browser.cjs <独立目录>`检查同一LAN网关的电脑Chrome移动视口：
预填/显式确认、同页扫码、旧会话不被替换、Cookie属性、私有路由拒绝、真实Electron/PWA往返、
刷新无重派发及Service Worker接管。它使用精确证书公钥绑定，仅用于电脑测试浏览器。
实体Android还必须由实际设备验证系统证书信任、安装入口、图片/文件选择、下载、切后台、锁屏及断网重连。

实机操作后比较原requestId/执行/步骤身份，以及独立模型与效果计数，不仅查看“完成”标签。
尚未操作的实机步骤保留pending，不能沿用原14项桌面自动化或本机预检替代。

## 结束

```sh
python3 tools/dev-environment/phone_test.py stop --root <独立目录>
```

stop通过原生受保护退出停止本套测试，保留现场，恢复固定开发实例。
不强制结束busy桌面，不回退数据库、state、游标或已接受消息。
手机断开本次会话后，只移除名为“NativeSync Android Local Test”的用户CA证书，保留其他证书。

参考：[Android证书添加与移除](https://support.google.com/pixelphone/answer/2844832?hl=zh-Hans)、
[Chrome证书验证与本地信任说明](https://chromium.googlesource.com/chromium/src/+/main/net/data/ssl/chrome_root_store/faq.md)。
