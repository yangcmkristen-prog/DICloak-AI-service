# projects

这是一个基于 [Next.js 16](https://nextjs.org) + [shadcn/ui](https://ui.shadcn.com) 的全栈客服助手，支持部署到 Vercel。

## 快速开始

### 启动开发服务器

```bash
pnpm dev
```

启动后，在浏览器中打开 [http://localhost:5000](http://localhost:5000) 查看应用。

开发服务器支持热更新，修改代码后页面会自动刷新。

### 构建生产版本

```bash
pnpm build
```

### 启动生产服务器

```bash
pnpm start
```

## 项目结构

```
src/
├── app/                      # Next.js App Router 目录
│   ├── layout.tsx           # 根布局组件
│   ├── page.tsx             # 首页
│   ├── globals.css          # 全局样式（包含 shadcn 主题变量）
│   └── [route]/             # 其他路由页面
├── components/              # React 组件目录
│   └── ui/                  # shadcn/ui 基础组件（优先使用）
│       ├── button.tsx
│       ├── card.tsx
│       └── ...
├── lib/                     # 工具函数库
│   └── utils.ts            # cn() 等工具函数
└── hooks/                   # 自定义 React Hooks（可选）

server/
├── index.ts                 # 自定义服务器入口
├── tsconfig.json           # Server TypeScript 配置
└── dist/                    # 编译输出目录（自动生成）
```

## 核心开发规范

### 1. 组件开发

**优先使用 shadcn/ui 基础组件**

本项目已预装完整的 shadcn/ui 组件库，位于 `src/components/ui/` 目录。开发时应优先使用这些组件作为基础：

```tsx
// ✅ 推荐：使用 shadcn 基础组件
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export default function MyComponent() {
  return (
    <Card>
      <CardHeader>标题</CardHeader>
      <CardContent>
        <Input placeholder="输入内容" />
        <Button>提交</Button>
      </CardContent>
    </Card>
  );
}
```

**可用的 shadcn 组件清单**

- 表单：`button`, `input`, `textarea`, `select`, `checkbox`, `radio-group`, `switch`, `slider`
- 布局：`card`, `separator`, `tabs`, `accordion`, `collapsible`, `scroll-area`
- 反馈：`alert`, `alert-dialog`, `dialog`, `toast`, `sonner`, `progress`
- 导航：`dropdown-menu`, `menubar`, `navigation-menu`, `context-menu`
- 数据展示：`table`, `avatar`, `badge`, `hover-card`, `tooltip`, `popover`
- 其他：`calendar`, `command`, `carousel`, `resizable`, `sidebar`

详见 `src/components/ui/` 目录下的具体组件实现。

### 2. 路由开发

Next.js 使用文件系统路由，在 `src/app/` 目录下创建文件夹即可添加路由：

```bash
# 创建新路由 /about
src/app/about/page.tsx

# 创建动态路由 /posts/[id]
src/app/posts/[id]/page.tsx

# 创建路由组（不影响 URL）
src/app/(marketing)/about/page.tsx

# 创建 API 路由
src/app/api/users/route.ts
```

**页面组件示例**

```tsx
// src/app/about/page.tsx
import { Button } from '@/components/ui/button';

export const metadata = {
  title: '关于我们',
  description: '关于页面描述',
};

export default function AboutPage() {
  return (
    <div>
      <h1>关于我们</h1>
      <Button>了解更多</Button>
    </div>
  );
}
```

**动态路由示例**

```tsx
// src/app/posts/[id]/page.tsx
export default async function PostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <div>文章 ID: {id}</div>;
}
```

**API 路由示例**

```tsx
// src/app/api/users/route.ts
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ users: [] });
}

export async function POST(request: Request) {
  const body = await request.json();
  return NextResponse.json({ success: true });
}
```

### 3. 依赖管理

**必须使用 pnpm 管理依赖**

```bash
# ✅ 安装依赖
pnpm install

# ✅ 添加新依赖
pnpm add package-name

# ✅ 添加开发依赖
pnpm add -D package-name

# ❌ 禁止使用 npm 或 yarn
# npm install  # 错误！
# yarn add     # 错误！
```

项目已配置 `preinstall` 脚本，使用其他包管理器会报错。

### 4. 样式开发

**使用 Tailwind CSS v4**

本项目使用 Tailwind CSS v4 进行样式开发，并已配置 shadcn 主题变量。

```tsx
// 使用 Tailwind 类名
<div className="flex items-center gap-4 p-4 rounded-lg bg-background">
  <Button className="bg-primary text-primary-foreground">
    主要按钮
  </Button>
</div>

// 使用 cn() 工具函数合并类名
import { cn } from '@/lib/utils';

<div className={cn(
  "base-class",
  condition && "conditional-class",
  className
)}>
  内容
</div>
```

**主题变量**

主题变量定义在 `src/app/globals.css` 中，支持亮色/暗色模式：

- `--background`, `--foreground`
- `--primary`, `--primary-foreground`
- `--secondary`, `--secondary-foreground`
- `--muted`, `--muted-foreground`
- `--accent`, `--accent-foreground`
- `--destructive`, `--destructive-foreground`
- `--border`, `--input`, `--ring`

### 5. 表单开发

推荐使用 `react-hook-form` + `zod` 进行表单开发：

```tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const formSchema = z.object({
  username: z.string().min(2, '用户名至少 2 个字符'),
  email: z.string().email('请输入有效的邮箱'),
});

export default function MyForm() {
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: { username: '', email: '' },
  });

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    console.log(data);
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <Input {...form.register('username')} />
      <Input {...form.register('email')} />
      <Button type="submit">提交</Button>
    </form>
  );
}
```

### 6. 数据获取

**服务端组件（推荐）**

```tsx
// src/app/posts/page.tsx
async function getPosts() {
  const res = await fetch('https://api.example.com/posts', {
    cache: 'no-store', // 或 'force-cache'
  });
  return res.json();
}

export default async function PostsPage() {
  const posts = await getPosts();

  return (
    <div>
      {posts.map(post => (
        <div key={post.id}>{post.title}</div>
      ))}
    </div>
  );
}
```

**客户端组件**

```tsx
'use client';

import { useEffect, useState } from 'react';

export default function ClientComponent() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch('/api/data')
      .then(res => res.json())
      .then(setData);
  }, []);

  return <div>{JSON.stringify(data)}</div>;
}
```

## 常见开发场景

### 添加新页面

1. 在 `src/app/` 下创建文件夹和 `page.tsx`
2. 使用 shadcn 组件构建 UI
3. 根据需要添加 `layout.tsx` 和 `loading.tsx`

### 创建业务组件

1. 在 `src/components/` 下创建组件文件（非 UI 组件）
2. 优先组合使用 `src/components/ui/` 中的基础组件
3. 使用 TypeScript 定义 Props 类型

### 添加全局状态

推荐使用 React Context 或 Zustand：

```tsx
// src/lib/store.ts
import { create } from 'zustand';

interface Store {
  count: number;
  increment: () => void;
}

export const useStore = create<Store>((set) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 })),
}));
```

### 集成数据库

推荐使用 Prisma 或 Drizzle ORM，在 `src/lib/db.ts` 中配置。

## 技术栈

- **框架**: Next.js 16.1.1 (App Router)
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **样式**: Tailwind CSS v4
- **表单**: React Hook Form + Zod
- **图标**: Lucide React
- **字体**: Geist Sans & Geist Mono
- **包管理器**: pnpm 9+
- **TypeScript**: 5.x

## 参考文档

- [Next.js 官方文档](https://nextjs.org/docs)
- [shadcn/ui 组件文档](https://ui.shadcn.com)
- [Tailwind CSS 文档](https://tailwindcss.com/docs)
- [React Hook Form](https://react-hook-form.com)

## 重要提示

1. **必须使用 pnpm** 作为包管理器
2. **优先使用 shadcn/ui 组件** 而不是从零开发基础组件
3. **遵循 Next.js App Router 规范**，正确区分服务端/客户端组件
4. **使用 TypeScript** 进行类型安全开发
5. **使用 `@/` 路径别名** 导入模块（已配置）

# 飞书客户套餐自动同步

在 Vercel 配置 `FEISHU_WEBHOOK_TOKEN`（也兼容旧变量名 `FEISHU_WEBHOOK_SECRET`），然后将飞书自动化的 HTTP 请求设置为：

- `POST https://<你的域名>/api/customers/feishu-webhook`
- Header：推荐飞书使用 `X-Webhook-Token: <FEISHU_WEBHOOK_TOKEN>`；也支持 `Authorization: Bearer <FEISHU_WEBHOOK_TOKEN>`。同时设置 `Content-Type: application/json`
- 建议不同自动化流程分别增加 `X-Webhook-Source`，例如 `plan-created`、`plan-updated`，便于在日志中定位来源
- Body：可发送单条 `{"record":{"fields":{...}}}`，也可发送 `{"records":[{"fields":{...}}]}`

支持字段：`团队ID`、`联系人`（也兼容 `团队名字`）、`联系方式`（也兼容 `用户联系方式`）、`渠道`（也兼容 `私域渠道`）、`创建时间`、`到期时间`、`当前套餐`（也兼容 `套餐`）。`团队ID` 是必填且唯一的识别字段；一次请求中的重复 ID 仅处理第一条。

已有客户只有在至少一个非空业务字段真正变化时才会写入，并刷新 `automaticUpdatedAt`；完全相同的重复推送返回 `unchanged`，不会改变“自动更新时间”。每次请求的响应都包含 `requestId`，服务端同时输出前缀为 `[Feishu Customer Webhook Audit]` 的结构化日志。线上可在 Vercel 项目 **Logs / Runtime Logs** 中按该前缀、`requestId`、团队 ID 或 `source` 搜索；本地开发时日志显示在 `pnpm dev` 终端。审计日志不记录联系方式。

Windows Git Bash/Git for Windows 如果没有以 UTF-8 发送中文参数，可使用英文字段名 `teamId`、`contactName`、`contactDetail`、`contactMethod`、`createdAt`、`dueDate`、`currentPlan`；飞书自动化仍可直接使用上面的中文字段名。

飞书显示 `Connection Timed Out` 时，请先在 Vercel Functions Logs 检查 Supabase 连接；Webhook 仅按本次请求的团队 ID 查询客户，不会扫描并下载完整客户表。

连通性排查时，不要用 `robots.txt` 中的 `Disallow: /api/` 判断 API 是否可访问：该规则只约束遵守 robots 协议的搜索引擎爬虫，不会阻止飞书 HTTP 请求。请在飞书中发送 `GET https://<你的域名>/api/customers/feishu-webhook`（无需 Header 和 Body）。接口应返回 JSON：

```json
{
  "ok": true,
  "endpoint": "/api/customers/feishu-webhook",
  "message": "Feishu customer webhook is reachable; use POST to synchronize data."
}
```

如果该 GET 成功，再用同一路径发送不带 Token 的 POST；快速返回 `401` 表示 POST 请求也已到达应用。随后恢复 `X-Webhook-Token` 和正式 JSON Body。若 GET 仍超时且 Vercel Runtime Logs 没有记录，则应检查飞书到动态函数的网络、Vercel Deployment Protection 和 Firewall Events，而不是修改 `robots.txt`。

## 飞书超时与 Vercel 日志核对

不要只看 Vercel 是否存在同一路径的 `200`，必须核对请求时间和请求来源。飞书自动化在 `16:02:53` 发起请求时，`15:59:17` 的日志不是同一次请求；详情中显示 `User-Agent: Mozilla/5.0 (Windows ...)` 且 `Prefetch: Yes` 的请求来自浏览器访问或页面预取，不是飞书服务器。

部署后可先让飞书请求不导入数据库依赖的轻量 Edge 诊断地址：

```text
GET https://<你的域名>/api/customers/feishu-ping
```

预期返回 `{"ok":true,"service":"feishu-webhook"}`。如果这个地址仍在约 16 秒后超时，并且 Vercel 在同一时间没有对应日志，则请求没有到达 Vercel，问题发生在飞书到 `vercel.app` 的连接链路；此时修改 Webhook、Supabase 或 JSON 解析没有作用。请为项目绑定自定义域名并在飞书中改用该域名；如果自定义域名仍不稳定，则使用飞书可稳定访问区域的 API Gateway、云函数或 Worker 转发请求。

如果 `feishu-ping` 成功而正式 GET 超时，再检查正式 GET 在 Vercel 中的同时间日志和执行时长。正式健康检查本身不访问 Supabase；Vercel 若已在几百毫秒内完成并返回 `200`，但飞书仍报告超时，需要使用自定义域名或中转服务解决 Vercel 返回链路兼容性，而不是继续优化数据库查询。
