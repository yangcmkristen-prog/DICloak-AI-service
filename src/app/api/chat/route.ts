import { NextRequest, NextResponse } from "next/server";
import { LLMClient, Config, HeaderUtils } from "coze-coding-dev-sdk";
import { getSupabaseClient } from '@/storage/database/supabase-client';

// ==================== 后端获取 API 配置 ====================

async function getBackendApiConfig(): Promise<{
  provider: string;
  apiKey: string;
  model: string;
  baseUrl: string;
} | null> {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('system_configs')
      .select('*')
      .eq('config_key', 'default')
      .maybeSingle();

    if (error || !data?.config_value?.apiConfig) {
      return null;
    }

    return data.config_value.apiConfig;
  } catch (error) {
    console.error('[API Config] 获取后端配置失败:', error);
    return null;
  }
}

// ==================== 问题类型与身份识别 ====================

type ProblemType = 'feature_faq' | 'troubleshooting' | 'user_routing' | 'out_of_scope' | 'info_insufficient' | 'intent_unclear';
type UserRole = 'client' | 'end_user' | 'unknown';

/**
 * 识别问题类型
 */
function identifyProblemType(
  message: string,
  matchedFaqScore: number,
  matchedTsScore: number,
  matchedOosScore: number
): { type: ProblemType; reason: string } {
  const msgLower = message.toLowerCase();
  
  // 1. 检查是否超出支持范围（编程、AI工具、视频制作等）
  const outOfScopeKeywords = ['chatgpt', 'claude', 'midjourney', 'runway', 'freepik', 'canva', '写代码', '编程', 'ai生成', '视频制作', '剪辑', '绘图', '文案生成'];
  if (outOfScopeKeywords.some(kw => msgLower.includes(kw))) {
    return { type: 'out_of_scope', reason: '用户提到的内容不属于 DICloak 功能范围' };
  }
  
  // 2. 检查是否信息不足（描述宽泛）
  const vaguePhrases = ['打不开', '进不去', '有问题', '不工作', '不好用', '报错', 'error', '有问题'];
  const hasVagueOnly = vaguePhrases.some(p => msgLower.includes(p)) && message.length < 20;
  if (hasVagueOnly && matchedFaqScore < 5 && matchedTsScore < 5) {
    return { type: 'info_insufficient', reason: '问题描述过于宽泛，缺少具体信息' };
  }
  
  // 3. 检查是否意图不明确（订阅/套餐相关但未明确用途）
  const subscriptionKeywords = ['订阅', '套餐', '价格', '购买', 'subscription', 'pricing', 'plan'];
  const hasSubscriptionMention = subscriptionKeywords.some(kw => msgLower.includes(kw));
  if (hasSubscriptionMention && matchedFaqScore < 5) {
    return { type: 'intent_unclear', reason: '用户提到订阅/价格但意图不明确' };
  }
  
  // 4. 根据匹配分数判断类型
  if (matchedTsScore >= matchedFaqScore && matchedTsScore >= matchedOosScore && matchedTsScore > 0) {
    return { type: 'troubleshooting', reason: '匹配到故障排查知识库' };
  }
  
  if (matchedOosScore > 0 && matchedOosScore > matchedFaqScore) {
    return { type: 'out_of_scope', reason: '匹配到超出支持范围知识库' };
  }
  
  if (matchedFaqScore > 0) {
    return { type: 'feature_faq', reason: '匹配到功能FAQ知识库' };
  }
  
  // 5. 默认返回信息不足
  return { type: 'info_insufficient', reason: '未匹配到相关知识库' };
}

/**
 * 识别用户身份
 */
