# Vercel 部署与测试环境指南

## 结论

这个项目是标准 Next.js App Router 应用，可以直接部署到 Vercel。项目构建、开发和启动命令均使用 Next.js 标准命令，不依赖自定义常驻服务器。

迁移不会自动搬迁数据库。只要 Supabase 可从公网访问、表结构不变，并在 Vercel 配置正确的环境变量，现有数据可以继续使用。**测试环境不要连接生产数据库**：当前配置、知识库和部分业务数据会被接口写入，共用数据库会让 Preview 修改线上数据。

## 迁移前必须处理的事项

### 1. 准备两套 Supabase 环境

推荐创建两个 Supabase 项目：

| Vercel 环境 | Git 分支 | Supabase | 用途 |
| --- | --- | --- | --- |
| Preview | 功能分支或 `develop` | 测试项目 | 验收、测试导入和配置修改 |
| Production | `main` | 生产项目 | 正式用户 |

把生产 Supabase 的表结构复制到测试项目，但不要复制敏感生产数据。至少确认项目使用的表、唯一键、索引和 RLS 策略一致。

如果短期只能共用一个 Supabase 项目，至少应增加环境/租户字段并让所有查询强制过滤；目前代码大量使用固定的 `config_key = 'default'`，因此在完成隔离改造前不建议共库。

### 2. 在 Vercel 配置环境变量

在 **Project Settings → Environment Variables** 中按 Preview 和 Production 分别填写 `.env.example` 中的变量：

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SETTINGS_ACCESS_PASSWORD`

Production 填生产值，Preview 填测试值。`SUPABASE_SERVICE_ROLE_KEY` 只能用于服务端，绝不能添加 `NEXT_PUBLIC_` 前缀。修改环境变量后要重新部署，它们不会自动进入已经生成的部署。

数据库客户端只读取上述标准 Supabase 环境变量。

### 3. 单独确认模型访问凭证

当前模型配置保存在 `system_configs`。请在**测试数据库**的设置页面分别配置主 AI 模型、翻译模型和图片识别模型的 API Key、模型及 Base URL，并完成真实调用测试；确认成功后，再在生产数据库单独配置生产凭证。项目不再提供内置模型或无 Key 调用，所有模型都必须使用显式配置的外部凭证。

### 4. 上线前补强访问控制

Vercel Production 默认是公开互联网地址。当前 `SETTINGS_ACCESS_PASSWORD` 只应被视为设置入口保护，不能替代所有 API 的身份认证。上线前应检查：

1. 对修改系统配置、知识库、会话和话术的 API 增加服务端认证与授权。
2. Supabase 开启 RLS；浏览器使用 anon key 时只授予必要权限。
3. 不向浏览器返回 service-role key 或模型 API Key。
4. 在 Vercel 为 Preview 开启 Deployment Protection，避免测试链接被外部访问。
5. 为模型和数据库设置额度、审计和告警，避免公开接口被滥用产生费用。

从内部页面切换到公网域名后，暴露面会明显增加。

## 推荐发布流程

### 首次配置

1. 将仓库连接到 Vercel，新建一个 Project。
2. Framework Preset 选择 **Next.js**；Root Directory 保持仓库根目录。
3. Production Branch 设为 `main`。
4. 分别配置 Preview 与 Production 环境变量。
5. 为 Preview 配置测试 Supabase，为 Production 配置生产 Supabase。
6. 开启 Preview Deployment Protection，并限制团队成员访问。

### 每次发布

1. 从 `main` 创建功能分支并提交代码。
2. 推送分支并创建 Pull Request；Vercel 自动创建独立 Preview URL。
3. 在 Preview URL 执行下方验收清单。
4. 验收通过后合并到 `main`；Vercel 自动创建 Production Deployment。
5. 若线上异常，在 Vercel Deployments 中将上一个健康部署重新 Promote/Rollback；数据库变更必须使用单独的可回滚迁移方案。

如果希望固定测试域名（例如 `test.example.com`），可以让 `develop` 分支持续产生 Preview，并把测试域名指向该分支；如果团队使用支持 Custom Environments 的 Vercel 套餐，也可建立独立 Staging environment。无论哪种方式，都必须保持测试与生产数据库和密钥隔离。

## Preview 验收清单

- 首页可打开，浏览器控制台没有 hydration 或资源错误。
- `/api/config/system` 和 `/api/config/knowledge` 能读取测试数据库。
- 新建、重命名、删除对话正常，刷新后数据符合预期。
- 导入一份非生产 Excel，确认知识库只写入测试环境。
- 发送一条问题，确认流式状态与最终回复完整返回。
- 测试翻译、关键词、OCR 和 Copilot 等实际启用的 API。
- 确认设置页面保护、Supabase RLS 和未授权 API 请求行为。
- 查看 Vercel Function Logs，确认没有超时、内存超限或凭证错误。

## 现有数据与浏览器扩展

- 移除内置模型不会删除或迁移 Supabase 表，也不会清空浏览器 `localStorage`。知识库、系统 Prompt、已保存话术、客户资料、客户总结和对话数据仍使用原来的表或浏览器存储。
- 已保存的 GPT、DeepSeek、阿里百炼和自定义 OpenAI 兼容模型配置会继续使用。只有历史配置仍指向已经移除的提供商时，AI 接口才会提示管理员重新选择模型；该提示不会修改其他业务数据。
- 浏览器扩展继续调用网页端的 `/api/copilot/*` 接口，因此知识库、Prompt、话术和客户信息处理逻辑不变。部署后必须把 `extension/config.json` 的 `apiBaseUrl` 改为正式 Vercel 地址，再重新构建并重新加载扩展。
- 扩展清单默认允许 `*.vercel.app`。如果使用自定义域名，还需要把该域名加入 `extension/manifest.json` 的 `host_permissions`，否则浏览器会拦截请求。

## 可能的运行影响

- **冷启动与超时**：API Route 会作为 Vercel Functions 运行。长时间模型请求应在真实 Preview 中测试；若出现超时，可在套餐允许范围内设置函数时长，或拆分长任务。
- **流式输出**：当前 Route Handler 的流式响应模式与 Vercel/Next.js 兼容，但代理链路、模型首 Token 时间和函数时长仍需实测。
- **无常驻进程**：Vercel 不运行 `src/server.ts`、无限循环、后台自动拉取或本地端口监听。代码发布由 Git 集成触发。
- **无持久本地磁盘**：不要把上传文件或业务状态写到函数本地文件系统；当前持久数据应继续放在 Supabase/对象存储中。
- **区域延迟**：Vercel Function 与 Supabase 跨区域会增加延迟，建议选择相近区域并通过日志观察。
- **预览成本**：每个 Preview 都可能调用真实模型和数据库，因此测试凭证也应配置调用额度。

## 本地模拟 Vercel 构建

```bash
cp .env.example .env.local
# 将占位值替换为测试环境凭证
pnpm install --frozen-lockfile
pnpm vercel-build
pnpm next start
```

不要把 `.env.local` 提交到 Git；仓库的 `.gitignore` 已忽略该文件。

## 官方参考

- [Vercel：Environments](https://vercel.com/docs/deployments/environments)
- [Vercel：Environment Variables](https://vercel.com/docs/environment-variables)
- [Vercel：Git deployments](https://vercel.com/docs/deployments/git)
- [Vercel：Deployment Protection](https://vercel.com/docs/deployment-protection)
- [Vercel：Functions](https://vercel.com/docs/functions)
- [Next.js on Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs)
