import { NextRequest, NextResponse } from "next/server";
import { LLMClient, Config, HeaderUtils } from "coze-coding-dev-sdk";
import { OutOfScopeItem } from "@/lib/types";

export async function POST(request: NextRequest) {
  try {
    const { message, history, knowledge, systemPrompt, apiConfig, detectedLanguage } = await request.json();

    if (!message) {
      return NextResponse.json({ error: "消息不能为空" }, { status: 400 });
    }

    // 添加调试日志
    console.log('[DEBUG] 后端接收语言:', detectedLanguage);
    console.log('[DEBUG] systemPrompt 长度:', systemPrompt?.length || 0);
    
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
      ja: "すべての回答は日本語で必要があります",
      ko: "모든 답변은 한국어로 작성해야 합니다",
      mixed: "用户问题中包含多种语言，请使用中文回复",
    };
    const languageRule = languageRules[detectedLanguage] || languageRules.zh;
    console.log('[DEBUG] 使用的语言规则:', languageRule);

    // API 配置
    const config = apiConfig || { provider: 'coze', apiKey: '', model: 'doubao-seed-2-0-lite-260215', baseUrl: '' };

    // 优先使用前端传递的 System Prompt，其次使用默认 Prompt
    const defaultPrompt = `你是 DICloak 客服助手，专注于帮助客服人员快速生成专业、友好的客户回复。

## 核心职责
根据客户的问题，从知识库和对话历史中提取关键信息，生成3条不同角度的推荐回复。

## 回复要求
1. **专业性**：使用正式、友好的语气
2. **针对性**：针对客户问题给出具体解决方案
3. **多样性**：3条回复要覆盖不同角度（如解释原因、提供步骤、表达关心等）
4. **简洁性**：每条回复控制在50-150字之间
5. **可操作性**：回复中包含具体的操作指引或解决方案

## 输出格式
请直接输出3条推荐回复，每条之间用换行分隔，不要添加序号或额外说明。`;

    // 获取基础 system prompt，并替换 {{language}} 占位符
    let baseSystemPrompt = systemPrompt || defaultPrompt;
    baseSystemPrompt = baseSystemPrompt.replace(/\{\{language\}\}/g, languageRule);
    
    // 确保语言规则在 system prompt 开头强制执行
    const finalSystemPrompt = `${languageRule}

${baseSystemPrompt}`;

    // 术语库支持的语言列表
    const SUPPORTED_TERM_LANGS = ['zh', 'en', 'es', 'pt', 'ru', 'vi'];
    
    // 术语替换函数：根据术语 ID 和目标语言替换文本中的术语
    function replaceTerms(text: string, termIds: string[], termItems: any[], targetLang: string): string {
      // 如果目标语言不在术语库支持的语言列表中，不进行术语替换，让 AI 自己翻译
      if (!SUPPORTED_TERM_LANGS.includes(targetLang)) {
        return text;
      }
      
      if (!termIds || termIds.length === 0 || !termItems || termItems.length === 0) {
        return text;
      }
      
      let result = text;
      
      for (const termId of termIds) {
        // 在术语库中查找对应的术语
        const term = termItems.find(t => t.id === termId || t.termId === termId || t.术语ID === termId);
        if (!term) continue;
        
        // 如果是英文，不需要替换
        if (targetLang === 'en') {
          continue;
        }
        
        // 获取目标语言的翻译
        let targetTerm = '';
        switch (targetLang) {
          case 'zh':
            targetTerm = term.termCN || term.zh || term['中文'] || '';
            break;
          case 'es':
            targetTerm = term.termES || term.es || term['西班牙语'] || '';
            break;
          case 'pt':
            targetTerm = term.termPT || term.pt || term['葡萄牙语'] || '';
            break;
          case 'ru':
            targetTerm = term.termRU || term.ru || term['俄语'] || '';
            break;
          case 'vi':
            targetTerm = term.termVI || term.vi || term['越南语'] || '';
            break;
          default:
            targetTerm = '';
        }
        
        // 如果没有目标语言翻译，跳过（让 AI 自己翻译）
        if (!targetTerm) {
          targetTerm = term.termEN || term.en || term['英文'] || '';
        }
        
        // 获取英文原文（用于匹配）
        const englishTerm = term.termEN || term.en || term['英文'] || '';
        
        // 如果有英文原文和目标翻译，进行替换，并添加术语标识
        if (englishTerm && targetTerm && englishTerm !== targetTerm) {
          // 使用正则表达式进行精确替换（不区分大小写）
          const regex = new RegExp(englishTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
          // 替换后添加术语标识，让 AI 知道这是已翻译的术语
          result = result.replace(regex, `[已翻译:${englishTerm}→${targetTerm}]`);
        }
      }
      
      return result;
    }

    // 优先使用前端传递的知识库数据
    const knowledgeBase = knowledge || {
      faqItems: [],
      troubleshootingItems: [],
      outOfScopeItems: [],
      mappingItems: [],
      functionKnowledge: [],
      termItems: [],
    };

    // 构建知识库上下文
    let knowledgeContext = "";

    // 添加 FAQ 数据（包含术语替换）
    if (knowledgeBase.faqItems && knowledgeBase.faqItems.length > 0) {
      knowledgeContext += "\n\n## FAQ 知识库\n";
      knowledgeBase.faqItems.forEach((item: { questionCN: string; answer: string; functionId?: string; termIds?: string[] }, index: number) => {
        // 对标准答案进行术语替换
        const termIds = item.termIds || [];
        const replacedAnswer = replaceTerms(item.answer, termIds, knowledgeBase.termItems, detectedLanguage);
        
        knowledgeContext += `【FAQ ${index + 1}】\n`;
        knowledgeContext += `问题: ${item.questionCN}\n`;
        knowledgeContext += `标准答案: ${replacedAnswer}\n`;
        if (item.functionId) knowledgeContext += `关联功能: ${item.functionId}\n`;
        if (termIds && termIds.length > 0) knowledgeContext += `涉及术语: ${termIds.join(', ')}\n`;
        knowledgeContext += "\n";
      });
    }

    // 添加 Troubleshooting 数据（包含术语替换）
    if (knowledgeBase.troubleshootingItems && knowledgeBase.troubleshootingItems.length > 0) {
      knowledgeContext += "\n\n## 排障知识库\n";
      knowledgeBase.troubleshootingItems.forEach((item: { questionCN: string; answer: string; answerClient?: string; answerEndUser?: string; termIds?: string[] }, index: number) => {
        const termIds = item.termIds || [];
        
        knowledgeContext += `【排障 ${index + 1}】\n`;
        knowledgeContext += `问题: ${item.questionCN}\n`;
        knowledgeContext += `通用答案: ${replaceTerms(item.answer, termIds, knowledgeBase.termItems, detectedLanguage)}\n`;
        if (item.answerClient) knowledgeContext += `Client答案: ${replaceTerms(item.answerClient, termIds, knowledgeBase.termItems, detectedLanguage)}\n`;
        if (item.answerEndUser) knowledgeContext += `EndUser答案: ${replaceTerms(item.answerEndUser, termIds, knowledgeBase.termItems, detectedLanguage)}\n`;
        knowledgeContext += "\n";
      });
    }

    // 添加 Out of Scope 数据
    if (knowledgeBase.outOfScopeItems && knowledgeBase.outOfScopeItems.length > 0) {
      knowledgeContext += "\n\n## 超范围问题库\n";
      knowledgeBase.outOfScopeItems.forEach((item: OutOfScopeItem, index: number) => {
        knowledgeContext += `【超范围 ${index + 1}】\n`;
        knowledgeContext += `问题: ${item.questionCN}\n`;
        knowledgeContext += `标准回复: ${replaceTerms(item.answer, item.termIds || [], knowledgeBase.termItems, detectedLanguage)}\n`;
        knowledgeContext += "\n";
      });
    }

    // 添加功能知识库
    if (knowledgeBase.functionKnowledge && knowledgeBase.functionKnowledge.length > 0) {
      knowledgeContext += "\n\n## 功能知识库\n";
      knowledgeBase.functionKnowledge.slice(0, 20).forEach((item: { functionName: string; description: string; entryPath?: string; steps?: string; termIds?: string[] }, index: number) => {
        knowledgeContext += `【功能 ${index + 1}】\n`;
        knowledgeContext += `功能名称: ${item.functionName}\n`;
        knowledgeContext += `功能说明: ${item.description}\n`;
        if (item.entryPath) knowledgeContext += `入口路径: ${item.entryPath}\n`;
        if (item.steps) knowledgeContext += `操作步骤: ${replaceTerms(item.steps, item.termIds || [], knowledgeBase.termItems, detectedLanguage)}\n`;
        knowledgeContext += "\n";
      });
      if (knowledgeBase.functionKnowledge.length > 20) {
        knowledgeContext += `(仅显示前20条，共${knowledgeBase.functionKnowledge.length}条)\n`;
      }
    }

    // 添加术语库（用于 AI 参考，包含所有语言的翻译）
    if (knowledgeBase.termItems && knowledgeBase.termItems.length > 0) {
      knowledgeContext += "\n\n## 术语库\n";
      const visibleTerms = knowledgeBase.termItems.filter((t: { isUiVisible: boolean }) => t.isUiVisible).slice(0, 30);
      visibleTerms.forEach((item: { termId: string; termCN: string; termEN: string; termPT?: string; termES?: string }) => {
        // 构建术语库的完整翻译信息
        const translations: string[] = [];
        translations.push(`EN: ${item.termEN}`);
        translations.push(`CN: ${item.termCN}`);
        if (item.termPT) translations.push(`PT: ${item.termPT}`);
        if (item.termES) translations.push(`ES: ${item.termES}`);
        knowledgeContext += `- ${item.termId}: ${translations.join(', ')}\n`;
      });
      if (knowledgeBase.termItems.length > 30) {
        knowledgeContext += `(仅显示前30条，共${knowledgeBase.termItems.length}条)\n`;
      }
    }

    // 添加映射表
    if (knowledgeBase.mappingItems && knowledgeBase.mappingItems.length > 0) {
      knowledgeContext += "\n\n## 问题分类映射\n";
      knowledgeBase.mappingItems.forEach((item: { category2: string; domainKeywords?: string; keywordsEN?: string }) => {
        if (item.category2) {
          knowledgeContext += `- ${item.category2}: ${item.domainKeywords || item.keywordsEN || ''}\n`;
        }
      });
    }

    // 构建对话历史上下文
    let historyContext = "";
    if (history && history.length > 0) {
      historyContext = "\n\n## 当前对话历史\n";
      history.forEach((msg: { role: string; content: string }) => {
        historyContext += `${msg.role === 'user' ? '客户' : '客服'}: ${msg.content}\n`;
      });
    }

    const fullPrompt = `${languageRule}

客户问题: ${message}${knowledgeContext}${historyContext}

请根据以上知识库信息，生成3条推荐回复。如果问题属于"超范围"类别，请先说明无法支持后再给出适当的建议。`;

    const messages = [
      { role: "system" as const, content: finalSystemPrompt },
      { role: "user" as const, content: fullPrompt },
    ];

    // 根据 provider 选择不同的 API 调用方式
    if (config.provider === 'coze' || !config.apiKey) {
      // 使用 Coze 内置 API
      const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
      const cozeConfig = new Config();
      const client = new LLMClient(cozeConfig, customHeaders);

      const stream = client.stream(messages, {
        model: config.model || "doubao-seed-2-0-lite-260215",
        temperature: 0.7,
      });

      let fullContent = "";
      const encoder = new TextEncoder();

      const readable = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of stream) {
              if (chunk.content && typeof chunk.content === 'string') {
                fullContent += chunk.content;
                controller.enqueue(encoder.encode(chunk.content));
              }
            }
          } catch (error) {
            console.error("Stream error:", error);
          } finally {
            controller.close();
          }
        },
      });

      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    } else if (config.provider === 'custom') {
      // 使用自定义 HTTP API
      if (!config.customConfig?.endpoint) {
        return NextResponse.json(
          { error: "请配置自定义 API 端点" },
          { status: 400 }
        );
      }
      return await handleCustomHTTP(config, messages);
    } else {
      // 使用第三方 API (OpenAI / DeepSeek / Kimi)
      return await handleThirdPartyAPI(config, messages);
    }
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      { error: "生成回复失败，请稍后重试" },
      { status: 500 }
    );
  }
}

