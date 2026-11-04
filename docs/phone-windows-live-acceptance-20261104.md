# Windows 来源：手机真实续聊与重开验收

2026-11-04（Asia/Shanghai）。Jenn在“一次真实手机续聊闭环”范围下要求开工，并在Android上完成一次发送及原图标重开确认。**本轮通过Windows普通单聊的生产发送、回复、桌面落盘、手机重开保留；不将此结果扩大为所有群聊、工具或桌面上下文会话的实测通过。**

## 结果

生产目标`VM-0-13-ubuntu / ubuntu`、服务active/success，PID1998778保持；当前磁盘可用约2.99GB。此前约379MB是历史采样，不再作为当前容量事实。本轮没有清理备份或改动系统/服务配置。

Windows32个导入计划完成，选择原Windows Source的“微明 → 主要对话”。该话题配置有效，现有2条文本消息，无附件或桌面活引用。Jenn只发送一次合成验收文本，要求回复`NS-WIN-20261104-01`，不调用工具或委托；随后明确确认手机收到回复。

发送前只读基线head1179、messages1174、journal/applied_ops各1179、mobile_executions3。发送后为head1181、messages1176、journal/applied_ops各1181、mobile_executions4：新增1个任务和1对消息/回执。任务`job_d7654b8e8d520cb44bb695d27a84d20a`，requestId`e9fac8eb-c25e-4bd5-ae20-c98e585eb3e3`，completed、attempts1、request_dispatched1、error_code=null；原生工具调用与委托任务均0。冻结配置version1/hash`28c6006269513730f6427f08a7e8f46b994314be1e27a7705937432276bd1ba6`。派发标记及任务计数为应用层证据，本轮未读取供应商计费记录。

| 记录 | 接受seq | 服务端与Windows内容hash |
|---|---:|---|
| 验收用户消息 | 1180 | `35288129e1c1be2d34836f9711f366a354792f9218d5e4649196c757386c7107` |
| 回复 | 1181 | `3205cab94dec0dafc93020503ec928c6dc1a6f87b694c78c52aa07093ebadd07` |

两条记录的原messageId在服务器和Windows逐一对应，双方各只有一条；各自Journal版本1条，回复恰为验收标记。Windows话题由2条变4条，cursor1181，Inbox/Outbox/pending/localCommits/drift均0。

Jenn关闭手机NativeSync并从原图标重开后，确认无需配对、验收消息及回复各只有一条。再次只读核对服务器和Windows：仍是同一个completed任务、attempts1、head1181、同一对身份/hash，无重复接受或落盘。原1179条Journal的完整摘要不变；Source绑定、40个配置快照、13份配对及原生任务/调用表摘要保持。原6个会话的身份、凭据哈希、有效期和权限保持，只有当前会话的last_topic_key按用户选择变到验收话题；默认8小时有效期保留。

## 证据边界与操作记录

手机实际接在Windows上。使用其既有Android SDK/ADB核对到一台已授权手机，手机处于Awake，Chrome调试socket存在，但临时loopback转发后的CDP HTTP查询持续超时。因此未进行自动手机点击或截图；由Jenn亲自在Android完成发送、收到回复及独立应用重开确认，服务端和Windows身份/hash由只读脚本独立核对。没有把桌面浏览器模拟当作手机结果，也没有借调试失败重复发送。

所有本轮临时ADB端口转发都在finally移除；没有配置无线调试、改防火墙或安装新的调试工具。初次整表摘要断言把会话正常更新的last_topic_key当成异常；源码确认该字段用途后，在内存中代回原目录候选键计算摘要，与发送前完整会话表摘要精确匹配，证明改变限于这一字段。该核对没有写数据库，未更改身份、有效期或scope来消除失败。

本轮不修改产品代码、不生成或安装新候选、不重启服务、不恢复数据库/state/游标；复用[已安装版本](directory-config-recovery-20261103.md)的既有回归，只做上述直接实机闭环及必要只读核对。原始证据在`.local/mobile-continuation-20261104/`，不包含聊天原文、凭据或私钥；本次合成标记为验收内容。

## 收尾

进入日常使用观察，遇到具体失败再按原requestId、任务和消息身份定位。Linux24项配置限制继续按用户保留的全局规则处理；Windows2项不支持附件、桌面活引用只读、8小时手机会话有效期及未解决的共享msg_id历史归属边界继续保留。本轮不追加架构、扩大授权或安排历史全量测试矩阵。

[机器可读回执](../provenance/phone-windows-live-acceptance-20261104.json)保存事实及本机证据摘要。
