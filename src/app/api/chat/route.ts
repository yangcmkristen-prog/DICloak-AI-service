import { NextRequest, NextResponse } from "next/server";

// 语言检测
function detectLanguage(text: string): string {
  const chineseChars = text.match(/[\u4e00-\u9fff]/g) || [];
  const russianChars = text.match(/[\u0400-\u04ff]/g) || [];
  const vietnameseChars = text.match(/[\u1ea0-\u1ef9]/gi) || [];
  const latinChars = text.match(/[áàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ]/gi) || [];
  const portugueseMarkers = text.match(/(ão|ção|ção|ês|eza|inho|inha|mente|dade)/gi) || [];
  const spanishMarkers = text.match(/(ción|mente|dad|oso|osa|ente|idad)/gi) || [];

  const totalChars = text.replace(/\s/g, "").length;

  // 只要有小语种字符就判断为小语种
  if (russianChars.length > 0) return "ru";
  if (vietnameseChars.length > 0) return "vi";
  if (portugueseMarkers.length > spanishMarkers.length && latinChars.length > 0) return "pt";
  if (spanishMarkers.length > 0 && latinChars.length > 0) return "es";

  // 中文字符超过 15% 判断为中文
  if (chineseChars.length / totalChars > 0.15) return "zh";

  // 默认英文
  return "en";
}

// 同义词映射
const SYNONYMS: Record<string, string[]> = {
  // 中文同义词
  "登录": ["login", "登入", "signin", "sign-in", "登陆"],
  "设备": ["device", "装置", "硬件"],
  "上限": ["limit", "限制", "额度", "maximum", "quota"],
  "增加": ["increase", "提高", "提升", "添加", "add", "extend", "扩展"],
  "创建": ["create", "新建", "添加", "add", "建立"],
  "成员": ["member", "用户", "user", "账号", "account"],
  "团队": ["team", "组织", "organization"],
  "环境": ["profile", "配置", "浏览器环境", "browser profile"],
  "代理": ["proxy", "代理服务器", "网络代理"],
  "浏览器": ["browser", "chrome", "edge", "firefox", "火狐"],
  "火狐": ["firefox", "mozilla"],
  "内核": ["kernel", "browser kernel", "浏览器内核"],
  "删除": ["delete", "remove", "移除", "清除"],
  "恢复": ["restore", "recover", "还原", "找回"],
  "导入": ["import", "导入"],
  "导出": ["export", "导出"],
  "cookies": ["cookie", "曲奇", "缓存"],
  "扩展": ["extension", "插件", "plugin"],
  "密码": ["password", "密码", "pass"],
  "账号": ["account", "账户", "用户"],
  "付费": ["pay", "payment", "购买", "purchase", "订阅", "subscribe"],
  "升级": ["upgrade", "升级", "更新", "update"],
  "套餐": ["plan", "package", "订阅", "subscription"],
  "额度": ["quota", "limit", "上限", "额度"],
  "绑定": ["bind", "关联", "link"],
  "解绑": ["unbind", "解除绑定", "unlink"],
  "同步": ["sync", "synchronize", "同步"],
  "配置": ["config", "configuration", "设置", "settings"],
  "权限": ["permission", "authority", "权限"],
  "角色": ["role", "角色", "身份"],
  "邀请": ["invite", "邀请"],
  "api": ["api", "接口", "interface"],
  "密钥": ["key", "secret", "api key", "token"],
  "异常": ["error", "issue", "问题", "故障"],
  "报错": ["error", "exception", "错误", "失败"],
  "无法": ["cannot", "can't", "failed", "失败"],
  "版本": ["version", "版本"],
  "更新": ["update", "upgrade", "升级"],
  "下载": ["download", "下载"],
  "安装": ["install", "installation", "安装"],
};

// 获取同义词
function getSynonyms(word: string): string[] {
  const lower = word.toLowerCase();
  const synonyms = SYNONYMS[lower] || [];
  // 反向查找
  for (const [key, values] of Object.entries(SYNONYMS)) {
    if (values.some(v => v.toLowerCase() === lower)) {
      synonyms.push(key, ...values.filter(v => v.toLowerCase() !== lower));
    }
  }
  return [...new Set(synonyms)];
}

// 分词
function tokenize(text: string): string[] {
  // 中文分词（简单实现：按字符+常见词）
  const chineseWords = text.match(/[\u4e00-\u9fff]+/g) || [];
  const englishWords = text.match(/[a-zA-Z]+/g) || [];
  
  const tokens: string[] = [];
  
  // 英文单词直接加入
  tokens.push(...englishWords.map(w => w.toLowerCase()));
  
  // 中文按2-4字组合
  for (const word of chineseWords) {
    if (word.length <= 4) {
      tokens.push(word);
    } else {
      // 拆分成2字词组
      for (let i = 0; i < word.length - 1; i++) {
        tokens.push(word.slice(i, i + 2));
      }
    }
  }
  
  return tokens;
}

