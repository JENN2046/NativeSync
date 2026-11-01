# NativeSync 本机候选安装入口

本包适用于固定Linux开发副本或带本项目标记的本机合成验证目录，不包含服务器部署授权。
实际源码、84项运行载荷及宿主补丁均以本包MANIFEST.json为准；当前验收结果另见源码中的全量阶段交付记录。
历史阶段的测试数量、旧代码引用和旧回退组合不能替代本包的证据。

## 校验和安装

先验证解包内容：

```sh
python3 tools/install_release.py verify --package /absolute/candidate
```

固定开发副本的正常启停、目标摘要核对、前一包选择、外置备份及代码安装命令见LOCAL_INSTALL.md。
安装器核对MANIFEST、宿主要求和已声明补丁；未知改动会被拒绝。它只安装代码，不修改配置或恢复数据。
公共夹具安装器保留原有限制，不能用于任意宿主。

全部Agent／群聊模式先阅读FULL_SOURCE.md：客户端与服务器须明确批准同一Source和all-supported执行模式，
手机使用新的Source配对授予整个来源及未来话题权限；旧手机会话不会静默扩权。配置、群聊和附件细节分别见
SETTINGS.md、GROUPS.md、ATTACHMENTS.md，临时Android入口见ANDROID_TEST.md。

## 全量Source代码回退

只有导入、提交、执行及未知原生工作均已明确收尾，且本项目实例正常停止后，才运行source_compat.py prepare。
它保存并移除本来源新增配置键；随后使用该次实际安装的外置备份回退代码。
本阶段核验的旧候选为5a4ee82附件修复版，保留Source历史和读取，停用新增自动续聊模式。
重新安装新代码后，停止状态下用同一兼容回执restore配置，再启动。完整命令见FULL_SOURCE.md。

SCOPE.json的codeRollbackBaseline是早期选定模式的公共夹具组装输入，不是全量Source的降版承诺；
全量组合以fullSourceRollback字段和实际安装回执为准。检查失败时保留现场并向前恢复。
始终保留数据库、state、游标、范围、授权绑定和已接受执行快照，不通过删数据或恢复旧数据完成回退。

包中不包含凭据、聊天、SQLite、原生依赖或完整宿主。模型、手机、Windows与远端的支持边界以实际交付记录为准。
