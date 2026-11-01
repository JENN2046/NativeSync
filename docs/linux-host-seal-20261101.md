# Linux 宿主底座封存与离线代码重建

本封存补齐NativeSync候选之外的公开宿主接线和依赖模块。它读取固定开发宿主的公开代码，不修改源目录、Git对象、运行配置或数据。
目录包含两个公开Git锚点的代码／资源导出、到当前匹配宿主的完整二进制补丁、逐文件摘要、linux-full.json、重建脚本及独立的84项运行候选。

## 来源和边界

- 作者上游ToolBox锚点：`c603f13692b212db371223ff6d91fb71b0b3b39e`，仓库`lioensky/VCPToolBox`。
- 作者上游Chat锚点：`44e19e7d2a04a06d3bc61304375077f0ac43e01f`，仓库`lioensky/VCPChat`。
- 两者分别是本机Git基础`afc089973f0c34b6cab2d5d67f0f97f204ba7a56`、`fb37badf5a302a6e8768a3e4b0b1e6d50efa085d`的已验证祖先。
  本机Git基础含Fork增量，不能冒充作者纯上游。补丁从作者锚点直接覆盖到当前公开宿主文件层；不使用未取回的历史0eafb锚点。
- 补丁依据所有Git登记公开路径、已记录的匹配文件层、两个补齐模块、宿主指纹及公开Admin构建资产生成，包含新增、修改、删除、二进制和执行位。
  它封存上游到Fork再到匹配文件层的整体组合，不把全部差异归因于NativeSync，也不能盲目应用到未知宿主。
- NativeSync的84项运行载荷从宿主差异中排除，另附已校验候选，在宿主重建后安装；三个明确兼容补丁的当前after状态已封存。
- `nativeConversationTransport.js`和`pluginRuntimeEnvSandbox.js`包含在宿主代码基准中。

这是完整匹配**公开代码底座**，不是整盘／用户数据备份。配置、凭据、证书私钥、聊天、SQLite、模型资料和node_modules不封存。
公开锚点中同名配置／数据路径也不导出，文件名排除表在HOST_CODE_MANIFEST.json。原始Git树摘要用于标识来源；经过公开路径过滤的tar不是原始整棵Git树。
补丁不包含被排除路径的修改。插件manifest若在开发目录以.block保存，按公开原文件名封存内容；启用哪些插件需由新环境配置明确决定。

## 从空目录重建代码

在解压后的封存目录执行：

```sh
python3 rebuild_linux_host.py --out /absolute/new/NativeSync-Rebuilt
```

只接受不存在的新目录。脚本校验封存输入，解开公开锚点代码，检查／应用binary patch，逐文件核对宿主代码及执行位，
安装同包84项载荷，核对三个补丁after及linux-full.json全部17项要求。
过程不依赖原NativeSync-Dev目录，不联网、不启动服务、不恢复原配置或数据。结果保存为RESTORE_RESULT.json。

## 运行环境仍需准备

本机验收组合为Linux x64，后端Node24.22.1／ABI137，Electron44／ABI149；后端与桌面依赖必须分别准备。
后端better-sqlite3 12.4.1、桌面13.0.3，桌面原生模块应针对对应Electron构建，不能直接共用后端二进制。
必要Rust知识库模块与音频服务本体已随公开代码／指纹封存；其他依赖遵循各宿主锁文件和公开构建入口。
Linux PDF使用pdfinfo／pdftocairo。重建代码不等于依赖安装或完整应用启动成功。

启动前重新生成专用数据目录、随机凭据、证书、桌面settings与NativeSync连接配置；只批准测试Source，使用本机模拟模型，
按新环境需要阻止其他插件自动启用。不要把旧运行配置或真实资料复制进来当作重建步骤。
开发启停和合成环境入口见NativeSync源码tools/dev-environment；其原验证入口引用现存固定DEV作为模板，不能冒充无模板的一键整机重建器。

本封存验证范围是无源宿主依赖的离线代码重建、逐文件摘要与五个关键模块加载；没有把它写成完整依赖闭包或整机启动验收。

## 本次结果

已从作者上游导出和完整公开补丁重建5901个宿主文件，再安装84项载荷，匹配linux-full.json全部17项指纹。
ToolBox补丁涉及406项路径，Chat涉及889项路径，包含既有Fork及匹配文件层，不能全部归因为NativeSync。
封存审计排除了机器级.npmrc，并纠正把公共credentialVault.cjs源码误当成凭据文件的过滤规则；最终重新导出／重建并核验。
两个补齐模块、两个执行／AA连续性模块及credentialVault代码加载通过，未读取其运行凭据或启动服务。

压缩包为`NativeSync_Linux_Host_Baseline_20261101.zip`；包含公开锚点导出、binary patch、完整摘要、重建脚本、候选及维护源码快照。
详细摘要与回执索引见`provenance/linux-host-and-halted-topics-20261101.json`。原生依赖仍需按上文准备；本次未重装依赖或启动重建副本。
