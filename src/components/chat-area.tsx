"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Loader2, Copy, Check, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Message } from "@/lib/types";
import { toast } from "sonner";

interface ChatAreaProps {
  messages: Message[];
  onSendMessage: (content: string) => Promise<void>;
  isGenerating: boolean;
}

// 解析 AI 回复，按类型分组
interface ParsedReply {
  type: "question" | "main" | "supplement" | "info";
  content: string;
}

function parseReplies(content: string): ParsedReply[] {
  console.log('[parseReplies] 输入内容长度:', content.length);
  console.log('[parseReplies] 输入内容前200字:', content.substring(0, 200));
  
  const result: ParsedReply[] = [];
  
  // 支持两种格式：带方括号 [主回复] 和不带方括号 主回复
  const sections = [
    // 带方括号格式
    { pattern: /^\[问题类型\]\s*$/i, type: "question" as const },
    { pattern: /^\[主回复\]\s*$/i, type: "main" as const },
    { pattern: /^\[回复1\]\s*$/i, type: "main" as const },
    { pattern: /^\[补充建议\]\s*$/i, type: "supplement" as const },
    { pattern: /^\[需要补充的信息\]\s*$/i, type: "info" as const },
    { pattern: /^\[需补充的信息\]\s*$/i, type: "info" as const },
    { pattern: /^\[回复2\]\s*$/i, type: "supplement" as const },
    { pattern: /^\[回复3\]\s*$/i, type: "info" as const },
    // 不带方括号格式
    { pattern: /^问题类型\s*$/i, type: "question" as const },
    { pattern: /^主回复\s*$/i, type: "main" as const },
    { pattern: /^回复1\s*$/i, type: "main" as const },
    { pattern: /^补充建议\s*$/i, type: "supplement" as const },
    { pattern: /^需要补充的信息\s*$/i, type: "info" as const },
    { pattern: /^需补充的信息\s*$/i, type: "info" as const },
    { pattern: /^回复2\s*$/i, type: "supplement" as const },
    { pattern: /^回复3\s*$/i, type: "info" as const },
  ];

  const lines = content.split("\n");
  
  let currentSection: ParsedReply | null = null;
  let sectionContent: string[] = [];
  let foundMain = false;
  let foundAnySection = false;
  
  for (const line of lines) {
    let matchedSection = false;
    
    for (const { pattern, type } of sections) {
      if (pattern.test(line)) {
        if (currentSection && sectionContent.length > 0) {
          result.push({
            ...currentSection,
            content: sectionContent.join("\n").trim()
          });
        }
        
        // 只保留第一个主回复，忽略后续的
        if (type === "main" && foundMain) {
          currentSection = null;
          sectionContent = [];
          matchedSection = true;
          break;
        }
        
        currentSection = { type, content: "" };
        sectionContent = [];
        foundAnySection = true;
        
        if (type === "main") foundMain = true;
        
        matchedSection = true;
        break;
      }
    }
    
    if (!matchedSection && currentSection) {
      sectionContent.push(line);
    }
  }
  
  if (currentSection && sectionContent.length > 0) {
    result.push({
      ...currentSection,
      content: sectionContent.join("\n").trim()
    });
  }

  // 如果没有找到任何 section 标题，使用 --- 分隔符来分割
  if (!foundAnySection || result.length === 0) {
    console.log('[parseReplies] 进入 fallback 解析, foundAnySection:', foundAnySection, 'result.length:', result.length);
    const parts = content.split(/^---\s*$/m);
    console.log('[parseReplies] --- 分割后 parts 数量:', parts.length);
    console.log('[parseReplies] parts[0] 前100字:', parts[0]?.substring(0, 100));
    
    if (parts.length >= 1) {
      // 第一部分作为主回复
      const mainContent = parts[0].trim();
      if (mainContent) {
        result.push({ type: "main", content: mainContent });
      }
      
      // 第二部分作为补充建议
      if (parts.length >= 2) {
        const suppContent = parts[1].trim();
        // 检查是否包含 "需补充的信息" 或 "需要补充的信息"
        const infoIdx = suppContent.search(/^(需|需要)补充的信息\s*$/m);
        if (infoIdx !== -1) {
          const suppPart = suppContent.substring(0, infoIdx).trim();
          const infoPart = suppContent.substring(infoIdx).replace(/^(需|需要)补充的信息\s*\n?/i, '').trim();
          if (suppPart) result.push({ type: "supplement", content: suppPart });
          if (infoPart) result.push({ type: "info", content: infoPart });
        } else if (suppContent) {
          result.push({ type: "supplement", content: suppContent });
        }
      }
      
      // 第三部分作为需补充的信息
      if (parts.length >= 3) {
        const infoContent = parts[2].trim();
        if (infoContent) {
          result.push({ type: "info", content: infoContent });
        }
      }
    }
  }

  if (result.length === 0) {
    return [{ type: "main", content: content.trim() }];
  }

  console.log('[parseReplies] 最终结果:', result.map(r => ({ type: r.type, contentLen: r.content.length })));
  return result;
}

