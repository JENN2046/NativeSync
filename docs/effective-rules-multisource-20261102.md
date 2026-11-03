# 原生有效规则发布与多来源展示候选

本轮按用户收敛范围开发：保留现有备份与回执，先补原生有效规则发布，再补多来源统一展示。没有改全局规则、手机会话权限、运行配置或业务数据；尚未安装到日常/生产实例。

## 已实现

桌面增加可选的`readEffectiveTavernRules(descriptor)`宿主回调，复用原生`conversationContext.resolve`，按Agent或群聊取得覆盖后的实际规则。投影只保留既有快照允许的字段，剔除`globalEnabled`、`overrideEnabled`、`overrideKey`等观察字段。读取失败不回退成全局配置，也不改既有快照。

复用现有版本、摘要、Source配置调度及冻结请求机制。旧宿主未接回调时保留原行为。日常宿主还需应用包内`compat/host-patches/VCPChat-effective-owner-rules.patch`的一行接线；其JSON记录精确before/after，已在独立代码副本应用并通过语法检查，未覆盖运行目录。

PWA新增已授权来源筛选，显示服务端配置的来源名称。同名Agent仍按原内部身份分开；切换来源或话题保留各自草稿。筛选只影响展示，不授予读取或操作权限。

配对接口增加显式的多来源选择，仍只接受服务器已批准的Source：每一项必须明确`sourceId`和`snapshot`。旧会话不变，不自动建立联合配对。单一Source及原选定话题接口继续兼容。

## 联合配对的准确范围

先确认`GET /mobile/api/connection`返回`capabilities.multiSourcePairing=true`，再由已有受保护的宿主配对入口提交。例如：

```json
{
  "scopeMode": "sources",
  "sources": [
    {"sourceId": "windows-source", "snapshot": true},
    {"sourceId": "linux-source", "snapshot": false}
  ]
}
```

示例ID是占位符。`snapshot:true`冻结该来源当前已就绪话题；`false`明确授予该已批准来源及未来新增内容。不会改服务器Source授权。带单一Source范围的请求不能借此添加其他Source；未知来源、重复来源、缺少明确snapshot选择均被拒绝，失败不生成配对。

联合配对产生新会话，复用原有scope数组；不扩权旧手机会话、不合并同名Agent或消息，不增加数据库迁移。既有跨Source内部身份碰撞继续拒绝。旧服务器不支持该请求时应停止，不降级为更宽授权。

## 验证与交付边界

- 12项直接相关配置/Source检查通过，包含原生覆盖投影、单聊/群聊、规则变化与缓存、读取失败、冻结快照、runtime回调实际串联。
- 3项多来源检查通过，包含固定话题与未来来源混合、旧会话及服务器授权不变、范围外拒绝、同名Agent，以及实际Chrome 390×844移动视口来源切换、草稿保留和零聊天提交。
- PWA构建通过；宿主一行补丁独立应用及语法核对通过。未重跑历史AA、工具、安装故障矩阵。

测试均在本机隔离夹具、临时SQLite和loopback服务上运行，复用已安装依赖，未调用真实模型。本轮移动UI证据是Chrome移动视口，不冒充Android实机验收。

候选通过统一组装生成，实际源码提交与载荷摘要见包内MANIFEST。范围保持：日常全局规则和只读状态继续保留，现有手机仍按原授权访问。日常宿主接线、生产服务/PWA的安装与重启需要集中维护窗口；安装时先核对当前目标和有效配置，不覆盖其他任务增量，不自动新建联合配对。

证据保留在`/home/jenn/NativeSync/.local/effective-rules-multisource-20261102`，包括两组TAP、移动视口截图和候选；可在下一次已接受版本交付时复核这些可重建材料。不扩建恢复工具，不恢复旧数据库、state、游标或Source绑定。
