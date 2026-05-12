import { NextRequest, NextResponse } from "next/server";
import { LLMClient, Config, HeaderUtils, Message } from "coze-coding-dev-sdk";

// 语言规则映射
const languageRules: Record<string, string> = {
  zh: "所有回复必须使用中文",
  en: "All replies must be in English",
  es: "Todas las respuestas deben estar en español",
  pt: "Todas as respostas devem estar em português",
  ru: "Все ответы должны быть на русском языке",
  vi: "Tất cả các câu trả lời phải bằng tiếng Việt",
  id: "Semua jawaban harus dalam bahasa Indonesia",
  th: "คำตอบทั้งหมดต้องเป็นภาษาไทย",
  ar: "يجب أن تكون جميع الإجابات باللغة العربية",
  ja: "すべての回答は日本語で作成する必要があります",
  ko: "모든 답변은 한국어로 작성해야 합니다",
  mixed: "用户问题中包含多种语言，请使用中文回复",
};

// 默认 System Prompt
const defaultSystemPrompt = `You are a DICloak customer service assistant.

Focus on helping customer service staff quickly generate professional, friendly customer replies.

## Knowledge Base Format
In the knowledge base, terms like {{TERM-XXX}} are already replaced with translated terms. These are placeholders in the original FAQ answers that have been pre-translated. The AI should use them directly without any modification.

## Output Format
When using knowledge base FAQ, must follow this format:
- [Main] -> core answer content
- [Suggestion] -> additional advice (must be on separate line)
- [NeedInfo] -> information needed from user (must be on separate line)

Do NOT put [NeedInfo] inside [Suggestion] content.

## Multi-turn Conversation
- Remember previous conversation context
- If user mentions their role or provides info, use it for targeted advice
- If user asks follow-up, combine with previous context`;

// 计算匹配分数（增强版，支持同义词和模糊匹配）
function calculateMatchScore(userMsg: string, item: { questionCN?: string; questionEN?: string; tags?: string[]; userPhrases?: string }) {
  let score = 0;
  const msgLower = userMsg.toLowerCase();

  // 同义词映射
  const synonyms: Record<string, string[]> = {
    火狐: ['firefox', 'fox', 'mozilla'],
    浏览器: ['browser', 'edge', 'chrome', '360', 'ie', 'opera', 'safari'],
    第三方: ['third', '3rd', 'external'],
    支持: ['support', 'use', 'can i', '是否'],
    内核: ['kernel', 'core', 'engine'],
  };

  // 扩展关键词
  const expandKeywords = (text: string): string[] => {
    const baseKeywords = text.split(/[\s,.!?;:，。！？；：]+/).filter(w => w.length > 1);
    const expanded: string[] = [...baseKeywords];
    baseKeywords.forEach(kw => {
      const kwLower = kw.toLowerCase();
      Object.entries(synonyms).forEach(([, enList]) => {
        if (kwLower.includes(kw) || enList.some(en => kwLower.includes(en))) {
          expanded.push(kw, ...enList);
        }
      });
    });
    return expanded;
  };

  const expandedKeywords = expandKeywords(msgLower);

  // 中文问题匹配
  if (item.questionCN) {
    const cnLower = item.questionCN.toLowerCase();
    if (cnLower.includes(msgLower) || msgLower.includes(cnLower)) {
      score += 15;
    }
    expandedKeywords.forEach(kw => {
      if (cnLower.includes(kw)) score += 3;
    });
    const coreTerms = ['火狐', 'firefox', '浏览器', 'browser', 'chrome', 'edge', '360', '支持', '第三方', '内核'];
    coreTerms.forEach(term => {
      if (msgLower.includes(term) && cnLower.includes(term)) {
        score += 5;
      }
    });
  }

  // 英文问题匹配
  if (item.questionEN) {
    const enLower = item.questionEN.toLowerCase();
    if (enLower.includes(msgLower) || msgLower.includes(enLower)) {
      score += 15;
    }
    expandedKeywords.forEach(kw => {
      if (enLower.includes(kw)) score += 3;
    });
    const browserTerms = ['firefox', 'browser', 'chrome', 'edge', '360', 'microsoft', 'support', 'switch', 'kernel'];
    browserTerms.forEach(term => {
      if (msgLower.includes(term) && enLower.includes(term)) {
        score += 5;
      }
    });
  }

  // 标签匹配
  if (item.tags) {
    item.tags.forEach(tag => {
      if (msgLower.includes(tag.toLowerCase())) score += 4;
    });
  }

  // 多核心词加分
  const coreWords = ['火狐', 'firefox', '浏览器', 'browser', 'chrome', '第三方', '支持', 'diclok'];
  const matchedCoreWords = coreWords.filter(w => msgLower.includes(w.toLowerCase()));
  if (matchedCoreWords.length >= 2) {
    score += 5;
  }

  return score;
}