// 提取纯内容（去除标题）
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

// 渲染回复卡片的组件
function ReplyCard({ 
  reply, 
  index, 
  messageId, 
  onCopy, 
  onTranslate,
  copiedId,
  expandedTranslations,
  translations,
  translatingIds
}: { 
  reply: ParsedReply; 
  index: number;
  messageId: string;
  onCopy: (content: string, id: string) => void;
  onTranslate: (content: string, id: string) => void;
  copiedId: string | null;
  expandedTranslations: Record<string, boolean>;
  translations: Record<string, string>;
  translatingIds: Record<string, boolean>;
}) {
  const pureContent = extractPureContent(reply.content);
  
  if (!pureContent) return null;
  
  const titleMap: Record<string, string> = {
    question: "问题类型",
    main: "主回复",
    supplement: "补充建议",
    info: "需要补充的信息"
  };
  
  const title = titleMap[reply.type] || `回复${index + 1}`;
  const isQuestion = reply.type === "question";
  const translationId = `${messageId}-${reply.type}-${index}`;
  const isExpanded = expandedTranslations[translationId];
  const hasTranslation = !!translations[translationId];
  const isTranslating = translatingIds[translationId];
  
  return (
    <div key={index} className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-600 dark:text-gray-400">
          {title}
        </h4>
        {!isQuestion && (
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-gray-500 hover:text-gray-700 hover:bg-gray-200"
              onClick={() => onTranslate(pureContent, translationId)}
              disabled={isTranslating}
            >
              {isTranslating ? (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              ) : isExpanded ? (
                <ChevronUp className="w-3 h-3 mr-1" />
              ) : (
                <span className="text-xs">译</span>
              )}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-gray-500 hover:text-gray-700 hover:bg-gray-200"
              onClick={() => onCopy(pureContent, translationId)}
            >
              {copiedId === translationId ? (
                <>
                  <Check className="w-3 h-3 mr-1" />
                  <span className="text-xs">已复制</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3 mr-1" />
                  <span className="text-xs">复制</span>
                </>
              )}
            </Button>
          </div>
        )}
      </div>
      <Card className="p-3 hover:border-blue-300 transition-colors">
        <p className="text-sm whitespace-pre-wrap">{pureContent}</p>
        {isExpanded && hasTranslation && (
          <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
            <p className="text-xs text-gray-500 mb-1">中文释义</p>
            <p className="text-sm whitespace-pre-wrap text-gray-700 dark:text-gray-300">
              {translations[translationId]}
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}

// 渲染 AI 回复消息的组件
function AIReplies({ 
  content, 
  messageId,
  onCopy,
  onTranslate,
  copiedId,
  expandedTranslations,
  translations,
  translatingIds
}: { 
  content: string;
  messageId: string;
  onCopy: (content: string, id: string) => void;
  onTranslate: (content: string, id: string) => void;
  copiedId: string | null;
  expandedTranslations: Record<string, boolean>;
  translations: Record<string, string>;
  translatingIds: Record<string, boolean>;
}) {
  const parsed = parseReplies(content);
  
  // 显示顺序：问题类型 -> 主回复 -> 补充建议 -> 需要补充的信息
  const sorted = [...parsed].sort((a, b) => {
    const order = { question: 0, main: 1, supplement: 2, info: 3 };
    return order[a.type] - order[b.type];
  });
  
  // 确保只有一个主回复（忽略多余的[主回复]/[回复1]）
  let mainCount = 0;
  const filtered = sorted.filter(reply => {
    if (reply.type === "main") {
      mainCount++;
      return mainCount <= 1;
    }
    return true;
  });
  
  return (
    <div className="space-y-4">
      {filtered.map((reply, index) => (
        <ReplyCard
          key={index}
          reply={reply}
          index={index}
          messageId={messageId}
          onCopy={onCopy}
          onTranslate={onTranslate}
          copiedId={copiedId}
          expandedTranslations={expandedTranslations}
          translations={translations}
          translatingIds={translatingIds}
        />
      ))}
    </div>
  );
}

export function ChatArea({ messages, onSendMessage, isGenerating }: ChatAreaProps) {
  const [input, setInput] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedTranslations, setExpandedTranslations] = useState<Record<string, boolean>>({});
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [translatingIds, setTranslatingIds] = useState<Record<string, boolean>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 自动滚动到底部
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const handleSend = async () => {
    if (input.trim() && !isGenerating) {
      await onSendMessage(input.trim());
      setInput("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCopy = async (content: string, id: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      toast.success("已复制到剪贴板", { duration: 1500 });
      setTimeout(() => setCopiedId(null), 1500);
    } catch (error) {
      toast.error("复制失败，请手动复制");
    }
  };

  const handleTranslate = async (content: string, id: string) => {
    // 如果已经展开，则收起
    if (expandedTranslations[id]) {
      setExpandedTranslations(prev => ({ ...prev, [id]: false }));
      return;
    }

    // 如果已有翻译结果，直接展开
    if (translations[id]) {
      setExpandedTranslations(prev => ({ ...prev, [id]: true }));
      return;
    }

    // 开始翻译
    setTranslatingIds(prev => ({ ...prev, [id]: true }));
    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: content })
      });

      const data = await response.json();

      if (data.isChinese) {
        toast.info("内容已是中文，无需翻译");
        setTranslatingIds(prev => ({ ...prev, [id]: false }));
        return;
      }

      if (data.translation) {
        setTranslations(prev => ({ ...prev, [id]: data.translation }));
        setExpandedTranslations(prev => ({ ...prev, [id]: true }));
        toast.success("翻译成功");
      } else if (data.error) {
        toast.error(data.error);
      }
    } catch (error) {
      toast.error("翻译失败，请重试");
    } finally {
      setTranslatingIds(prev => ({ ...prev, [id]: false }));
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 消息列表 - 支持滚动 */}
      <div className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <div className="text-center space-y-2">
              <p className="text-lg">DICloak 客服助手</p>
              <p className="text-sm">输入客户问题，AI 将为您生成 3 条推荐回复</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4 max-w-3xl mx-auto">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg p-4 ${
                    message.role === "user"
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 dark:bg-gray-800"
                  }`}
                >
                  {message.role === "user" ? (
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  ) : (
                    <>
                      <AIReplies
                        content={message.content}
                        messageId={message.id}
                        onCopy={handleCopy}
                        onTranslate={handleTranslate}
                        copiedId={copiedId}
                        expandedTranslations={expandedTranslations}
                        translations={translations}
                        translatingIds={translatingIds}
                      />
                      {/* 显示知识库来源 */}
                      {message.sources && message.sources.length > 0 && (
                        <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
                          <p className="text-xs text-muted-foreground mb-2 font-medium">
                            📚 引用来源
                          </p>
                          <div className="space-y-1">
                            {message.sources.map((source, idx) => (
                              <div 
                                key={idx}
                                className="text-xs text-muted-foreground flex items-start gap-2"
                              >
                                <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                  source.type === 'faq' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' :
                                  source.type === 'troubleshooting' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300' :
                                  'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                                }`}>
                                  {source.type === 'faq' ? 'FAQ' : 
                                   source.type === 'troubleshooting' ? '排障' : '超出范围'}
                                </span>
                                <span className="truncate flex-1" title={source.question}>
                                  {source.question}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                  </div>
                </div>
              ))}

            {isGenerating && (
              <div className="flex justify-start">
                <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-4">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">AI 正在生成回复...</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={scrollRef} />
          </div>
        )}
      </div>

      {/* 输入区域 */}
      <div className="border-t p-3 md:p-4 bg-background safe-bottom">
        <div className="flex gap-2 md:gap-3 max-w-3xl mx-auto">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入客户问题..."
            className="min-h-[56px] md:min-h-[60px] max-h-[150px] md:max-h-[120px] resize-none text-base md:text-sm"
            disabled={isGenerating}
          />
          <Button
            size="icon"
            className="h-[56px] w-[56px] md:h-[60px] md:w-[60px] bg-blue-600 hover:bg-blue-700 active:bg-blue-800 shrink-0 touch-manipulation"
            onClick={handleSend}
            disabled={!input.trim() || isGenerating}
          >
            {isGenerating ? (
              <Loader2 className="w-5 h-5 md:w-6 md:h-6" />
            ) : (
              <Send className="w-5 h-5 md:w-6 md:h-6" />
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground text-center mt-2 hidden md:block">
          按 Enter 发送，Shift + Enter 换行
        </p>
      </div>
    </div>
  );
}
