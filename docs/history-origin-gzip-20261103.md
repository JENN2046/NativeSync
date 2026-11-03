# 历史JSON源站压缩：限定配置与安装清单

2026-11-03（America/Adak）。针对已证实的[生产源站JSON未压缩](mobile-network-readonly-20261103.md)，已完成配置候选、本机同版本Nginx验证，以及生产暂存配置语法检查。**生产活动配置尚未修改，尚未reload；手机提速未验收。** 沿用用户此前“生产追加安装另确认”的边界，在以下具体差异审阅后再安装。

## 配置改动

只在公开 `vcp.skmt617.top` 的HTTPS server新增一条include，加载[历史压缩片段](../compat/nginx/nativesync-history-gzip.conf)。[精确补丁](../compat/nginx/vcptoolbox-history-gzip-20261103.patch)不改管理域名、HTTP跳转、证书或既有location。

匹配范围：

- 手机 `/mobile/api/conversations/:key` 当前历史、`/:key/baseline/:id` 历史分页及 `/:key/events` 历史增量。
- `/api/v1/sync/pull` 和 `/api/v1/sync/source/pull` 同步读取。

仅增加application/json的gzip，等级3，已知长度最小1024字节，允许no-store/auth代理响应压缩，增加 `Vary: Accept-Encoding`。未知长度响应的最小长度判断沿用Nginx自身规则。原有 `Cache-Control: no-store` 保留，不开启缓存。片段完整沿用公开通用代理的upstream、HTTP版本、Host/代理/Upgrade头、关闭proxy_buffering和600秒超时；以后通用代理配置变化时需一起核对。

模型接口、SSE回复、消息提交、基线创建、执行控制、工具、附件和管理入口没有被新location纳入。后端仍负责鉴权、来源范围和HTTP方法校验；不新增同步协议、数据库迁移或NativeSync运行载荷。

## 直接验证

本机使用已缓存的官方Nginx 1.28.3镜像，与生产版本相同；从当前完整vhost派生隔离配置，仅替换本机监听、合成上游和测试证书。容器仅监听本机回环，未复制真实聊天、凭据或生产私钥。

| 核对 | 结果 |
|---|---|
| 修改前负对照 | 9,040,098 B合成历史不压缩 |
| 修改后、含代理Via和认证头 | gzip后1,630,755 B，约减少82% |
| 内容一致性 | 前后及identity回退解压SHA256完全一致 |
| 首字节与本机总时间 | 修改前约5/37 ms，修改后约5/120 ms；仅合成单次本机样本，非生产CPU或手机提速承诺 |
| 兼容与权限 | identity回退正常；未授权401；公开管理/原生上下文入口404且没有到达模拟上游 |
| 接口范围 | 当前历史、基线页、events、两个Pull均压缩；提交、创建基线、附件状态及普通模型JSON维持不压缩 |
| 流式交付 | 合成SSE未压缩，后端结束前已收到首块；零真实模型调用 |

本地首次语法测试被只读容器的默认临时目录阻挡，改为仅给测试临时目录提供tmpfs后通过；没有修改宿主权限。未重跑AA、工具、全量同步或旧安装矩阵。

生产侧已在 `/home/ubuntu/nativesync-release-stage/history-origin-gzip-20261103` 暂存公开配置，用生产真实全局配置和其他站点、仅将目标vhost重定向到候选，执行本机原生 `nginx -t`，通过。活动文件摘要、Nginx主进程2922及InvocationID保持，后端未停启。候选语法通过不等于生产已加载。

## 精确安装与回退清单

| 路径 | 动作 |
|---|---|
| `/etc/nginx/snippets/nativesync-history-gzip.conf` | 新增片段，原文件须不存在 |
| `/etc/nginx/sites-available/vcptoolbox` | 仅在公开HTTPS server追加include |

保留 `/etc/nginx/sites-enabled/vcptoolbox` 原软链接。完整前后SHA256见[机器清单](../provenance/history-origin-gzip-20261103.json)：vhost当前摘要 `66479d2f…76fa2e6`，候选 `bf2c87ea…5c63842`；片段 `7ab56f03…7a49df0`。

安装前重新核对hostname/account、目标摘要、软链接和新增路径不存在；配置有未知漂移即停止。只备份受改配置及权限元数据，安装这两项后先 `nginx -t`，成功才 `systemctl reload nginx`。这是Nginx平滑重载，无需退出Windows或重启VCP后端。

安装后通过源站已授权真实历史分别核对gzip和identity响应、解压内容摘要、压缩字节量及原no-store；保留无变化的模型/附件/管理路由，再用手机原有会话比较大页接收时间。不新增配对、不发送模型请求、不清理手机数据。

若语法、reload或直接检查失败，仅在目标摘要仍属于本次安装时恢复原配置、移除本次新增片段，再语法检查并平滑reload。遇到未知漂移保留现场，不能覆盖他人修改。**不回退SQLite、state、游标、Source绑定或手机会话。** 本轮仅验证修改前后配置与兼容行为，未将实际生产回退记作已通过。

已有本机结果足以提交安装确认；生产上线后的收益仍须实测。完成这一步后，才根据结果判断是否需要研究直连。
