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

// 提取纯内容（去除标题）
function extractPureContent(text: string): string {
  // 去除首尾空白
  let content = text.trim();

  // 匹配标题模式：
  // - [回复1]、[回复 1]、[回复1] 等带方括号的
  // - 回复1、回复 1、回复1 等纯文字开头的
  // - 1.、1、 等数字开头的
  const patterns = [
    /^\[回复\s*\d+\]\s*/i,      // [回复1]、[回复 1]、[回复1]
    /^\[回复\d+\]\s*/i,          // [回复1]、[回复1]
    /^回复\s*\d+\s*[:：]?\s*/i,  // 回复1：、回复1:、回复1
    /^\d+\s*[:：.、]\s*/,        // 1.、1:、1、1
    /^\[.*?\]\s*/,               // 其他方括号开头
  ];

  for (const pattern of patterns) {
    content = content.replace(pattern, "");
  }

  return content.trim();
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
                    <div className="space-y-4">
                      {message.content.split("\n\n").filter(Boolean).map((reply, index) => {
                        // 提取纯内容用于显示和复制
                        const pureContent = extractPureContent(reply);
                        // 第一条显示"问题类型"，其余显示"回复1/2/3"
                        const title = index === 0 ? "问题类型" : `回复${index}`;
                        const isFirst = index === 0; // 第一条（问题类型）不显示复制按钮
                        const translationId = `${message.id}-${index}`;
                        const isExpanded = expandedTranslations[translationId];
                        const hasTranslation = !!translations[translationId];
                        const isTranslating = translatingIds[translationId];
                        return (
                          <div key={index} className="space-y-2">
                            {/* 回复标题 */}
                            <div className="flex items-center justify-between">
                              <h4 className="text-sm font-medium text-gray-600 dark:text-gray-400">
                                {title}
                              </h4>
                              {!isFirst && (
                                <div className="flex items-center gap-1">
                                  {/* 翻译按钮 */}
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2 text-gray-500 hover:text-gray-700 hover:bg-gray-200"
                                    onClick={() => handleTranslate(pureContent, translationId)}
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
                                  {/* 复制按钮 */}
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2 text-gray-500 hover:text-gray-700 hover:bg-gray-200"
                                    onClick={() => handleCopy(pureContent, translationId)}
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
                            {/* 回复内容卡片 - 显示纯内容 */}
                            <Card className="p-3 hover:border-blue-300 transition-colors">
                              <p className="text-sm whitespace-pre-wrap">
                                {pureContent}
                              </p>
                              {/* 中文释义 */}
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
                      })}
                    </div>
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
