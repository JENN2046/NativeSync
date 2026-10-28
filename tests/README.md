# 测试边界

默认npm test只执行snapshot-prompt的8项纯函数测试，无provider/密钥/数据库。

known-gaps/first-batch-existing-protocol.test.cjs保留当前分批能力反例：7项中6通过，1项期望的批次安全条件不满足，进程应退出1；不把它并入默认绿色套件或改断言消掉失败。需要NATIVESYNC_TEST_HOSTS指向匹配公开VCPChat和VCPToolBox两个宿主目录，并提供对应独立依赖；VCP_R21_BOX_SOURCE指向该目录的VCPToolBox。不要使用生产runtime或真实AppData。

本仓测试副本只调整外部公开宿主路径及输出位置，不改该反例的安全断言。旧C1/C2/112项是既有证据，本次不重新验收或假称新增实跑。