// 处理第三方 API 调用
async function handleThirdPartyAPI(
  config: { provider: string; apiKey: string; model: string; baseUrl?: string },
  messages: Array<{ role: string; content: string }>
) {
  const baseUrl = config.baseUrl || getDefaultBaseUrl(config.provider);
  
  const requestBody: Record<string, unknown> = {
    model: config.model,
    messages: messages,
    stream: true,
    temperature: 0.7,
  };

  // DeepSeek R1 需要特殊处理
  if (config.provider === 'deepseek' && config.model.includes('reasoner')) {
    requestBody.model = 'deepseek-reasoner';
    requestBody.temperature = 1;
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Third-party API error:", response.status, errorText);
    return NextResponse.json(
      { error: `API 调用失败: ${response.status} ${errorText}` },
      { status: response.status }
    );
  }

  // 转换 SSE 格式
  const reader = response.body?.getReader();
  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader!.read();
          if (done) break;

          // 解析 SSE 数据
          const text = new TextDecoder().decode(value);
          const lines = text.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') {
                controller.close();
                return;
              }
              try {
                const json = JSON.parse(data);
                const content = json.choices?.[0]?.delta?.content;
                if (content) {
                  controller.enqueue(encoder.encode(content));
                }
              } catch {
                // 忽略解析错误
              }
            }
          }
        }
        controller.close();
      } catch (error) {
        console.error("Stream error:", error);
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// 获取默认 Base URL
function getDefaultBaseUrl(provider: string): string {
  switch (provider) {
    case 'openai':
      return 'https://api.openai.com/v1';
    case 'deepseek':
      return 'https://api.deepseek.com/v1';
    case 'kimi':
      return 'https://api.moonshot.cn/v1';
    default:
      return 'https://api.openai.com/v1';
  }
}

// 处理自定义 HTTP API 调用
async function handleCustomHTTP(
  config: { apiKey: string; customConfig?: { endpoint: string; modelName: string; headers?: Record<string, string> } },
  messages: Array<{ role: string; content: string }>
) {
  const endpoint = config.customConfig?.endpoint;
  const modelName = config.customConfig?.modelName || 'default-model';
  
  if (!endpoint) {
    return NextResponse.json(
      { error: "API 端点未配置" },
      { status: 400 }
    );
  }

  // 构建请求头
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(config.customConfig?.headers || {}),
  };
  
  // 如果没有自定义 Authorization 头，添加 Bearer Token
  if (!headers["Authorization"] && config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  // 构建请求体（OpenAI 兼容格式）
  const requestBody: Record<string, unknown> = {
    model: modelName,
    messages: messages,
    stream: true,
    temperature: 0.7,
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Custom HTTP API error:", response.status, errorText);
      return NextResponse.json(
        { error: `API 调用失败: ${response.status} ${errorText}` },
        { status: response.status }
      );
    }

    // 转换 SSE 格式（处理 OpenAI 兼容格式）
    const reader = response.body?.getReader();
    const encoder = new TextEncoder();

    const readable = new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const { done, value } = await reader!.read();
            if (done) break;

            // 解析 SSE 数据
            const text = new TextDecoder().decode(value);
            const lines = text.split('\n');

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') {
                  controller.close();
                  return;
                }
                try {
                  const json = JSON.parse(data);
                  // 支持多种响应格式
                  const content = 
                    json.choices?.[0]?.delta?.content ||
                    json.choices?.[0]?.text ||
                    json.content;
                  if (content) {
                    controller.enqueue(encoder.encode(content));
                  }
                } catch {
                  // 忽略解析错误
                }
              } else if (line.trim()) {
                // 非 SSE 行，直接发送
                controller.enqueue(encoder.encode(line));
              }
            }
          }
          controller.close();
        } catch (error) {
          console.error("Stream error:", error);
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Custom HTTP error:", error);
    return NextResponse.json(
      { error: `请求失败: ${error instanceof Error ? error.message : '未知错误'}` },
      { status: 500 }
    );
  }
}
