# DICloak 客服助手 - Codex 开发包

## 项目概述
创建一个 DICloak 客服助手（内部版）网站，帮助客服人员快速生成专业回复。

---

## 快捷指令

请用以下 prompt 发送给 Codex：

```
请创建一个 DICloak 客服助手网站，具体要求如下：
```

然后将下方「完整开发规范」部分的内容复制给 Codex。

---

## 完整开发规范

### 技术栈要求
- Framework: Next.js 16 (App Router)
- Core: React 19
- Language: TypeScript 5
- UI 组件: shadcn/ui (基于 Radix UI)
- Styling: Tailwind CSS 4
- LLM: 使用 coze-coding-dev-sdk (doubao-seed-2-0-lite-260215 模型)
- 存储: 浏览器 localStorage
- 包管理器: pnpm

### 核心功能

#### 1. AI 回复生成
- 输入客户问题，AI 根据知识库生成 3 条推荐回复
- 使用流式输出（SSE）提升体验
- 回复格式：按 "\n\n" 分割，第一条显示"问题类型"，后续显示"回复1/2/3"
- 每条回复有独立卡片，包含标题行和内容卡片
- 复制按钮需去除标题（如 [回复1]），只复制纯内容

#### 2. 多对话管理
- 支持新建、删除、重命名多个独立对话
- 对话列表在左侧边栏
- 同一对话内支持多轮上下文记忆
- 数据存储在 localStorage (键名: diclok_conversations)

#### 3. 知识库管理
- 支持 Excel 文件导入知识库
- 支持的 Sheet 类型自动识别：
  - feature_faq: FAQ 库
  - user_routing: 用户路由
  - troubleshooting: 排障问题库
  - out_of_scope: 超范围问题库
  - mapping: 问题映射表
  - function_knowledge / 功能知识库: 功能知识库
  - term / Sheet1 / 术语库: 术语库
- 数据存储在 localStorage (键名: diclok_knowledge)

#### 4. System Prompt 设置
- 可编辑 AI 系统提示词
- 默认 Prompt 定义客服助手角色和回复要求
- 数据存储在 localStorage (键名: diclok_system_prompt)

### API 设计

#### POST /api/chat
- 功能：生成推荐回复
- 请求参数：
  ```typescript
  {
    message: string;           // 客户问题
    history: Array<{role: string; content: string}>;  // 对话历史
    knowledge: KnowledgeBase;  // 知识库数据
    systemPrompt: string;      // 系统提示词
  }
  ```
- 返回：流式 SSE 响应

### 数据存储规范
| 数据类型 | localStorage 键名 |
|---------|------------------|
| 对话数据 | diclok_conversations |
| 知识库 | diclok_knowledge |
| System Prompt | diclok_system_prompt |
| 当前对话ID | diclok_current_conversation |

### 重要提示
1. 由于服务端 API 无法直接访问 localStorage，前端需将知识库和 Prompt 数据通过请求体传递给后端
2. 回复标题显示规则：第一条为"问题类型"，后续为"回复1/2/3"
3. 复制时需去除标题，只复制纯内容

### 需要的依赖
```json
{
  "coze-coding-dev-sdk": "^0.7.21",
  "xlsx": "^0.18.5",
  "sonner": "^2.0.7",
  "lucide-react": "^0.468.0"
}
```

---

## 文件清单

以下是需要创建的源文件，请按顺序创建：

### 1. src/lib/types.ts
类型定义文件，包含所有数据模型。

### 2. src/lib/store.ts
localStorage 存储管理文件，包含对话、知识库、System Prompt 的存取函数。

### 3. src/lib/excel-parser.ts
Excel 解析工具，使用 xlsx 库解析 Excel 文件。

### 4. src/app/api/chat/route.ts
AI 回复生成 API，使用 coze-coding-dev-sdk 流式输出。

### 5. src/components/conversation-list.tsx
对话列表组件，左侧边栏，支持新建/删除/重命名。

### 6. src/components/chat-area.tsx
聊天区域组件，包含消息列表、输入框、复制功能。

### 7. src/components/knowledge-manager.tsx
知识库管理组件，Excel 导入和 Prompt 设置。

### 8. src/app/page.tsx
主页面，整合所有组件。

### 9. src/app/layout.tsx
布局组件。

### 10. src/app/globals.css
全局样式，包含 Tailwind CSS 4 配置。

### 11. package.json
项目依赖配置。

### 12. tsconfig.json
TypeScript 配置。

### 13. next.config.ts
Next.js 配置。

### 14. 其他配置文件
- components/ui/*.tsx (shadcn/ui 组件)
- .coze (Coze 部署配置)
- scripts/*.sh (构建脚本)

---

## UI 布局结构

```
┌─────────────────────────────────────────────────────┐
│  DICloak 客服助手                        内部版     │ ← 顶部标题栏
├──────────┬──────────────────────────────────────────┤
│          │  [对话助手]  [知识库]                      │ ← 标签页
│ 新建对话  ├──────────────────────────────────────────┤
│          │                                          │
│ 对话 1   │   用户问题                               │
│ 对话 2   │                                          │
│ 对话 3   │   ┌─ 问题类型 ──────────────┐            │
│          │   │ 回复内容               │ [复制]      │
│          │   └────────────────────────┘            │
│          │                                          │
│          │   ┌─ 回复1 ─────────────────┐           │
│          │   │ 回复内容               │ [复制]      │
│          │   └────────────────────────┘            │
│          │                                          │
│          │   ┌─ 回复2 ─────────────────┐           │
│          │   │ 回复内容               │ [复制]      │
│          │   └────────────────────────┘            │
│          ├──────────────────────────────────────────┤
│          │  [输入客户问题...]              [发送]   │ ← 输入区
└──────────┴──────────────────────────────────────────┘
```

---

## 关键代码片段参考

### extractPureContent 函数
```typescript
function extractPureContent(text: string): string {
  let content = text.trim();
  const patterns = [
    /^\[回复\s*\d+\]\s*/i,
    /^\[回复\d+\]\s*/i,
    /^回复\s*\d+\s*[:：]?\s*/i,
    /^\d+\s*[:：.、]\s*/,
    /^\[.*?\]\s*/,
  ];
  for (const pattern of patterns) {
    content = content.replace(pattern, "");
  }
  return content.trim();
}
```

### 回复卡片渲染逻辑
```typescript
message.content.split("\n\n").filter(Boolean).map((reply, index) => {
  const pureContent = extractPureContent(reply);
  const title = index === 0 ? "问题类型" : `回复${index}`;
  return (
    <div key={index} className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-600">{title}</h4>
        <Button size="sm" variant="ghost" onClick={() => handleCopy(pureContent)}>
          {copiedId === `${message.id}-${index}` ? "已复制" : "复制"}
        </Button>
      </div>
      <Card className="p-3">
        <p className="text-sm whitespace-pre-wrap">{pureContent}</p>
      </Card>
    </div>
  );
})
```
