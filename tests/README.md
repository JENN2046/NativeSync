# 测试边界

默认 npm test 只运行 snapshot-prompt 的8项纯函数测试。

known-gaps/first-batch-existing-protocol.test.cjs 当前包含18项：原7项按旧全根/
新限域两种合同区分，新增11项覆盖限域写入口、持久绑定、暂停、重开与原操作恢复。
越界安全断言未删除；现在显式给出 limited grant，要求范围外0导入。
旧全根另保留正向断言，必须仍能导入整根的第三话题。初始版本6/7的失败证据
保留在 #70 的旧交付及本批控制组原始 TAP 中，不累加到通过数。

运行 tools/run_limited_tests.py，传入匹配 Node24、隔离两宿主 source 目录和
一个新输出目录。它将唯一施工源 overlays 受控叠加到该测试目录，并逐文件独立
进程执行18项限域、13项原 SourceSync（含原五个指定回归）、4项进程退出恢复、
8项纯函数测试。需要匹配的公开宿主 fixture、HistoryMutationQueue 及相邻源码
与锁定独立依赖；主机来源/摘要随本批证据包提供。禁止传入生产目录、真实数据。
执行环境移除 provider/凭据变量，服务仅监听127.0.0.1，输入均为合成数据。

旧 C1/C2/112 项仍是历史证据，不计作这次运行；不启动真实模型或浏览器验收。

## M2/M3 连续冲刺

新增20项受支持路径断言：M2 9项、真实子进程退出3项、M3多Agent/失败关闭8项。
另有 `known-gaps/m3-existing-source-expansion.test.cjs` 的1项**必需升级能力**探针，
当前真实失败于 SOURCE_BINDING_CHANGED。不能把该失败或“正确拒绝迁移”的断言计为升级通过。
完整 runner 的成功执行结果是 PARTIAL/退出2；其他未预期失败为退出1。

```sh
python3 tools/run_m2_m3.py --hosts /absolute/isolated/hosts --node /absolute/node24 --output /absolute/new-output
```

每文件独立进程，最小无凭据环境；JS fetch只准127.0.0.1，退出探针校验临时根及loopback。
手机是实际MobilePortal的只读HTTP会话，使用本机可信代理的TLS终止语义，不是实际TLS、
PWA渲染或真实手机；远端冲突写者通过真实CentralStore.apply注入合成事实。
临时engine未设置模型endpoint，未调用provider、工具或AA。旧43项未重跑、未混入本批计数。
