# 项目上下文

### 版本技术栈

- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **Styling**: Tailwind CSS 4

## 目录结构

```
├── public/                 # 静态资源
├── scripts/                # 构建与启动脚本
│   ├── build.sh            # 构建脚本
│   ├── dev.sh              # 开发环境启动脚本
│   ├── prepare.sh          # 预处理脚本
│   └── start.sh            # 生产环境启动脚本
├── src/
│   ├── app/                # 页面路由与布局
│   ├── components/ui/      # Shadcn UI 组件库
│   ├── hooks/              # 自定义 Hooks
│   ├── lib/                # 工具库
│   │   └── utils.ts        # 通用工具函数 (cn)
│   └── server.ts           # 自定义服务端入口
├── next.config.ts          # Next.js 配置
├── package.json            # 项目依赖管理
└── tsconfig.json           # TypeScript 配置
```

- 项目文件（如 app 目录、pages 目录、components 等）默认初始化到 `src/` 目录下。

## 包管理规范

**仅允许使用 pnpm** 作为包管理器，**严禁使用 npm 或 yarn**。
**常用命令**：
- 安装依赖：`pnpm add <package>`
- 安装开发依赖：`pnpm add -D <package>`
- 安装所有依赖：`pnpm install`
- 移除依赖：`pnpm remove <package>`

## 开发规范

### 编码规范

- 默认按 TypeScript `strict` 心智写代码；优先复用当前作用域已声明的变量、函数、类型和导入，禁止引用未声明标识符或拼错变量名。
- 禁止隐式 `any` 和 `as any`；函数参数、返回值、解构项、事件对象、`catch` 错误在使用前应有明确类型或先完成类型收窄，并清理未使用的变量和导入。

### next.config 配置规范

- 配置的路径不要写死绝对路径，必须使用 path.resolve(__dirname, ...)、import.meta.dirname 或 process.cwd() 动态拼接。

### Hydration 问题防范

1. 严禁在 JSX 渲染逻辑中直接使用 typeof window、Date.now()、Math.random() 等动态数据。**必须使用 'use client' 并配合 useEffect + useState 确保动态内容仅在客户端挂载后渲染**；同时严禁非法 HTML 嵌套（如 <p> 嵌套 <div>）。
2. **禁止使用 head 标签**，优先使用 metadata，详见文档：https://nextjs.org/docs/app/api-reference/functions/generate-metadata
   1. 三方 CSS、字体等资源可在 `globals.css` 中顶部通过 `@import` 引入或使用 next/font
   2. preload, preconnect, dns-prefetch 通过 ReactDOM 的 preload、preconnect、dns-prefetch 方法引入
   3. json-ld 可阅读 https://nextjs.org/docs/app/guides/json-ld

## UI 设计与组件规范 (UI & Styling Standards)

- 模板默认预装核心组件库 `shadcn/ui`，位于`src/components/ui/`目录下
- Next.js 项目**必须默认**采用 shadcn/ui 组件、风格和规范，**除非用户指定用其他的组件和规范。**

---

# DICloak 客服助手项目规范

## 项目概述

DICloak 客服助手（内部版）是一个帮助客服人员快速生成专业回复的 AI 工具。

### 核心功能

1. **AI 回复生成**：输入客户问题，AI 根据知识库和对话历史生成 3 条推荐回复
2. **多对话管理**：支持新建、删除、重命名多个独立对话
3. **对话记忆**：同一对话内支持多轮对话上下文
4. **知识库配置**：支持飞书多维表格链接和自定义文档内容

### 文件结构

```
src/
├── app/
│   ├── api/
│   │   ├── chat/route.ts         # AI 回复生成 API (流式)
│   │   ├── conversations/route.ts # 对话管理 API
│   │   └── knowledge/route.ts    # 知识库管理 API
│   ├── page.tsx                  # 主页面
│   └── layout.tsx                # 布局
├── components/
│   ├── conversation-list.tsx     # 左侧对话列表
│   ├── chat-area.tsx             # 聊天区域
│   └── knowledge-manager.tsx     # 知识库管理
└── lib/
    ├── types.ts                  # 类型定义
    └── store.ts                  # localStorage 存储
```

### API 接口

| 接口 | 方法 | 描述 |
|------|------|------|
| `/api/chat` | POST | 生成推荐回复（流式输出） |
| `/api/conversations` | GET | 获取对话列表 |
| `/api/conversations` | POST | 创建新对话 |
| `/api/conversations` | PUT | 更新对话（重命名等） |
| `/api/conversations` | DELETE | 删除对话 |
| `/api/knowledge` | GET | 获取知识库列表 |
| `/api/knowledge` | POST | 添加知识库项 |
| `/api/knowledge` | DELETE | 删除知识库项 |

### 数据存储

- 对话数据存储在浏览器 `localStorage`（键名：`diclok_conversations`）
- 知识库数据存储在浏览器 `localStorage`（键名：`diclok_knowledge`）
- 当前对话 ID 存储在 `localStorage`（键名：`diclok_current_conversation`）

### LLM 配置

- 使用 `coze-coding-dev-sdk` 的流式接口
- 模型：`doubao-seed-2-0-lite-260215`
- Temperature: 0.7
- System Prompt: 客服助手角色定义
