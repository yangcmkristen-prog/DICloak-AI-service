# 正式知识源文件

本目录中的文件是当前正式知识库的源 Excel 副本，用于：

- Codex Cloud 自动测试
- 知识数据诊断
- V2 知识适配开发
- 分块和检索评测

## 数据来源

这些文件与上传到 Supabase 正式知识库的源文件保持一致。

## 注意

- 线上应用仍然读取 Supabase。
- 修改此目录不会自动更新 Supabase。
- 更新正式知识时，需要同时：
  1. 在网页知识管理器上传到 Supabase；
  2. 更新本目录文件；
  3. 更新 manifest 版本。

## 正式文件

- FAQ：faq.xlsx
- 术语：terminology.xlsx
- 功能知识：function-knowledge.xlsx
- API：api.xlsx
- 价格：pricing.xlsx
