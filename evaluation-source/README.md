# V2 固定评测源

本目录保存后续 V1、V2、Mock 与 Preview API 共用的固定、脱敏评测输入。评测题与期望结果不得导入知识库，也不得作为回答模型的知识上下文。

## 文件

- `manifest.json`：评测格式、Sheet、必填列和允许值的唯一机器可读定义。
- `V2评测集模板.xlsx`：可复制填写的评测模板，内含脱敏示例。
- `examples/mock-answers.json`：仅供确定性 Mock 评测使用的固定答案。

## 使用

1. 复制模板并填写案例，不要放入客户姓名、账号、邮箱、Token、截图或未脱敏对话。
2. 数组字段使用英文分号 `;` 分隔；内容本身需要分号时应拆成多个独立断言。
3. 运行 `pnpm evaluation:validate -- <文件.xlsx>` 校验格式。
4. 运行 `pnpm evaluation:mock` 生成 Mock 报告。

Mock 结果只验证确定性规则，不代表真实模型准确率。真实知识内容与客户内容生成的报告默认由 `.gitignore` 排除。