function identifyUserRole(message: string, history?: Array<{ role: string; content: string }>): { role: UserRole; reason: string } {
  const allText = (message + ' ' + (history?.map(h => h.content).join(' ') || '')).toLowerCase();
  
  // 终端用户特征
  const endUserIndicators = [
    '账号是别人给的', '账号来自', '第三方', '不是管理员', 
    '服务商', '别人提供的', '管理员给的', '老师给的',
    'account was given', 'from third party', 'not admin'
  ];
  if (endUserIndicators.some(ind => allText.includes(ind))) {
    return { role: 'end_user', reason: '用户提到账号来自第三方或他人' };
  }
  
  // 客户/管理员特征
  const clientIndicators = [
    '我是管理员', '我的团队', '管理成员', '设置环境', 
    '我购买的', '我的套餐', '管理代理', '数据同步',
    'i am admin', 'my team', 'i purchased', 'manage members'
  ];
  if (clientIndicators.some(ind => allText.includes(ind))) {
    return { role: 'client', reason: '用户提到自己是管理员或在进行管理操作' };
  }
  
  return { role: 'unknown', reason: '用户身份不明确' };
}

/**
 * 获取输出格式类型（返回给前端，用于生成格式标题）
 */
function getOutputFormatType(problemType: ProblemType, userRole: UserRole): 'A' | 'B' | 'C' {
  // A. 非故障类问题（feature_faq, out_of_scope, intent_unclear, info_insufficient）
  if (problemType === 'feature_faq' || problemType === 'out_of_scope' || 
      problemType === 'intent_unclear' || problemType === 'info_insufficient') {
    return 'A';
  }
  
  // B. 故障排查 + 身份明确
  if (problemType === 'troubleshooting' && userRole !== 'unknown') {
    return 'B';
  }
  
  // C. 故障排查 + 身份不明确
  return 'C';
}

/**
 * 生成 AI 输出格式要求（AI 只输出内容，不带标题）
 */
function generateAIOutputFormat(problemType: ProblemType, userRole: UserRole): string {
  // A 格式：非故障类问题
  if (problemType === 'feature_faq' || problemType === 'out_of_scope' || 
      problemType === 'intent_unclear' || problemType === 'info_insufficient') {
    return `## 你需要输出的内容

[主回复]
完整输出 FAQ 标准答案的所有内容，不要拆分到其他部分

[补充建议]
独立的补充建议（如有），如无则写"无"

[需要补充的信息]
需要用户提供的信息（如有），如无需则写"无"`;
  }
  
  // B 格式：故障排查 + 身份明确
  if (problemType === 'troubleshooting' && userRole !== 'unknown') {
    const roleAnswer = userRole === 'client' ? 'client' : 'end_user';
    return `## 你需要输出的内容

[主回复]
完整输出 FAQ 中的「标准答案（${roleAnswer}）」，如为空则用「标准答案（通用）」

[补充建议]
独立的补充建议（如有），如无则写"无"

[需要补充的信息]
需要用户提供的信息（如有），如无需则写"无"`;
  }
  
  // C 格式：故障排查 + 身份不明确
  return `## 你需要输出的内容

[通用回复]
完整输出 FAQ 中的「标准答案（通用）」，如为空则写"无"

[客户回复]
完整输出 FAQ 中的「标准答案（client）」，如为空则写"无"

[终端用户回复]
输出「标准答案（end_user）」的简短版，重点说明需联系账号/服务提供方，如为空则写"无"

[需要补充的信息]
生成追问，收集身份相关信息（如：账号是自己管理的还是他人提供的）`;
}