// 术语翻译映射类型
type TermTranslations = Record<string, Record<string, string>>;

// 术语映射：英文名 -> term_id -> 翻译
type TermNameToTranslation = Record<string, Record<string, string>>;

let termNameTranslations: TermNameToTranslation = {};

// 解析并替换答案中的术语标记 {{termId}} 或 {{英文术语名}}
function replaceTermIds(answer: string, termTranslations: TermTranslations, targetLang: string): string {
  // 匹配 {{xxx}} 格式
  const termPattern = /\{\{([^}]+)\}\}/g;
  
  return answer.replace(termPattern, (match, termKey) => {
    // 优先尝试作为 term_id 查找
    const translations = termTranslations[termKey];
    if (translations) {
      return getTranslationByLang(translations, targetLang);
    }
    
    // 如果不是 term_id，尝试作为英文术语名查找
    const enTranslations = termNameTranslations[termKey];
    if (enTranslations) {
      return getTranslationByLang(enTranslations, targetLang);
    }
    
    // 如果都没找到，返回原始标记（不替换）
    return match;
  });
}

// 根据目标语言获取翻译
function getTranslationByLang(translations: Record<string, string>, targetLang: string): string {
  const langMap: Record<string, string[]> = {
    'zh': ['中文', '中文（简体）'],
    'cn': ['中文', '中文（简体）'],
    'en': ['英文', 'English'],
    'pt': ['葡萄牙语（巴西）'],
    'es': ['西班牙语'],
    'ru': ['俄语'],
    'vi': ['越南语'],
  };
  
  const langKeys = langMap[targetLang] || ['中文', '中文（简体）'];
  
  for (const key of langKeys) {
    if (translations[key]) {
      return translations[key];
    }
  }
  
  // 默认返回中文
  return translations['中文'] || translations['中文（简体）'] || translations['英文'] || Object.values(translations)[0] || '';
}

// 构建术语翻译映射
function buildTermTranslations(knowledge: any): TermTranslations {
  const translations: TermTranslations = {};
  termNameTranslations = {}; // 重置英文名映射
  
  if (knowledge?.termItems) {
    (knowledge.termItems as any[]).forEach(item => {
      const termId = item['term_id'];
      const englishName = item['英文'] || item['English'] || '';
      
      if (termId) {
        translations[termId] = {
          '中文': item['中文'] || '',
          '中文（简体）': item['中文（简体）'] || item['中文'] || '',
          '中文（繁體）': item['中文（繁體）'] || item['中文'] || '',
          '英文': englishName,
          'English': item['English'] || item['英文'] || '',
          '俄语': item['俄语'] || '',
          '葡萄牙语（巴西）': item['葡萄牙语（巴西）'] || '',
          '西班牙语': item['西班牙语'] || '',
          '越南语': item['越南语'] || '',
        };
        
        // 构建英文名到翻译的映射
        if (englishName) {
          termNameTranslations[englishName] = translations[termId];
        }
      }
    });
  }
  
  return translations;
}