// 计算匹配分数（改进版）
function calculateMatchScore(message: string, item: any): number {
  const msgLower = message.toLowerCase();
  let score = 0;

  const questionCN = (item.questionCN || "").toLowerCase();
  const questionEN = (item.questionEN || "").toLowerCase();
  const keywords = (item.keywords || "").toLowerCase();
  const answer = (item.answer || "").toLowerCase();

  // 1. 完全匹配问题
  if (questionCN.includes(msgLower) || questionEN.includes(msgLower)) {
    score += 20;
  }

  // 2. 问题包含消息
  if (msgLower.includes(questionCN) || msgLower.includes(questionEN)) {
    score += 15;
  }

  // 3. 关键词匹配（带同义词扩展）
  const msgTokens = tokenize(message);
  
  for (const token of msgTokens) {
    // 直接匹配
    if (questionCN.includes(token) || questionEN.includes(token)) {
      score += 3;
    }
    if (keywords.includes(token)) {
      score += 5;
    }
    if (answer.includes(token)) {
      score += 1;
    }
    
    // 同义词匹配
    const synonyms = getSynonyms(token);
    for (const syn of synonyms) {
      if (questionCN.includes(syn) || questionEN.includes(syn)) {
        score += 2;
      }
      if (keywords.includes(syn)) {
        score += 4;
      }
    }
  }

  // 4. 核心概念匹配（重要关键词加分）
  const coreConcepts = ["登录", "设备", "上限", "创建", "删除", "恢复", "代理", "环境", "成员", "团队", "api", "账号", "付费", "升级"];
  for (const concept of coreConcepts) {
    if (msgLower.includes(concept) && (questionCN.includes(concept) || questionEN.includes(concept))) {
      score += 5;
    }
  }

  return score;
}

// 构建术语翻译映射
function buildTermTranslations(termIds: string[], knowledge: any, targetLang: string): Map<string, string> {
  const translations = new Map<string, string>();
  if (!termIds || termIds.length === 0) return translations;

  const langMap: Record<string, string> = {
    zh: "中文",
    en: "英文",
    pt: "葡萄牙语（巴西）",
    es: "西班牙语",
    ru: "俄语",
    vi: "越南语"
  };
  const langField = langMap[targetLang] || "中文";

  const termItems = knowledge.termItems || [];
  for (const termId of termIds) {
    const termItem = termItems.find((t: any) => t.term_id === termId || t.termId === termId);
    if (termItem) {
      const english = termItem["英文"] || termItem["en"] || termItem["english"] || "";
      const translated = termItem[langField] || english;
      if (english && translated) {
        translations.set(english, translated);
        translations.set(termId, translated);
      }
    }
  }
  return translations;
}

// 替换术语占位符
function replaceTermPlaceholders(text: string, translations: Map<string, string>): string {
  let result = text;
  result = result.replace(/\{\{([^}]+)\}\}/g, (match, termName) => {
    if (translations.has(termName)) {
      return translations.get(termName) || termName;
    }
    return termName;
  });
  return result;
}

// 构建知识库上下文
function buildKnowledgeContext(message: string, knowledge: any, targetLang: string): string {
  let context = "";
  
  if (!knowledge) return context;

  // 匹配 FAQ
  const faqItems = knowledge.faqItems || [];
  const matchedFaq = faqItems
    .map((item: any) => ({ item, score: calculateMatchScore(message, item) }))
    .filter((m: any) => m.score >= 3)  // 提高阈值避免噪音
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, 3);  // 只取前3个最相关的

  console.log(`[FAQ] 匹配到 ${matchedFaq.length} 条, 最高分: ${matchedFaq[0]?.score || 0}`);

  if (matchedFaq.length > 0) {
    context += "## 匹配到的知识库内容\n";
    context += "以下是与用户问题最相关的FAQ，请务必基于这些标准答案生成回复：\n\n";
    
    matchedFaq.forEach((m: any, index: number) => {
      const item = m.item;
      const termIds = item.termIds || item.term_id || [];
      const translations = buildTermTranslations(
        typeof termIds === 'string' ? termIds.split(/[,，、]/) : termIds,
        knowledge,
        targetLang
      );
      const translatedAnswer = replaceTermPlaceholders(item.answer || '', translations);
      
      context += `### FAQ ${index + 1} (匹配分数: ${m.score})\n`;
      context += `问题: ${item.questionCN || item.questionEN}\n`;
      context += `标准答案: ${translatedAnswer}\n\n`;
    });
  }

  // 匹配 Troubleshooting
  const tsItems = knowledge.troubleshootingItems || [];
  const matchedTs = tsItems
    .map((item: any) => ({ item, score: calculateMatchScore(message, item) }))
    .filter((m: any) => m.score >= 3)
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, 2);

  if (matchedTs.length > 0) {
    context += "## 匹配到的故障排除\n\n";
    
    matchedTs.forEach((m: any, index: number) => {
      const item = m.item;
      const termIds = item.termIds || item.term_id || [];
      const translations = buildTermTranslations(
        typeof termIds === 'string' ? termIds.split(/[,，、]/) : termIds,
        knowledge,
        targetLang
      );
      const translatedAnswer = replaceTermPlaceholders(item.answer || '', translations);
      
      context += `### 故障 ${index + 1} (匹配分数: ${m.score})\n`;
      context += `问题: ${item.questionCN || item.questionEN}\n`;
      context += `解决方案: ${translatedAnswer}\n\n`;
    });
  }

  return context;
}