export async function POST(request: NextRequest) {
  try {
    const { message, history, knowledge, systemPrompt, apiConfig, detectedLanguage, aiKeywords } = await request.json();

    if (!message) {
      return NextResponse.json({ error: "消息不能为空" }, { status: 400 });
    }

    // 调试知识库数据
    console.log('[DEBUG] 后端接收语言:', detectedLanguage);
    console.log('[DEBUG] AI 关键词:', aiKeywords);
    if (knowledge) {
      console.log('[DEBUG] FAQ数量:', knowledge.faqItems?.length || 0);
      console.log('[DEBUG] 术语库数量:', knowledge.termItems?.length || 0);
    }

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
    const languageRule = languageRules[detectedLanguage] || languageRules.zh;

    // API 配置
    // 从后端获取 API 配置（安全：API Key 不暴露给前端）
    const backendConfig = await getBackendApiConfig();
    const config = backendConfig || { provider: 'coze', apiKey: '', model: 'doubao-seed-2-0-lite-260215', baseUrl: '' };

    // 精简版 System Prompt（复杂逻辑已由前端/后端处理）
    const baseSystemPrompt = `You are a DICloak customer service assistant.

## Core Rules
1. Generate professional, friendly customer replies
2. Use the FAQ StandardAnswer as the basis for your reply
3. Do NOT expose internal logic (FAQ, knowledge base, matching, etc.)
4. Reply in the same language as the user's question

## FAQ Selection
- Choose the FAQ with HIGHEST Score
- Prefer FAQs with Score >= 10
- Start your reply with [FAQ_ID: xxx] or [TS_ID: xxx]

## Term Translation
- Replace {{UI terms}} with translated terms
- Remove {{}} symbols in output
- For languages not in term library, translate the entire content`;

    // 优先使用前端传递的 System Prompt，否则使用精简版
    const finalSystemPrompt = systemPrompt || baseSystemPrompt;

    // 构建知识库上下文（只传递最相关的知识库项）
    let knowledgeContext = "";

    // 关键词来源：优先使用 AI 提取的关键词，否则使用本地提取
    const extractKeywords = (text: string): string[] => {
      const lower = text.toLowerCase();
      // 分词
      const words = lower.split(/[\s,.!?;:，。！？；：、]+/).filter(w => w.length > 1);
      // 中文提取2-4字子串
      const subs: string[] = [];
      for (let i = 0; i < lower.length - 1; i++) {
        for (let len = 2; len <= 4; len++) {
          if (i + len <= lower.length) {
            const sub = lower.substring(i, i + len);
            if (/^[\u4e00-\u9fa5]+$/.test(sub)) subs.push(sub);
          }
        }
      }
      return [...new Set([...words, ...subs])];
    };
    
    // 使用 AI 提取的英语关键词（已在 /api/keywords 中提取并翻译）
    const userKeywords: string[] = aiKeywords && aiKeywords.length > 0 
      ? aiKeywords.map((k: string) => k.toLowerCase())
      : extractKeywords(message);
    
    console.log('[DEBUG] 使用的关键词（英语）:', userKeywords);

    // 处理术语定位符：提取 [已翻译:原文->译文] 中的译文
    const processTermMarkers = (text: string): string => {
      // 匹配 [已翻译:原文->译文] 格式，只保留译文
      return text.replace(/\[已翻译:[^>]*->([^\]]+)\]/g, '$1');
    };

    // 初始化问题类型和格式（默认值）
    let problemType: ProblemType = 'info_insufficient';
    let userRole: UserRole = 'unknown';
    let outputFormatType: 'A' | 'B' | 'C' = 'A';
    let aiOutputFormat = generateAIOutputFormat(problemType, userRole);

    if (knowledge && (knowledge.faqItems?.length > 0 || knowledge.troubleshootingItems?.length > 0 || knowledge.outOfScopeItems?.length > 0)) {
      // 计算匹配分数（增强标签匹配）
      const calculateMatchScore = (userMsg: string, item: { questionCN?: string; questionEN?: string; tags?: string[]; userPhrases?: string }, keywords: string[]) => {
        let score = 0;
        const msgLower = userMsg.toLowerCase();

        // 1. 问题文本匹配
        if (item.questionCN) {
          const cnLower = item.questionCN.toLowerCase();
          if (cnLower.includes(msgLower) || msgLower.includes(cnLower)) score += 10;
          keywords.forEach(kw => {
            if (cnLower.includes(kw)) score += 2;
          });
        }
        if (item.questionEN) {
          const enLower = item.questionEN.toLowerCase();
          if (enLower.includes(msgLower) || msgLower.includes(enLower)) score += 10;
          keywords.forEach(kw => {
            if (enLower.includes(kw)) score += 2;
          });
        }

        // 2. 标签匹配（关键词与标签匹配）
        if (item.tags && item.tags.length > 0) {
          item.tags.forEach(tag => {
            const tagLower = tag.toLowerCase();
            // 用户消息直接包含标签
            if (msgLower.includes(tagLower)) score += 5;
            // 关键词匹配标签
            keywords.forEach(kw => {
              if (tagLower.includes(kw) || kw.includes(tagLower)) score += 3;
            });
          });
        }

        // 3. 用户问法匹配
        if (item.userPhrases) {
          const phrases = item.userPhrases.split(/[,，;；\n]+/).map(p => p.trim().toLowerCase());
          phrases.forEach(phrase => {
            if (phrase && msgLower.includes(phrase)) score += 4;
          });
        }

        return score;
      };

      // FAQ 匹配过滤（只过滤，不排序，由 AI 判断相关度）
      type FaqItem = { questionCN: string; questionEN?: string; tags?: string[]; userPhrases?: string; answer: string; functionId?: string; termIds?: string[]; faqId?: string };
      const faqItems = (knowledge.faqItems || []) as FaqItem[];
      const matchedFaq = faqItems
        .map((item: FaqItem) => ({ item, score: calculateMatchScore(message, item, userKeywords) }))
        .filter(m => m.score > 0); // 只过滤匹配到的，不排序不限制数量，由 AI 判断相关度

      // Troubleshooting 匹配过滤
      type TsItem = { questionCN: string; questionEN?: string; tags?: string[]; userPhrases?: string; answer: string; termIds?: string[]; faqId?: string };
      const tsItems = (knowledge.troubleshootingItems || []) as TsItem[];
      const matchedTs = tsItems
        .map((item: TsItem) => ({ item, score: calculateMatchScore(message, item, userKeywords) }))
        .filter(m => m.score > 0);

      // Out of Scope 匹配过滤
      type OosItem = { questionCN: string; questionEN?: string; answer: string; answerClient?: string; answerEndUser?: string };
      const oosItems = (knowledge.outOfScopeItems || []) as OosItem[];
      const matchedOos = oosItems
        .map((item: OosItem) => ({ item, score: calculateMatchScore(message, item, userKeywords) }))
        .filter(m => m.score > 0);

      // ==================== 问题类型与身份识别 ====================
      const topFaqScore = matchedFaq.length > 0 ? Math.max(...matchedFaq.map(m => m.score)) : 0;
      const topTsScore = matchedTs.length > 0 ? Math.max(...matchedTs.map(m => m.score)) : 0;
      const topOosScore = matchedOos.length > 0 ? Math.max(...matchedOos.map(m => m.score)) : 0;
      
      const problemTypeResult = identifyProblemType(message, topFaqScore, topTsScore, topOosScore);
      const userRoleResult = identifyUserRole(message, history);
      
      // 更新块外变量
      problemType = problemTypeResult.type;
      userRole = userRoleResult.role;
      outputFormatType = getOutputFormatType(problemType, userRole);
      aiOutputFormat = generateAIOutputFormat(problemType, userRole);
      
      console.log("[TYPE DEBUG] 问题类型:", problemType, "-", problemTypeResult.reason);
      console.log("[TYPE DEBUG] 用户身份:", userRole, "-", userRoleResult.reason);
      console.log("[TYPE DEBUG] 输出格式:", outputFormatType);
      console.log("[TYPE DEBUG] 匹配分数 - FAQ:", topFaqScore, "TS:", topTsScore, "OOS:", topOosScore);

      // 调试日志
      console.log("[MATCH DEBUG] User message:", message);
      console.log("[MATCH DEBUG] User keywords:", userKeywords.slice(0, 10).join(', '));
      console.log("[MATCH DEBUG] Matched FAQ count:", matchedFaq.length);
      matchedFaq.slice(0, 10).forEach((m, i) => {
        console.log(`[MATCH DEBUG] FAQ ${i+1}: ${m.item.faqId}, score: ${m.score}, question: ${m.item.questionCN}, tags: ${m.item.tags?.join(',')}`);
      });
      if (matchedFaq.length > 10) {
        console.log(`[MATCH DEBUG] ... and ${matchedFaq.length - 10} more FAQs`);
      }
      console.log("[MATCH DEBUG] Matched TS count:", matchedTs.length);
      console.log("[MATCH DEBUG] Matched OOS count:", matchedOos.length);

      // 构建 FAQ 上下文
      if (matchedFaq.length > 0) {
        knowledgeContext += "## FAQ Knowledge Base (sorted by relevance score)\n";
        knowledgeContext += "IMPORTANT: You MUST start your reply with [FAQ_ID: xxx] where xxx is the FAQ ID you used.\n";
        knowledgeContext += "HINT: Higher score = more relevant. Prefer FAQs with score >= 10.\n\n";
        matchedFaq.slice(0, 20).forEach((m, index) => {
          const item = m.item;
          // 处理术语定位符
          const processedAnswer = processTermMarkers(item.answer);
          knowledgeContext += `[FAQ ${index + 1}] ID: ${item.faqId || 'unknown'} | Score: ${m.score}\n`;
          knowledgeContext += `Problem: ${item.questionCN || item.questionEN}\n`;
          knowledgeContext += `StandardAnswer: ${processedAnswer}\n`;
          if (item.tags && item.tags.length > 0) {
            knowledgeContext += `Tags: ${item.tags.join(', ')}\n`;
          }
          if (item.functionId) {
            knowledgeContext += `RelatedFunction: ${item.functionId}\n`;
          }
          knowledgeContext += "\n";
        });
      }

      // 构建 Troubleshooting 上下文
      if (matchedTs.length > 0) {
        knowledgeContext += "## Troubleshooting Knowledge Base (sorted by relevance score)\n";
        knowledgeContext += "IMPORTANT: You MUST start your reply with [TS_ID: xxx] where xxx is the FAQ ID you used.\n";
        knowledgeContext += "HINT: Higher score = more relevant. Prefer items with score >= 10.\n\n";
        matchedTs.slice(0, 20).forEach((m, index) => {
          const item = m.item;
          // 处理术语定位符
          const processedAnswer = processTermMarkers(item.answer);
          knowledgeContext += `[TS ${index + 1}] ID: ${item.faqId || 'unknown'} | Score: ${m.score}\n`;
          knowledgeContext += `Problem: ${item.questionCN || item.questionEN}\n`;
          knowledgeContext += `StandardAnswer: ${processedAnswer}\n`;
          if (item.tags && item.tags.length > 0) {
            knowledgeContext += `Tags: ${item.tags.join(', ')}\n`;
          }
          knowledgeContext += "\n";
        });
      }

      // 构建 Out of Scope 上下文
      if (matchedOos.length > 0) {
        knowledgeContext += "## Out of Scope Knowledge Base (for reference)\n";
        matchedOos.forEach((m, index) => {
          const item = m.item;
          knowledgeContext += `[OutOfScope ${index + 1}]\n`;
          knowledgeContext += `Problem: ${item.questionCN || item.questionEN}\n`;
          knowledgeContext += `StandardAnswer: ${item.answer}\n`;
          if (item.answerClient) {
            knowledgeContext += `ClientAnswer: ${item.answerClient}\n`;
          }
          if (item.answerEndUser) {
            knowledgeContext += `EndUserAnswer: ${item.answerEndUser}\n`;
          }
          knowledgeContext += "\n";
        });
      }
    }

    // 构建对话历史上下文
    let historyContext = "";
    if (history && history.length > 0) {
      historyContext = "## Conversation History\n";
      history.forEach((msg: { role: string; content: string }) => {
        if (msg.role === "user") {
          historyContext += `User: ${msg.content}\n`;
        } else if (msg.role === "assistant") {
          // 提取主回复内容
          const mainMatch = msg.content.match(/\[Main\][\s\S]*?[-–]?[\s]*?([\s\S]+?)(?=\[|$)/);
          if (mainMatch) {
            historyContext += `Assistant: ${mainMatch[1].trim()}\n`;
          }
        }
      });
      historyContext += "\n";
    }

    // 构建用户消息
    const userMessage = `## Current User Question
${message}

${languageRule}

${aiOutputFormat}

${knowledgeContext}
${historyContext}
Please generate reply based on the knowledge base above.`;

    // 调试日志：检查知识库上下文是否为空
    console.log("[DEBUG] knowledgeContext 长度:", knowledgeContext.length);
    if (knowledgeContext.length === 0) {
      console.log("[DEBUG] 警告：知识库上下文为空！");
      console.log("[DEBUG] knowledge 对象存在:", !!knowledge);
      console.log("[DEBUG] knowledge.faqItems 数量:", knowledge?.faqItems?.length || 0);
    } else {
      console.log("[DEBUG] 知识库上下文前300字符:", knowledgeContext.substring(0, 300));
    }

    // 构建元数据（前端用于生成格式标题）
    const metaData = JSON.stringify({
      problemType,
      userRole,
      outputFormatType,
      problemTypeLabel: problemType === 'feature_faq' ? '功能咨询' :
                        problemType === 'troubleshooting' ? '故障排查' :
                        problemType === 'out_of_scope' ? '超出支持范围' :
                        problemType === 'intent_unclear' ? '意图不明确' : '信息不足',
      userRoleLabel: userRole === 'client' ? 'DICloak 客户/管理员' :
                     userRole === 'end_user' ? '终端用户' : '身份不明确'
    });

    // 调用 AI API
    const messages = [
      { role: "system" as const, content: finalSystemPrompt },
      { role: "user" as const, content: userMessage },
    ];

    // 检查 API Key
    if (config.provider === 'deepseek' && !config.apiKey) {
      return NextResponse.json({ error: "请先配置 DeepSeek API Key" }, { status: 400 });
    }

    const stream = new ReadableStream({
      async start(controller) {
        try {
          // 首先发送元数据给前端
          controller.enqueue(new TextEncoder().encode(`[META]${metaData}[/META]\n`));
          
          if (config.provider === 'deepseek') {
            // DeepSeek 使用 OpenAI 兼容 API
            const baseUrl = config.baseUrl || 'https://api.deepseek.com/v1';
            const response = await fetch(`${baseUrl}/chat/completions`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`,
              },
              body: JSON.stringify({
                model: config.model || 'deepseek-chat',
                messages: messages.map(m => ({ role: m.role, content: m.content })),
                temperature: 0.7,
                stream: true,
              }),
            });

            if (!response.ok) {
              throw new Error(`DeepSeek API error: ${response.status} ${response.statusText}`);
            }

            const reader = response.body?.getReader();
            if (!reader) throw new Error('No response body');

            const decoder = new TextDecoder();

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              const chunk = decoder.decode(value, { stream: true });
              const lines = chunk.split('\n');

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const data = line.slice(6);
                  if (data === '[DONE]') continue;
                  try {
                    const parsed = JSON.parse(data);
                    const content = parsed.choices?.[0]?.delta?.content || '';
                    if (content) {
                      controller.enqueue(new TextEncoder().encode(content));
                    }
                  } catch {
                    // Ignore parse errors
                  }
                }
              }
            }
          } else {
            // Coze/豆包 使用 SDK
            const llmConfig = new Config({
              apiKey: config.apiKey,
              baseUrl: config.baseUrl || "https://api.coze.cn/v1",
            });

            const client = new LLMClient(llmConfig);
            const llmConfigStream = {
              model: config.model || "doubao-seed-2-0-lite-260215",
              temperature: 0.7,
            };

            for await (const chunk of client.stream(messages, llmConfigStream)) {
              const content = Array.isArray(chunk.content) 
                ? chunk.content.map(c => 'text' in c ? c.text : '').join('')
                : chunk.content;
              if (content) {
                controller.enqueue(new TextEncoder().encode(content));
              }
            }
          }
          controller.close();
        } catch (error) {
          console.error("[Stream Error]:", error);
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
      { error: "处理请求失败" },
      { status: 500 }
    );
  }
}