// 用指定的 termIds 构建翻译映射（英文名 → 翻译）
function buildTranslationsFromTermIds(termIds: string[], knowledge: any): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  
  if (!knowledge?.termItems) return result;
  
  // 用 termIds 过滤术语库中匹配的项
  (knowledge.termItems as any[]).forEach(item => {
    const termId = item['term_id'];
    const englishName = item['英文'] || item['English'] || '';
    
    // 只包含该 FAQ 的 termIds
    if (termId && termIds.includes(termId)) {
      result[englishName] = {
        '中文': item['中文'] || '',
        '中文（简体）': item['中文（简体）'] || item['中文'] || '',
        '中文（繁體）': item['中文（繁體）'] || item['中文'] || '',
        '英文': englishName,
        'English': item['English'] || item['英文'] || '',
        '俄语': item['俄语'] || '',
        '葡萄牙语（巴西）': item['葡萄牙语（巴西）'] || '',
        '西班牙语': item['西班牙语'] || '',
        '越南语': item['越南语'] || '',
      };
    }
  });
  
  return result;
}

// 知识库来源类型
export interface KnowledgeSource {
  type: 'faq' | 'troubleshooting' | 'out_of_scope';
  id: string;
  question: string;
  score: number;
}

// 构建知识库上下文
function buildKnowledgeContext(knowledge: any, message: string, languageRule: string, targetLang: string): { context: string; sources: KnowledgeSource[] } {
  let knowledgeContext = "";
  const sources: KnowledgeSource[] = [];
  
  // 构建术语翻译映射
  const termTranslations = buildTermTranslations(knowledge);

  if (knowledge && (knowledge.faqItems?.length > 0 || knowledge.troubleshootingItems?.length > 0 || knowledge.outOfScopeItems?.length > 0)) {
    type FaqItem = { questionCN: string; questionEN?: string; tags?: string[]; answer: string; functionId?: string; termIds?: string[]; faqId?: string };
    const faqItems = (knowledge.faqItems || []) as FaqItem[];
    let matchedFaq = faqItems
      .map((item: FaqItem) => ({ item, score: calculateMatchScore(message, item) }))
      .filter(m => m.score >= 3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    // Fallback: 如果没有匹配，尝试找浏览器相关的
    if (matchedFaq.length === 0) {
      const browserKeywords = ['firefox', '浏览器', 'browser', 'chrome', 'edge', '360', '内核', 'kernel', '支持'];
      const msgLower = message.toLowerCase();
      const hasBrowserKeyword = browserKeywords.some(kw => msgLower.includes(kw));

      if (hasBrowserKeyword) {
        matchedFaq = faqItems
          .filter(item => {
            const q = ((item.questionCN || '') + ' ' + (item.questionEN || '')).toLowerCase();
            return browserKeywords.some(kw => q.includes(kw));
          })
          .slice(0, 5)
          .map(item => ({ item, score: 1 }));
      }
    }

    type TsItem = { questionCN: string; questionEN?: string; tags?: string[]; answer: string; termIds?: string[]; faqId?: string };
    const tsItems = (knowledge.troubleshootingItems || []) as TsItem[];
    const matchedTs = tsItems
      .map((item: TsItem) => ({ item, score: calculateMatchScore(message, item) }))
      .filter(m => m.score >= 3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    type OosItem = { questionCN: string; questionEN?: string; answer: string; answerClient?: string; answerEndUser?: string };
    const oosItems = (knowledge.outOfScopeItems || []) as OosItem[];
    const matchedOos = oosItems
      .map((item: OosItem) => ({ item, score: calculateMatchScore(message, item) }))
      .filter(m => m.score >= 3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    // 构建 FAQ 上下文
    if (matchedFaq.length > 0) {
      knowledgeContext += "## FAQ Knowledge Base\n";
      matchedFaq.forEach((m, index) => {
        const item = m.item;
        // 用该 FAQ 自己的 termIds 构建翻译映射
        const faqTermTranslations = buildTranslationsFromTermIds(item.termIds || [], knowledge);
        // 替换答案中的 {{英文术语}} 为实际翻译
        const translatedAnswer = replaceTermIds(item.answer || '', faqTermTranslations, targetLang);
        knowledgeContext += `[FAQ ${index + 1}]\n`;
        knowledgeContext += `Problem: ${item.questionCN || item.questionEN}\n`;
        knowledgeContext += `StandardAnswer: ${translatedAnswer}\n`;
        if (item.termIds && item.termIds.length > 0) {
          knowledgeContext += `RelatedTerms: ${item.termIds.join(', ')}\n`;
        }
        knowledgeContext += "\n";
        sources.push({
          type: 'faq',
          id: item.faqId || `faq-${index}`,
          question: item.questionCN || item.questionEN || '',
          score: m.score,
        });
      });
    }

    // 构建 Troubleshooting 上下文
    if (matchedTs.length > 0) {
      knowledgeContext += "## Troubleshooting Knowledge Base\n";
      matchedTs.forEach((m, index) => {
        const item = m.item;
        // 用该 Troubleshooting 自己的 termIds 构建翻译映射
        const tsTermTranslations = buildTranslationsFromTermIds(item.termIds || [], knowledge);
        // 替换答案中的 {{英文术语}} 为实际翻译
        const translatedAnswer = replaceTermIds(item.answer || '', tsTermTranslations, targetLang);
        knowledgeContext += `[Troubleshoot ${index + 1}]\n`;
        knowledgeContext += `Problem: ${item.questionCN || item.questionEN}\n`;
        knowledgeContext += `StandardAnswer: ${translatedAnswer}\n`;
        if (item.termIds && item.termIds.length > 0) {
          knowledgeContext += `RelatedTerms: ${item.termIds.join(', ')}\n`;
        }
        knowledgeContext += "\n";
        sources.push({
          type: 'troubleshooting',
          id: item.faqId || `ts-${index}`,
          question: item.questionCN || item.questionEN || '',
          score: m.score,
        });
      });
    }

    // 构建 Out of Scope 上下文
    if (matchedOos.length > 0) {
      knowledgeContext += "## Out of Scope Knowledge Base\n";
      matchedOos.forEach((m, index) => {
        const item = m.item;
        knowledgeContext += `[OutOfScope ${index + 1}]\n`;
        knowledgeContext += `Problem: ${item.questionCN || item.questionEN}\n`;
        knowledgeContext += `StandardAnswer: ${item.answer}\n`;
        if (item.answerClient) {
          knowledgeContext += `ClientAnswer: ${item.answerClient}\n`;
        }
        knowledgeContext += "\n";
        sources.push({
          type: 'out_of_scope',
          id: `oos-${index}`,
          question: item.questionCN || item.questionEN || '',
          score: m.score,
        });
      });
    }
  }

  return { context: knowledgeContext, sources };
}

// 构建对话历史上下文
function buildHistoryContext(history: any[]) {
  let historyContext = "";
  if (history && history.length > 0) {
    historyContext = "## Conversation History\n";
    history.forEach((msg: { role: string; content: string }) => {
      if (msg.role === "user") {
        historyContext += `User: ${msg.content}\n`;
      } else if (msg.role === "assistant") {
        const mainMatch = msg.content.match(/\[Main\][\s\S]*?[-–]?[\s]*?([\s\S]+?)(?=\[|$)/);
        if (mainMatch) {
          historyContext += `Assistant: ${mainMatch[1].trim()}\n`;
        }
      }
    });
    historyContext += "\n";
  }
  return historyContext;
}

// Coze 模型调用（直接调用模型，非 Bot）
async function callCozeModel(finalSystemPrompt: string, userMessage: string, model: string) {
  const COZE_API_ENDPOINT = process.env.COZE_API_ENDPOINT || "https://api.coze.cn";
  const API_TOKEN = process.env.COZE_API_TOKEN || "pat_c6nS6NTHKVtdVM2ihTBiAN08yYiI8uSlJnXGH7TSrE4CtaBS2renxkKj3B4MZYor";

  // 默认使用豆包 Lite
  const modelId = model || "doubao-seed-2-0-lite-260215";

  const response = await fetch(`${COZE_API_ENDPOINT}/v3/chat`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: modelId,  // 直接指定模型
      messages: [
        {
          role: "system",
          content: finalSystemPrompt,
        },
        {
          role: "user",
          content: userMessage,
        },
      ],
      stream: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Coze API error: ${response.status}`);
  }

  return response.body;
}

// OpenAI/GPT 调用
async function callOpenAI(finalSystemPrompt: string, userMessage: string, apiKey: string, model: string) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: finalSystemPrompt },
        { role: 'user', content: userMessage },
      ],
      stream: true,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${error}`);
  }

  return response.body;
}

export async function POST(request: NextRequest) {
  try {
    const { message, history, knowledge, systemPrompt, apiConfig, detectedLanguage } = await request.json();

    if (!message) {
      return NextResponse.json({ error: "消息不能为空" }, { status: 400 });
    }

    console.log('[DEBUG] Provider:', apiConfig?.provider || 'coze');
    console.log('[DEBUG] FAQ数量:', knowledge?.faqItems?.length || 0);

    const languageRule = languageRules[detectedLanguage] || languageRules.zh;
    const finalSystemPrompt = systemPrompt || defaultSystemPrompt;

    // 构建上下文
    const { context: knowledgeContext, sources } = buildKnowledgeContext(knowledge, message, languageRule, detectedLanguage);
    const historyContext = buildHistoryContext(history);

    const userMessage = `## Current User Question
${message}

${languageRule}

${knowledgeContext}
${historyContext}
Please generate reply based on the knowledge base above.`;

    // 根据 provider 选择调用方式
    const provider = apiConfig?.provider || 'coze';

    let responseBody: ReadableStream<Uint8Array> | null = null;

    if (provider === 'openai' || provider === 'gpt') {
      const apiKey = apiConfig?.apiKey || process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return NextResponse.json({ error: "OpenAI API Key 未配置" }, { status: 400 });
      }
      responseBody = await callOpenAI(finalSystemPrompt, userMessage, apiKey, apiConfig?.model || 'gpt-4o-mini');
    } else {
      // 使用 Coze 模型（支持切换模型）
      responseBody = await callCozeModel(finalSystemPrompt, userMessage, apiConfig?.model || 'doubao-seed-2-0-lite-260215');
    }

    if (!responseBody) {
      throw new Error("Failed to get response stream");
    }

    // 流式返回
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();
        const reader = responseBody!.getReader();
        let buffer = "";

        // 先发送来源信息
        const sourcesEvent = `event: sources\ndata: ${JSON.stringify(sources)}\n\n`;
        controller.enqueue(encoder.encode(sourcesEvent));

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              controller.close();
              return;
            }

            const chunk = decoder.decode(value, { stream: true });
            buffer += chunk;

            // 按 SSE 格式分割
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith('data: ')) continue;

              const data = trimmed.slice(6);
              if (data === '[DONE]') {
                controller.close();
                return;
              }

              try {
                const parsed = JSON.parse(data);

                let content = '';
                if (provider === 'openai' || provider === 'gpt') {
                  // OpenAI 格式
                  content = parsed.choices?.[0]?.delta?.content || '';
                } else {
                  // Coze 格式
                  content = parsed.data?.content || parsed.content || '';
                }

                if (content) {
                  controller.enqueue(encoder.encode(content));
                }
              } catch (e) {
                // 忽略解析错误
              }
            }
          }
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
