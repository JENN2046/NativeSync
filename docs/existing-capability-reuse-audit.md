# Existing Capability Reuse Audit（Batch 1 内部）

结论：多数功能已有可复用实现；真正范围升级缺口是显式授权状态转换，不是同步/任务/附件引擎缺失。
不要预设完整handover。保持原source可保留目录唯一归属、key、Journal、执行和单cursor；但当前
`SOURCE_SCOPE_CHANGED`/`SOURCE_BINDING_CHANGED`合同仍拒绝转换，不能称已支持同source升级。
更换source还增加`SOURCE_IDENTITY_COLLISION`，因此并非天然最小方案。

|需求/能力|现有文件/函数（相对overlays）|证据层级|裁决及最小下一步|
|---|---|---|---|
|已批准范围内增量目录/回填|Chat `sourceDirectory`；`SourceSync.discover/ensureSnapshot/step`|已有M2/M3 20支持断言；本轮pin负例实跑|直接复用；预先授权的晚出现topic不需要handover|
|已有绑定扩范围|`sourceScope.normalizeScope/scopeHash/permits`；`SourceSync.verify`；`SourceCatalog.constructor/publish`|源码＋原必需升级0/1失败，3种错误保留|真实缺口；现有pin/绑定没有受控转换入口；不能去掉比较或改成full-root|
|目录/Journal/任务身份|`SourceCatalog.keyFor/entity`；`CentralStore.apply`；Adapter.transaction|原M2/M3实跑保留device/space/cursor/op/job/v1|直接复用；同source显式范围转换原则上保留现有归属，比新source搬迁更小；尚未实现转换，不判通过|
|source级手机授权|`MobilePortal.createPairing/sourceIds/topicAllowed`|本轮不安全替代控制：绕过临时pin，旧source cookie由2看到4；正常配置仍被pin拒绝|不安全：不能把live source grant当topic快照，也不能据此报生产漏洞|
|固定话题手机权限|同类`createPairing`＋现有topic key scopes；`submissionRecovery.sessionMarker`只依赖session ID|本轮5个审计探针及3个相关回归8/8；同Cookie冻结到原key后recovery marker/旧任务投影不变|直接复用＋最小接线已做：显式`{scopeMode:"source",sourceId,snapshot:true}`签发当前ready topic keys；默认source语义不变；不改旧会话|
|手机双向提交与结果|`portal` messages/events/executions；`ConversationExecution.accept/setEndpoint/resolveReview`；`submissionRecovery`|源码存在；历史C2真实发送；本轮只测只读，无新双向组合实跑|已有实现可复用、需接线：获授权topic的版本化配置/alias、实际原生endpoint及相关隔离双向证据，不造新引擎|
|附件/CAS/恢复|`AttachmentStore.complete/associate/content`、`attachmentRoutes`；Chat `DesktopAttachments.uploadLocal/restoreRemote`|源码＋原attachments 7项测试声明；本轮未运行，不能报新通过|已有实现可复用、需接线/证据：同步与mobile附件开关、配置映射/Topic授权、真实字节与重开联合测试|
|群聊|`groupTurn.accept/run/cancel/resolve/preparedStepIsCurrent`；`groupRequest/effectiveContext/nativeRules`|源码＋原groupchat 18项声明及既有补修记录；本轮未运行|可复用现有计划/审批/核对；需冻结成员配置及原生调用链隔离联测，不新建群引擎|
|AA连续性与报告|`NativeTaskLinks.accept/observeBound/reconcile/result`；`delegationContinuity.read/persist`；requestExecutionContext；compat中Plugin.executePlugin/AA接线|源码＋历史native-AA链2项及continuity20项测试声明；本轮不冒称新实跑|复用原生委托/审批/终态/结果；需匹配宿主compat调用链验证；公共callback不能取代原生证据，stdio独立分账|

## 实跑、安全边界与最小补修

本轮5个新审计探针＋3个相关原测试选中项=8/8，零失败/取消/跳过。未重跑C1/C2/旧43项。
控制性风险探针故意在临时对象绕过pin，证明删保护会给旧source cookie新增话题权限；不是生产
可利用入口，也不是一次成功范围升级。当前正常配置路径继续拒绝扩围。

已直接完成无破坏接线：`snapshot:true`仅在source pairing显式选择，要求当前非空、最多128、
所有话题ready且key合法唯一；写入既有pairing/session topic-key scopes，无新表/权限框架。
新会话未来对新增topic仍403；默认source pairing仍为live source语义。不改变旧session、grant、pin、
state、cookie或任何生产配置。只是可选新配对原语，不把旧source令牌自动迁移当成已解决。

最小待补口缩为：显式expected旧scope摘要＋批准新集合的受控转换；复用现有元数据事务与Adapter
transaction，稳定旧队列/收据时采用新摘要；在同一提交中将旧source会话及未用pairing的授权固定到
原topic keys（现有授权判断与session ID恢复标记可复用）。若采用新source则还需归属接续，不能忽略。
本轮不在未定义的授权转换上先去掉pin或重写旧状态；该权限扩大安全反例保留为Batch 1的实际边界。
后续工作沿同一Batch 1继续，不新增RFC/Gate，不把未实现的转换或未运行的全功能组合写成PASS。

旧手机权限与请求身份可保留不等于自动权限迁移已完成：本轮在临时DB验证现有topic scopes/
session marker复用，不提供旧session转换生产API。生产真实范围/持续写入/Git发布授权均未增加。
全程仅独立仓、合成数据、loopback；未访问生产数据/配置，未启停服务或主客户端，无真实模型/工具/AA。
