# 本机附件接续与兼容说明

适用固定 Linux 开发宿主、Electron 和 Chrome 移动视口。模型与文件均为本机合成数据；
没有验证真实模型识图质量、实体手机或 Windows。

桌面通过原生附件按钮选择文件并发送；PWA 可预览已同步图片，下载文件，并展开已提取文本。
PWA 在当前话题选择文件后点击发送，上传与提交沿用原有协议；桌面通过原生 FileManager 存储收到的文件。
支持范围沿用 PNG/JPEG/WebP、PDF、TXT/MD/CSV/JSON，手机单次最多8个、单个20MB。
其他桌面文件类型不因此获得手机支持。

断线上传后，可在原浏览器会话重新选择同名、同字节文件续传；刷新会清空页面草稿和 File 对象，
不会替用户重新发送。已提交但未收到回执时，保留原 requestId，通过原有核对/同会话重试找回任务。
已接受的上传身份与执行身份不因显式重复请求改变。知道文件哈希或任务 ID 不授予其他话题权限。

桌面上传使用原生历史包装内的 FileManager 身份，与既有规范化消息身份一致。
收到附件后只补本机文件句柄；同步的创建时间、提取文本与图片帧引用保持权威。
FileManager 的新时间戳、解析器结果与 null 默认值不进入已接受元数据。
本机句柄落盘后复用既有历史通知与重试，刷新当前桌面图片，无需重新选择话题或重开应用。
没有更改公开协议、state格式、AA接口或数据库结构。

## Linux PDF 宿主补丁

候选的 hostPatches 单独声明 `modules/services/pdfAttachmentService.js` 的前后摘要与补丁摘要。
它先将 Buffer 复制为精确 Uint8Array 交给既有 PDF 解析器，避免旧解析器误读池化 Buffer。
无文本 PDF 继续走原有图片回退，在 Linux 使用本机 `pdfinfo` 和 `pdftocairo`，保留页数上限、
缩放、压缩和临时目录清理。其他平台仍保留原有转换路径，尚未做本轮实际验收。

旧 pdf-poppler 包在 Linux 导入时会调用 process.exit，不能在 Linux 主进程中加载。
缺少系统 Poppler 命令时，本机安装器拒绝安装此补丁；不自动安装系统软件。
此补丁属于固定宿主兼容层，不把完整 VCPChat 宿主纳入 NativeSync 核心载荷。

## 验证入口

源码工具 `tools/dev-environment/verify_full_runtime.py` 默认包含原有10项与4项附件场景，
可用 `--cases attachment-roundtrip,attachment-resume,attachment-lost-response,attachment-access` 定向运行。
`--package` 应指向本次候选；默认目录为 `.local/release-assembly/attachments-accepted`。

每次创建独立本机目录与浏览器配置。测试启用附件和脚本化模型的图片输入能力，
记录模型实际收到的图片字节哈希与合成文本标记。文件选择框代选、网络故障代理和预加载均只在测试进程中。
Chunk 回执被丢弃后继续阻断上传，避免 Chrome 透明重试使部分上传窗口消失；恢复网络后才重新选择文件。
失败现场保留。执行结束后恢复固定开发实例。

本轮回执、源码与候选对应关系另见交付记录；历史未启用附件的整机结果不能作为本轮附件验收。
