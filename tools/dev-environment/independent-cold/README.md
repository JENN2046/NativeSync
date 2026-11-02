# Linux 宿主独立冷启动夹具

仅用于本机合成验收，不是生产启动器。完整证据见 `docs/online-read-integrity-closeout-20261101.md`。
这里保存本轮成功运行时的原始五份脚本；`cold-smoke.py` 不负责依赖安装。

准备一个全新的绝对目录，依次完成以下操作：

1. 校验并解压 `NativeSync_Linux_Host_Baseline_20261101.zip` 到 `ROOT/seal`；执行包内 `rebuild_linux_host.py --seal ROOT/seal --out ROOT/hosts`。
2. 创建 `ROOT/{config,logs,evidence,bin,cache,home}`；写入 `ROOT/ISOLATED.json`，其 `kind` 为 `nativesync-independent-cold-start`。复制四份 `.cjs` 到 `ROOT/bin/`。
3. 在两个新宿主目录分别运行锁文件对应的 `npm ci --ignore-scripts --no-audit --no-fund`。使用全新 HOME、独立空 userconfig/globalconfig 和独立 npm cache；两个配置文件必须使用不同路径。不要链接或复制旧开发副本的依赖或数据。
4. 在后端独立执行 `npm rebuild better-sqlite3`；桌面执行 `node node_modules/electron/install.js` 与 `node node_modules/@electron/rebuild/lib/cli.js -f -v 实际安装的Electron版本`。本轮为 44.9.3；使用与锁文件匹配的版本。保留安装命令、退出码和日志。
5. 解压并校验新候选到独立 PACKAGE 目录，再执行 `python3 cold-smoke.py ROOT PACKAGE`。

脚本仅适用于 Jenn 的固定 Linux 本机：Node24 路径和 `/home/jenn/NativeSync-Dev` 已明确写在源码中。
它正常停止日常开发实例，以固定 17650–17655 端口启动独立模拟提供者、HTTPS 代理、真实 VCPToolBox 和 Electron。
`NativeSync-Dev` 仅用于停启管理，不作为冷启动依赖、配置、聊天或数据库的输入。
这会占用图形桌面；运行前应有相应本机验收授权，并确认没有另一个验收实例使用这些端口。

每次必须使用未启动过的新目录：脚本拒绝已存在 central.sqlite 或 NativeSync state 的目录；生成全新凭据、证书、Source 授权、Agent、配置和空白库。
它通过真实 `native-history:messages` IPC 提交一条消息，再按 Source 拉取核对身份与哈希；不提交模型请求。
结束通过原生 `closeApp` 正常退出桌面，按 cwd 与进程启动时刻核对后仅终止自己创建的后端/代理/提供者，随后恢复日常实例。

失败保留全部现场；不要删除状态再伪装为冷启动。`config`、数据库、原始后端日志可能含新生成凭据，不能打包或直接输出。
公开证据只选取明确审查过的摘要、TAP、脚本和截图。
`module-audit.cjs` 记录 CommonJS 解析路径并拒绝旧开发模块；它不是系统级文件访问审计器。
本轮另核对了子进程环境、数据路径、依赖软链接及实际宿主代码摘要。

保留限制：宿主音频服务的 /shutdown 返回404，宿主随后以默认 SIGTERM 退出该子进程；Rust 日志确认正常接收 SIGTERM。
现有脚本等待各子进程结束，但未将每个 OS 退出码单列持久化；不能据此宣称每个进程的退出码均已记录。