// 构建对话历史
function buildHistoryContext(history: any[]): string {
  if (!history || history.length === 0) return "";
  
  let context = "## 对话历史\n";
  history.forEach((msg) => {
    if (msg.role === "user") {
      context += `用户: ${msg.content}\n`;
    } else if (msg.role === "assistant") {
      context += `助手: ${msg.content}\n`;
    }
  });
  return context + "\n";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      message, 
      history = [], 
      knowledge, 
      systemPrompt, 
      apiConfig,
      role 
    } = body;

    console.log(`[Request] 消息: ${message}`);

    // 语言检测
    const detectedLang = detectLanguage(message);
    console.log(`[Language] 检测语言: ${detectedLang}`);

    // 构建知识库上下文
    const knowledgeContext = buildKnowledgeContext(message, knowledge, detectedLang);
    const historyContext = buildHistoryContext(history);

    // System Prompt
    const defaultSystemPrompt = `你是 DICloak 客服助手，专门帮助客服人员生成专业回复。

## 核心规则（必须遵守）

1. **必须使用知识库的标准答案**：
   - 当知识库有匹配的内容时，必须直接使用或基于标准答案生成回复
   - 禁止编造答案！如果没有匹配的知识库内容，输出"未找到相关知识"

2. **回复格式**（严格按此格式）：
主回复
[直接回答用户问题，使用知识库标准答案]
---
补充建议
[可选，提供额外操作建议]
---
需补充的信息
[可选，询问需要的信息]

3. **语言要求**：用用户提问的语言回复`;

    const finalSystemPrompt = `${defaultSystemPrompt}

${knowledgeContext}

${historyContext}

用户角色: ${role || '客服'}`;

    // 确定模型
    const model = apiConfig?.model || 'doubao-seed-2-0-lite-260215';

    // 调用 Coze API
    const COZE_API_ENDPOINT = process.env.COZE_API_ENDPOINT || "https://api.coze.cn";
    const API_TOKEN = process.env.COZE_API_TOKEN || "pat_c6nS6NTHKVtdVM2ihTBiAN08yYiI8uSlJnXGH7TSrE4CtaBS2renxkKj3B4MZYor";

    console.log(`[API] 调用模型: ${model}`);

    const response = await fetch(`${COZE_API_ENDPOINT}/v3/chat`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: "system", content: finalSystemPrompt },
          { role: "user", content: message }
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[API Error] ${response.status}: ${errorText}`);
      throw new Error(`API error: ${response.status}`);
    }

    // 流式返回
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              console.log("[Stream] Done");
              break;
            }

            const chunk = decoder.decode(value, { stream: true });
            buffer += chunk;

            // 解析 SSE 事件
            const events = buffer.split('\n\n');
            buffer = events.pop() || '';

            for (const event of events) {
              const lines = event.split('\n');
              let eventData = '';

              for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('data:')) {
                  eventData = trimmed.slice(5).trim();
                }
              }

              if (!eventData || eventData === '[DONE]') continue;

              try {
                const parsed = JSON.parse(eventData);
                
                // 尝试多种格式解析内容
                let content = '';
                
                // 格式1: Coze API 格式
                if (parsed.data?.content) {
                  content = parsed.data.content;
                }
                // 格式2: OpenAI 格式
                else if (parsed.choices?.[0]?.delta?.content) {
                  content = parsed.choices[0].delta.content;
                }
                // 格式3: 直接 content 字段
                else if (parsed.content) {
                  content = parsed.content;
                }
                // 格式4: Coze 流式格式
                else if (parsed.event === 'conversation.message.delta' && parsed.data?.content) {
                  content = parsed.data.content;
                }
                // 格式5: Coze 另一种格式
                else if (parsed.type === 'content' && parsed.content) {
                  content = parsed.content;
                }

                if (content) {
                  // 发送 SSE 格式数据
                  const sseData = `data: ${JSON.stringify({ content })}\n\n`;
                  controller.enqueue(encoder.encode(sseData));
                }
              } catch (e) {
                console.log('[Parse Error]', eventData.substring(0, 100));
              }
            }
          }
          controller.close();
        } catch (error) {
          console.error('[Stream Error]:', error);
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error) {
    console.error("[API Error]:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "处理请求失败" },
      { status: 500 }
    );
  }
}
