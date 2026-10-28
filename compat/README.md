# 宿主兼容边界

本仓不复制整套作者框架作为自有运行核心。overlays必须在匹配宿主中使用，原生History/OneRing/CDS/工具/AA仍由宿主负责。

## ToolBox

完整NativeSync执行模式的3处补丁位于host-patches/VCPToolBox-native-execution.patch：server的手机预鉴权挂载、可信监听入口和排空/上下文接线；PluginManager的执行连续性；AA的原生接受/终态归档连续性。MANIFEST给出准确before/after。AgentManager已经恢复原样，不再包含其两行覆盖。

baselines目录仅为独立git apply校验保存公开作者基线，不是建议覆盖到当前宿主。补丁已在独立目录check/apply，stdio后加差异刻意排除；当前生产已经含NativeSync/stdio接线，不能再盲目应用这份基线补丁。

## Windows

Bridge专属模块在overlays管理；main/preload、共享History写入边界、通用durableJson与旧canonical/hash仍是宿主依赖，其当前摘要在VCPChat-host-requirements.json。作者现有hostHooks不具备耐久History提交/早期启动合同，不能以发送后回调替代。

reviewed-history/windows-host-convergence.patch原字节保留既有已审收敛增量，**仅是历史参考，不是当前所有叠加的单一安装包**。不从旧Git HEAD对整个runtime做diff，把用户其他改动误算成NativeSync。Windows当前完整兼容安装组合仍以#70已接受的15项指纹及配套材料为准。

本仓初始导入不新增宿主补丁、不重构核心，也不提供整文件覆盖生产的自动安装器。
