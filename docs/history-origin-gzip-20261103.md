# 历史JSON源站压缩：限定配置与安装清单

2026-11-03（America/Adak）。针对已证实的[生产源站JSON未压缩](mobile-network-readonly-20261103.md)，已完成配置候选、本机同版本Nginx验证，以及生产暂存配置语法检查。**后续用户明确批准，现已安装并平滑reload；真实源站压缩与Android同一历史页接收提速已测得。** 以下先保留候选清单，实际安装回执见末节。

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

## 批准后的实际安装回执

用户批准后，按两路径清单完成安装。原vhost摘要 `66479d2f…76fa2e6`，当前为 `bf2c87ea…5c63842`；新片段为 `7ab56f03…7a49df0`。其他已加载配置文件摘要及原软链接保持。

真实大历史Source Pull在gzip声明下由12,635,343 B降为2,394,127 B，约减少81.05%；解压后的完整响应SHA256为 `93c200ff54ba9f3ae14d4fec2e9e1f49a965ec9975263bc3c2fe13dc4c37c426`，与安装前和identity响应完全一致。identity仍返回原12,635,343 B，no-store保留，Vary为Accept-Encoding。安装后公开管理/原生上下文入口仍404，未认证手机session为401。

首次执行在语法成功并reload后立即取样，尚未观察到gzip，保护逻辑自动恢复原配置并移除本次片段。随后核对原摘要、片段不存在、三个服务正常；保留首次失败和回滚回执。第二次同配置安装增加了新worker出现检查和最多三次、仅用于重载交接的响应确认；实际记录第一响应无压缩，第二响应gzip，正文摘要全程相同。证据支持交接窗口内首探过早的判断，未通过跳过验证或改产品配置制造通过。

Nginx主进程2922、VCP后端1821319和管理服务1233828及InvocationID全程保持；没有restart、强停旧worker、退出Windows、改应用代码、数据库、游标、Source授权、手机配对或Cloudflare/DNS/VPN/HTTP3设置。

配置备份和INSTALL.json保留在：

- 首次自动恢复现场：`/opt/AGENTS_OS_Workspace/backups/NativeSync/history-origin-gzip-20261103`。
- 当前安装备份：`/opt/AGENTS_OS_Workspace/backups/NativeSync/history-origin-gzip-20261103-r2`。

### Android同一现有大历史页的安装后对照

在原已认证手机页面中只GET既有基线页，没有创建新基线、刷新UI或发送消息：

| 指标 | 安装前采样 | 安装后采样 |
|---|---|---|
| 完整接收耗时 | 43.85、49.17秒；另一次42.54秒 | 10.89、10.05秒 |
| 解压后数据 | 13,126,025 B | 同为13,126,025 B |
| 公网编码 | zstd | gzip |
| 压缩响应体 | 原完整记录约1.14 MB | 2,522,412、2,523,068 B |
| 收到响应头 | 前两次约1.52、1.26秒 | 约2.43、1.63秒 |
| 剩余接收 | 约42–48秒 | 约8.4秒 |

两个安装后样本解压SHA256相同。此次使用独立PerformanceObserver，只接收本次请求条目，避开此前资源缓冲已满时误取旧条目的问题；HTTP/3、no-store及Cloudflare DYNAMIC保持。

Cloudflare此次向手机保留了源站gzip，因此最后一段字节量比此前zstd大，整体却明显更快。这与“源站出口的大JSON传输是重要瓶颈”的判断一致。前后样本不在同一时刻，未冻结公网条件，不能当作严格受控的四倍提速承诺；同页GET耗时也不等于整个应用启动或交互耗时。

当前建议保留代理，先使用已压缩入口观察体验；暂时没有必要继续改直连。话题切换/重开仍会重新加载完整基线，这一行为没有在本轮修改。用户实际切换、重开等UI体验不冒充已验收；网络接口这一步已有实机证据。

[安装机器回执与证据摘要](../provenance/history-origin-gzip-install-20261103.json)。源码候选为 `7c9875e`；本次不改85项NativeSync载荷，不需要新PWA安装或重新配对。
