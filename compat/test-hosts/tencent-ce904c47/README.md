# 腾讯测试机 ce904c47 专用 NativeSync 接线

针对2026-10-31实际读取的三个非私密宿主源码文件。原release声明source_sha为
ce904c476f58e0857aa9ee828619158a82d75e7e；MANIFEST中的逐文件before摘要才是
应用此补丁的前置依据，不能仅按目录名或提交简称应用。

原通用兼容补丁不能直接用于此版本。这里仅移植原有NativeSync钩子，保留当前
listenArgs、工具executionContext、审批/信任授权与stdio逻辑；AA文件的原始基线
相同，使用既有AA连续性改动。没有替换整份Plugin.js或降低已有授权判断。

补丁已在当前宿主源码的独立副本中应用，语法/反向检查、腾讯服务器上的220项
联合检查及8项安装回退场景通过。server.js没有作为完整宿主启动；不能把这些
结果当成共享主服务激活、生产或真实手机验收。

此文件不是正在运行的vcp-main的安装授权。实际共享实例接入需按
`docs/tencent-test-readiness-20261031.md`明确安装范围、数据目录和停启窗口。
