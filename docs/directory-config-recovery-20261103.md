# 目录告警恢复与 Windows 原生续聊接线

2026-11-03（America/Adak）。**已按后续“安装”授权完成生产追加安装和Android目录验收；Windows配置异常31 → 0，32个配置快照有效，含桌面活引用的历史继续只读。** 以下本机/待安装段落保留准备阶段事实，最新结果以末尾安装回执为准。

## 目录提示的确定缺陷

手机每两秒核对目录revision。旧版一次GET失败后将错误写入directoryNotice；下次成功、revision未变时直接返回，旧错误一直显示。相同变量还承载话题删除/失去权限的提示，不能在成功时无条件清空它。

App.vue把目录请求错误独立保存。相同revision核对成功或完整分页目录接受后清除此错误；失去话题权限的提示沿原路径保留。未修改请求频率、目录协议、同步/执行内核、缓存、草稿或权限。

这解释了“已恢复但仍显示Failed to fetch”的一条确定路径，不能据此认定用户当时的网络始终正常。实机只读调试先超时，后发现ADB设备已断开；本轮没有刷新、清数据或重新配对，**新前端Android验收尚未完成**。

## 31项的只读核对

核对QLL-6账户617及腾讯生产VM-0-13-ubuntu/ubuntu后，只读取配置结构、引用、归属和必要摘要；没有输出/复制聊天正文、规则正文或系统提示词正文到本机。Windows仍为4个Agent、1个群聊、32个话题。

| 原因 | 现场结果 | 最小处理 |
|---|---|---|
| 普通Agent引用原生提示词 | 4个Agent均有一个原生引用，服务器现有映射/文件可读；31个单聊话题中仅1项已有接线 | 新增30个精确话题agentAlias |
| 人工邀请群聊的成员引用 | 1话题、3成员，均属于同一Source且可对应上述原生Agent | 新增1个精确话题memberAliases |
| 当前生效规则与提示词 | 此Windows来源的有效规则没有桌面工作区/画布依赖；原生文件无未展开的Agent嵌套引用，群提示词无原生Agent引用 | 不改变规则或全局Agent映射 |

服务端仍报告Windows配置异常31；Linux另有23项DESKTOP_CONTEXT_REQUIRED与1项CONFIG_PROMPT_SNAPSHOT_UNAVAILABLE，均不在这次Windows接线变更内。两个Source的历史待导入、本地操作与冲突最近观察均为0，Windows另有2项附件未就绪，不把这些计入续聊配置通过。

复用现有NativeMobileTopics，不增加代码中的授权接口、配置键或数据库迁移。保留原4项完整条目，新增30个agentAlias和1个memberAliases，总计35项，均使用中央目录已有精确key/归属；不重新命名话题、扩大Source读取范围或手机scope。Windows原1项接线与引用一致。引用/成员、归属、原生文件摘要或现有配置变化时须重新核对，不能直接套用旧清单。

这份清单补的是当前31项的原生引用授权接线；普通可移植提示词仍沿全量Source自动发布。未来新增且使用原生私密Agent引用的话题仍须明确接线，不自动根据上传正文或同名Agent授予别名访问权。依赖桌面上下文、JEV/game或其他现有不支持条件的会话继续只读。**上线后须等Windows实际配置发布回执，不能把只读检查和合成测试当作31项真实发布/模型续聊已经成功。**

## 直接验证

- 一个实际Chrome/PWA场景：旧版在目录恢复、revision未变后仍显示错误，负对照失败；修正版恢复后错误消失，草稿、选择、历史身份和localStorage保持，不新增基线；撤销原话题权限后，其提示跨后续同版本核对仍保留。零模型提交。
- 一个既有身份回归：新增原生接线不能更改已发布key或占用其他话题key。
- 一个新增原生接线场景：在本机临时目录用作者AgentManager读取合成原生提示词，经真实Source配置发布路径冻结单聊及3成员人工邀请群聊。无接线/错误成员别名拒绝，桌面工作区规则仍阻断；原生文件后来变化只生成新版本，旧单聊和群快照仍保存原内容，原已接受任务和Journal保持。零模型/工具调用。

没有重跑未变动的压缩、AA、工具、附件或全量安装矩阵。初次夹具依赖路径、初始话题等待和模块路径错误的记录保留；修正测试夹具后才取得有效旧版负对照与新版结果，不将早期夹具失败当作产品负对照。

证据在 `.local/directory-config-recovery-20261103`。Windows/服务器引用与接线私有材料为0600文件，私有安装计划不进入Git或公开候选；公开回执只保留摘要和汇总。

## 集中安装与回退清单

源码已本地提交 `be86b980fab4ad8bbaad5db8d8ec0c727d0d87e1`；完整候选86项载荷/40项支持文件及ZIP已核对，构建时工作树干净，运行载荷与被测候选相同。[候选ZIP](/home/jenn/下载/NativeSync_Directory_Config_Recovery_20261103.zip)，SHA256 `b9108e54522de290bb399e746593ebee4b07cd5336aab479ca75a00f9be228cc`。[公开机器清单](../provenance/directory-config-recovery-20261103.json)记录前后摘要。运行代码仅前端新JS和index.html两路径；另有生产 `Plugin/NativeSync/config.env` 的单行NativeMobileTopics更新，不把运行配置混入代码ZIP。Brotli修正f8ed5b4及Nginx配置保持。

