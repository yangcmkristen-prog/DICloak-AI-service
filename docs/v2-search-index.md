# V2 多语言向量与全文索引

阶段三消费阶段二生成的标准知识和安全分块，不读取 Excel，也不改变 V1。向量用于跨语言语义召回，`simple` 全文索引用于 Endpoint、Method、参数、错误码、术语和 UI Label 等原样匹配。查询只生成一次 embedding，不先翻译成多种语言。

## 安全部署顺序

1. 创建独立测试 Supabase 项目，确认 `V2_SEARCH_ENVIRONMENT=test`。
2. 人工审阅 migration；确认 embedding 维度为 1536，并显式设置 `V2_SEARCH_ALLOW_MIGRATION=true`。
3. 在测试库执行 `supabase/migrations/202609010001_v2_search_index.sql`。
4. 创建 `building` 版本，按 `contentHash` 复用未变化块，只为新增或变化块生成 embedding。
5. 校验预期数、成功数和失败数。只有完全成功才调用 `v2_search.publish_index`。
6. 中文、英文、葡萄牙语、俄语和精确技术字段查询通过后，再单独审批生产发布。

版本发布是原子的：构建失败会标记 `failed`，当前 `published` 版本保持有效。新版本不复制已删除或停用的块，因此发布后不可检索；旧版本可在验收期保留用于回滚。对 Schema、表、函数均撤销匿名和登录用户权限，只允许受控服务端角色访问。

本地执行 `pnpm v2:index:check-env` 只输出状态，不输出配置值。`pnpm v2:index:mock` 使用确定性 Mock 向量生成本地报告，不能称为真实 AI 或跨语言准确率。
