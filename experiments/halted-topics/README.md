# 独立实验，禁止作为运行载荷安装

已按用户决定封存，不再推进产品化。回放使用原报告冻结的`full-source-accepted`候选（MANIFEST `ddf0408c…`）；
后续在线存储加固不改写本实验的旧版本证据，也不把这些原型断言作为新候选的发布门槛。

`prototype.cjs`提供合成SQLite服务端与客户端，`worker.cjs`用于实际进程中断，`validation.test.cjs`含14个安全条件与反例场景。
唯一入口为`tools/experiments/validate_halted_topics.py`，只加载已验证离线重建树中的冻结产品模块。
不提供产品修复CLI、生产路由、模型或工具执行，不被overlays、packages或发布组装清单引用。

判断、合同、适用范围和证据见`docs/experiments/halted-topics-validation-20261101.md`。
