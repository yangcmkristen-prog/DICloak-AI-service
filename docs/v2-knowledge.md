# V2 标准知识与安全分块

阶段二把 `knowledge-source/manifest.json` 指定的正式 Excel 转换为统一的 V2 知识记录，再按语义边界生成安全分块。该流程不调用模型、不生成 embedding、不建立向量索引，也不修改正式 Excel 或 V1 逻辑。

## 运行

```bash
pnpm v2:knowledge:build
pnpm v2:knowledge:test
```

运行结果默认写入 `reports/v2-knowledge/`：

- `knowledge-latest.json`：全部标准知识记录；
- `chunks-latest.json`：全部安全分块；
- `preview-latest.json`：统计、告警及至少 30 个真实分块样例；
- `preview-latest.html`：供人工查看的预览报告。

上述文件包含正式知识正文，因此默认由 Git 忽略，不提交仓库。

## 稳定性规则

- 知识 ID 使用源数据中的 FAQ ID、Function ID、API ID、term ID，套餐使用 `PRICING:<feature>:<plan>`；
- 分块 ID 由知识 ID、语义分块名称和序号确定，不依赖正文长度；
- 内容哈希使用规范化 JSON 的 SHA-256，正文或关键 metadata 变化时才变化；
- `source.file`、`source.sheet`、`source.row` 保留来源追踪；
- API Method、Endpoint、Full Path、参数、JSON Key、请求/响应字段、错误码，以及 FAQ 的 `{{}}` 和 URL 都记录为受保护字段；
- 所有分块继承所属知识的产品范围、term IDs、知识版本和来源，不跨产品或 API 类型拼接。
