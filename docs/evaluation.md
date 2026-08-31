# V2 评测与知识诊断

本阶段只建立评测基础设施，不实现 V2 检索或正式回复。评测题与回答模型的知识输入必须隔离。

## 命令

```bash
pnpm evaluation:validate
pnpm evaluation:test
pnpm evaluation:diagnose-knowledge
pnpm evaluation:mock
pnpm evaluation:all
```

真实 V1 基线要求本地应用已启动，且 Supabase 中存在知识与 V1 模型配置：

```bash
pnpm dev
pnpm evaluation:v1-baseline
```

如需从现有服务端 telemetry 日志汇总模型调用次数和 token，可设置 `EVALUATION_TELEMETRY_LOG` 指向该次测试的日志文件；不设置时相应字段为 `null`，不会修改 V1 响应协议。

## 输出与隐私

- `reports/knowledge/latest.*`：正式知识完整诊断，默认忽略。
- `reports/evaluation/mock-latest.*`：Mock 最新结果，默认忽略。
- `reports/evaluation/v1-baseline.*`：可能包含真实 V1 回答，默认忽略。
- `evaluation-source/examples/*-sample.*`：可提交的脱敏摘要。

不要将客户原文、客户标识、账号、Token、API Key 或正式知识全文加入 Git。Mock 通过率仅代表规则执行结果，不代表真实 AI 准确率。

## 回滚

本功能没有数据库迁移和运行时开关。回滚时删除 `evaluation-source/`、`scripts/evaluation/`、相关运行脚本和 `src/lib/evaluation/types.ts`，并撤销 `package.json` 与 `.gitignore` 中的对应条目即可；V1/V2 业务链路不受影响。
