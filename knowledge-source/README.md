# 正式知识源文件

本目录中的 Excel 是当前正式知识源的仓库副本，用于：

- Codex Cloud 知识诊断
- 知识数据诊断
- V2 知识适配开发
- 分块和检索评测

## 数据来源

Supabase 是线上应用实际读取的运行时知识数据。本目录保存与正式知识源对应的 Excel 副本，供版本追踪、Codex Cloud 诊断和离线开发使用；文件与知识类型之间的映射只以 `manifest.json` 为准。

## 注意

- 线上应用读取 Supabase，不直接读取仓库中的 Excel。
- 更新仓库 Excel 不会自动更新 Supabase。
- 更新正式知识时，必须同步更新 Supabase 运行时数据、本目录中的仓库文件，以及 `manifest.json` 的文件映射、`version` 和 `updatedAt`。
- Codex Cloud 可以使用仓库中的 Excel 进行知识诊断，但诊断结果不代表 Supabase 已自动同步。

## 正式文件

- FAQ：`FAQ库8.28.xlsx`
- 术语：`术语库8.11.xlsx`
- 功能知识：`功能知识库8.11.xlsx`
- API：`API端点与参数明细表8.17.xlsx`
- 套餐与功能支持：`DIC套餐功能支持表.xlsx`

运行 `pnpm validate:knowledge-manifest` 可校验 manifest 格式、必需字段、文件映射和目录完整性。