精确静态写入（相对VCPToolBox）为：新增 `apps/mobile/dist/assets/index-CtwQoamN.js`，SHA256 `2b9f0269d5a50ffe9b1df7b9994f132e19f4ed9c6af248e1e5721ad5331514c9`；更新 `apps/mobile/dist/index.html`，`2d601ad48d10905eb7d0cd7aaabfa296fa76b5605c8d7570300a596629c9bd9d` → `3fe3b527872a1a671bb4213130f14c108774ce73b02116afcc0dca406f30d52a`。CSS不变，旧JS保留。

私有配置计划在 `/home/jenn/NativeSync/.local/directory-config-recovery-20261103/PRIVATE_BINDING_INSTALL_PLAN.json`；它仅含既有静态行和拟追加精确接线，不含凭据。该文件及其来源核对材料均未进入公开ZIP或Git。

追加安装需先明确暂停新的生产请求，复核在途正常收尾，制作含已提交WAL的一致SQLite备份，并私密保存原配置及代码。逐项核对生产当前载荷、index及配置摘要、Windows引用/规则配置和原生Agent文件摘要、当前目录key/归属与成员，拒绝未知变化。

正常停止VCP后端，安装新静态资源/index并只替换NativeMobileTopics的既有一行，原子保存；正常启动。Windows无需退出或改代码，现有发布器会自动重试；保持原Source/手机会话。核对31项真实发布结果和仍不可续聊原因，不用清理任务、清空异常表或关闭规则满足验收。用户保留手机草稿后，再刷新现有入口，集中检查目录恢复提示、来源/话题保持；不主动发送付费模型请求。

如需回退，先结清工作并核对当前摘要，再恢复旧index和原NativeMobileTopics一行，保留新JS无妨，正常重启；不撤销/恢复已接受的配置快照、数据库、state、游标、Source绑定或会话。配置回退不等于删除已经接受的事实，回退后的可执行状态仍需按现有校验和真实配置发布结果核对。本轮未实际安装或回退。


## 获批安装与实际结果

用户随后明确要求“安装”。生产实时请求/AA/工具/同步执行为0，Windows5份所有者配置摘要匹配，cursor1175、Inbox/Outbox/pending/drift均0。再次核对86项候选/40项支持文件、原58项生产载荷、精确Source归属、3个群成员及4个原生文件摘要后，只安装两个静态文件并替换NativeMobileTopics一行；原4项保留，新增30个单聊/1个群聊接线，共35项。后端正常停启，PID1889814 → 1998778；Nginx/管理进程、全局Agent映射、其他配置及Windows代码/配置均未改。

一致备份 `/opt/AGENTS_OS_Workspace/backups/NativeSync/directory-config-20261103/consistent.sqlite`，SHA256 `da0dd634473d98b32a15dca92a2c15b9945a8da564dc85294973db42190f6a96`；原配置私密保存在该目录的config/Plugin/NativeSync/config.env，原index在code/apps/mobile/dist/index.html。新配置SHA256 `359fd46a699e7f5659fbac322845fbf383b4cba6c1a7b5e4dfcc978f495e2011`。停机安装前后所有表摘要一致。

Windows原发布器实际重试并成功发布31项：32/32话题历史就绪、32个快照有效（1群聊），34个原生提示词冻结内容核对通过，配置异常/待发布均0；受保护Source配置查询返回200/32项，无配置错误。owner_execution_configs从9到40行，原9个快照未变。仅31个对应的sourceExecutionIssue键清除，其他metadata、原消息/Journal/回执/任务/Source及附件表摘要保持。1170条messages、1175条journal/applied_ops、head1175，存储issues=0。Windows最终cursor1175、队列与pending仍0。

### 手机配对到期与恢复

最初让用户刷新时，用户报告需要配对。检查确认原联合会话于UTC 2026-11-03 22:18:10到期，而安装窗口为UTC 2026-11-04；全部5份旧会话本已过期。本次安装没有删除它们，但之前“保留会话所以无需配对”的判断漏查了有效期，此处明确纠正。原生会话保持默认8小时，没有顺手延长登录时间。

用户要求配对后，通过已连接的Android和原配对按钮，恢复此前明确批准的Linux/Windows两个来源及未来话题范围。新增并消费1个配对、创建1个会话，原5份会话及12份配对完整保留，新scope核对通过，没有扩权旧会话或加入新Source；新会话到期时间UTC 2026-11-04 09:10:03。配对码仅在私有0600文件和原表单中临时使用，未输出或放入Git/公开候选。

实际Android已加载index-CtwQoamN.js，显示两个来源、56话题，Windows配置异常0，旧目录错误提示消失；本地待确认提交存储摘要保持。代表性65消息Windows群聊可读，显示40条消息，并因桌面活引用而保持只读，桌面原因提示存在；已恢复原选择。**“32个配置有效”不代表“32个历史都可直接手机发送”。** 首次辅助验收错误期待群聊输入框启用，得到失败；核对现有桌面引用保护后保留失败记录，并按正确的只读合同完成验证，没有删除引用或放开输入来制造通过。

最终变化限于新增配置快照、31项问题键清除、正常观察/读取元数据，以及上述明确恢复的同范围新配对/会话。临时ADB转发移除，零真实模型/工具请求。Linux24项配置问题、Windows2项附件未就绪保持；未进行付费模型续聊或实机注入断网测试。前端短断网/同revision恢复使用前述本机Chrome证据，不冒充实机故障注入。

[安装机器回执](../provenance/directory-config-recovery-install-20261103.json)绑定逐项证据。实际回退未执行；如需要，先结清工作并核对当前index/配置摘要，再恢复原index及原NativeMobileTopics配置，正常重启，仅回退代码/配置，保留已经接受的配置快照、配对/会话、数据库、state、游标和Source绑定。
