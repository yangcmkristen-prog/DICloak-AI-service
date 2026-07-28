# DICloak AI Copilot 浏览器扩展

该扩展会在 WhatsApp Web 或 Telegram Web 右侧注入 DICloak AI 客服助手 Sidebar。扩展端只读取当前打开的聊天、展示缓存状态，并提供“翻译并清洗”、“生成推荐回复”和“AI 总结”能力。

## 安装

1. 在仓库根目录构建扩展：`pnpm extension:build`
2. 打开 Chrome / Edge：`chrome://extensions` 或 `edge://extensions`
3. 开启右上角“开发者模式”
4. 点击“加载已解压的扩展程序”
5. 选择本仓库的 `extension/` 目录
6. 打开 `https://web.whatsapp.com/` 或 `https://web.telegram.org/` 并登录
7. 点击任意聊天，右侧会出现 DICloak AI Copilot Sidebar
8. 如 Sidebar 已收起，点击浏览器工具栏里的 DICloak AI Copilot 扩展图标可重新显示

## 注意事项

- 扩展默认调用 `https://5wygm4zx4m.coze.site`，不再使用本地开发 API。
- 扩展不保存任何 API Key，也不单独配置知识库、Prompt 或模型；翻译和推荐回复统一实时调用线上网页端配置。
- 扩展不会自动发送消息，只提供复制 AI 结果。
- “收起”会完全隐藏 Sidebar；需要再次显示时，点击浏览器工具栏中的扩展图标。
- WhatsApp Web 和 Telegram Web 的 DOM 都不是公开稳定 API，如果网站更新页面结构，抓取选择器可能需要维护。
- AI 总结不再限制为最近 40 条，而是抓取当前会话已加载到页面 DOM 中的全部聊天消息；网页端尚未加载的更早记录仍需先在聊天窗口向上滚动加载，扩展不会后台批量抓取服务端历史。