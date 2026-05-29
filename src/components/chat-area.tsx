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

// 元数据类型
interface MetaData {
  problemType: string;
  userRole: string;
  outputFormatType: 'A' | 'B' | 'C';
  problemTypeLabel: string;
  userRoleLabel: string;
}

// 解析 META 数据
function parseMetaData(content: string): { metaData: MetaData | null; cleanContent: string } {
  const metaMatch = content.match(/\[META\]([\s\S]*?)\[\/META\]/);
  if (metaMatch) {
    try {
      const metaData = JSON.parse(metaMatch[1].trim());
      const cleanContent = content.replace(/\[META\][\s\S]*?\[\/META\]/, '').trim();
      return { metaData, cleanContent };
    } catch (e) {
      console.error('[META Parse Error]', e);
    }
  }
  return { metaData: null, cleanContent: content };
}

// 解析 AI 回复，按类型分组
interface ParsedReply {
  type: "question" | "main" | "supplement" | "info" | "common" | "client" | "end_user" | "identity";
  content: string;
}

function parseReplies(content: string, metaData: MetaData | null): ParsedReply[] {
  const result: ParsedReply[] = [];
  
  // 首先解析 META 数据
  const { metaData: parsedMeta, cleanContent } = parseMetaData(content);
  const finalMeta = parsedMeta || metaData;
  
  // 提取并记录 FAQ ID
  const faqIdMatch = cleanContent.match(/\[FAQ_ID:\s*([^\]]+)\]/i);
  if (faqIdMatch) {
    const faqId = faqIdMatch[1].trim();
    console.log(`[FAQ Used] ${faqId}`);
  }
  
  // 提取并记录 function_id
  const functionIdMatch = cleanContent.match(/\[FUNCTION_ID:\s*([^\]]+)\]/i);
  if (functionIdMatch) {
    const functionId = functionIdMatch[1].trim();
    console.log(`[FUNCTION Used] ${functionId}`);
  }

  // 根据格式类型定义不同的解析模式
  const formatType = finalMeta?.outputFormatType || 'A';
  
  // 支持多种格式变体：[问题类型]、📌【问题类型】、【问题类型】等
  const sections = [
    { pattern: /(?:📌\s*)?(?:【|\[)\s*问题类型\s*(?:】|\])/i, type: "question" as const },
    { pattern: /(?:⚠️\s*)?(?:【|\[)\s*身份状态\s*(?:】|\])/i, type: "identity" as const },
    { pattern: /(?:✅\s*)?(?:【|\[)\s*主回复[^】\]]*(?:】|\])/i, type: "main" as const },
    { pattern: /(?:✅\s*)?(?:【|\[)\s*回复1\s*(?:】|\])/i, type: "main" as const },
    { pattern: /(?:🟡\s*)?(?:【|\[)\s*通用回复[^】\]]*(?:】|\])/i, type: "common" as const },
    { pattern: /(?:🔵\s*)?(?:【|\[)\s*客户回复[^】\]]*(?:】|\])/i, type: "client" as const },
    { pattern: /(?:🟣\s*)?(?:【|\[)\s*终端用户回复[^】\]]*(?:】|\])/i, type: "end_user" as const },
    { pattern: /(?:💡\s*)?(?:【|\[)\s*补充建议[^】\]]*(?:】|\])/i, type: "supplement" as const },
    { pattern: /(?:📝\s*)?(?:【|\[)\s*需要补充的信息[^】\]]*(?:】|\])/i, type: "info" as const },
    { pattern: /(?:💡\s*)?(?:【|\[)\s*回复2\s*(?:】|\])/i, type: "supplement" as const },
    { pattern: /(?:📝\s*)?(?:【|\[)\s*回复3\s*(?:】|\])/i, type: "info" as const },
  ];

  // 有些模型会把多个「【问题类型】/【主回复】」标题连续输出在同一行。
  // 先在内联标题前补换行，避免整段内容被当成第一个「问题类型」卡片。
  const inlineHeaderPattern = /([^\n])((?:📌|⚠️|✅|🟡|🔵|🟣|💡|📝)?\s*(?:【|\[)\s*(?:问题类型|身份状态|主回复[^】\]]*|回复1|通用回复[^】\]]*|客户回复[^】\]]*|终端用户回复[^】\]]*|补充建议[^】\]]*|需要补充的信息[^】\]]*|回复2|回复3)\s*(?:】|\]))/g;
  const normalizedContent = cleanContent.replace(inlineHeaderPattern, "$1\n$2");
  const lines = normalizedContent.split("\n");
  
  let currentSection: ParsedReply | null = null;
  let sectionContent: string[] = [];
  let foundMain = false;
  
  for (const line of lines) {
    let matchedSection = false;
    
    for (const { pattern, type } of sections) {
      const headerMatch = line.match(pattern);
      if (headerMatch) {
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
          const headerEndIndex = (headerMatch.index || 0) + headerMatch[0].length;
          const inlineContent = line.slice(headerEndIndex).trim();
          if (inlineContent) {
            sectionContent.push(inlineContent);
          }
          matchedSection = true;
          break;
        }
        
        currentSection = { type, content: "" };
        sectionContent = [];
        
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

  if (result.length === 0) {
    return [{ type: "question", content: cleanContent.trim() }];
  }

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
  translatingIds,
  metaData
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
  metaData?: MetaData | null;
}) {
  const pureContent = extractPureContent(reply.content);
  
  if (!pureContent) return null;
  
  // 根据格式类型生成标题（带图标和说明）
  const titleConfig: Record<string, { icon: string; label: string; hint?: string }> = {
    question: { icon: "📌", label: "问题类型" },
    identity: { icon: "⚠️", label: "身份状态" },
    main: { icon: "✅", label: "主回复", hint: "优先发送" },
    common: { icon: "🟡", label: "通用回复", hint: "身份不明确时优先发送" },
    client: { icon: "🔵", label: "客户回复", hint: "适用于 DICloak 客户/管理员" },
    end_user: { icon: "🟣", label: "终端用户回复", hint: "适用于账号由他人提供的用户" },
    supplement: { icon: "💡", label: "补充建议", hint: "可选发送" },
    info: { icon: "📝", label: "需要补充的信息" }
  };
  
  const config = titleConfig[reply.type] || { icon: "💬", label: `回复${index + 1}` };
  const title = config.hint ? `${config.label} | ${config.hint}` : config.label;
  const isQuestion = reply.type === "question" || reply.type === "identity";
  const translationId = `${messageId}-${reply.type}-${index}`;
  const isExpanded = expandedTranslations[translationId];
  const hasTranslation = !!translations[translationId];
  const isTranslating = translatingIds[translationId];
  
  return (
    <div key={index} className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-600 dark:text-gray-400 flex items-center gap-1.5">
          <span>{config.icon}</span>
          <span>{config.label}</span>
          {config.hint && <span className="text-xs text-gray-400 dark:text-gray-500">| {config.hint}</span>}
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
  // 首先解析 META 数据
  const { metaData, cleanContent } = parseMetaData(content);
  
  // 输出 META 信息到控制台
  if (metaData) {
    console.log('[META] 问题类型:', metaData.problemTypeLabel);
    console.log('[META] 用户身份:', metaData.userRoleLabel);
    console.log('[META] 输出格式:', metaData.outputFormatType);
  }
  
  const parsed = parseReplies(cleanContent, metaData);
  
  // 根据格式类型排序（使用 ?? 而不是 ||，因为 0 是有效值）
  const sorted = [...parsed].sort((a, b) => {
    const order: Record<string, number> = { 
      question: 0, 
      identity: 1,
      main: 2, 
      common: 2,
      client: 3,
      end_user: 4,
      supplement: 5, 
      info: 6 
    };
    return (order[a.type] ?? 99) - (order[b.type] ?? 99);
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
          metaData={metaData}
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
