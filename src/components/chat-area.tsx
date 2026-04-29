"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Loader2, Copy, Check, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Message } from "@/lib/types";
import { toast } from "sonner";

// 结构化回复格式
interface StructuredReply {
  reply_text: string;
  zh_translation: string;
}

interface ParsedReplies {
  detected_language: string;
  replies: StructuredReply[];
}

// 解析结构化 JSON 回复
function parseStructuredReplies(content: string): ParsedReplies | null {
  try {
    // 尝试提取 JSON（支持多行 JSON）
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.detected_language && Array.isArray(parsed.replies)) {
        // 验证每条回复都有必要字段
        const validReplies = parsed.replies.filter(
          (r: unknown) => typeof r === 'object' && r !== null && 'reply_text' in r
        );
        if (validReplies.length > 0) {
          return {
            detected_language: parsed.detected_language,
            replies: validReplies.map((r: Record<string, unknown>) => ({
              reply_text: String(r.reply_text || ''),
              zh_translation: String(r.zh_translation || ''),
            })),
          };
        }
      }
    }
  } catch {
    // JSON 解析失败，忽略
  }
  return null;
}

// 判断是否需要显示中文翻译（检测是否包含汉字）
function needsTranslation(text: string): boolean {
  // 检查是否包含汉字
  return !/[\u4e00-\u9fa5]/.test(text);
}

interface ChatAreaProps {
  messages: Message[];
  onSendMessage: (content: string) => Promise<void>;
  isGenerating: boolean;
}

export function ChatArea({ messages, onSendMessage, isGenerating }: ChatAreaProps) {
  const [input, setInput] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // 控制中文释义的展开/折叠状态
  const [expandedTranslations, setExpandedTranslations] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 自动滚动到底部
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // 切换翻译展开/折叠
  const toggleTranslation = (id: string) => {
    setExpandedTranslations(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

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

  // 复制回复文本（只复制 reply_text，不复制翻译）
  const handleCopy = async (content: string, id: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      toast.success("已复制到剪贴板", { duration: 1500 });
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      toast.error("复制失败，请手动复制");
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
                  className={`max-w-[85%] rounded-lg p-4 ${
                    message.role === "user"
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 dark:bg-gray-800"
                  }`}
                >
                  {message.role === "user" ? (
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  ) : (
                    <div className="space-y-4">
                      {/* 尝试解析结构化 JSON 回复 */}
                      {(() => {
                        const parsed = parseStructuredReplies(message.content);
                        
                        if (parsed && parsed.replies.length > 0) {
                          // 结构化回复渲染
                          return (
                            <>
                              {parsed.detected_language && (
                                <div className="text-xs text-muted-foreground mb-3">
                                  客户语言：{parsed.detected_language}
                                </div>
                              )}
                              {parsed.replies.map((reply, index) => {
                                const replyId = `${message.id}-reply-${index}`;
                                const isExpanded = expandedTranslations.has(replyId);
                                const showTranslation = needsTranslation(reply.reply_text) && reply.zh_translation;
                                
                                return (
                                  <div key={index} className="space-y-2">
                                    {/* 回复标题 */}
                                    <div className="flex items-center justify-between">
                                      <h4 className="text-sm font-medium text-gray-600 dark:text-gray-400">
                                        推荐回复 {index + 1}
                                      </h4>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 px-2 text-gray-500 hover:text-gray-700 hover:bg-gray-200"
                                        onClick={() => handleCopy(reply.reply_text, replyId)}
                                      >
                                        {copiedId === replyId ? (
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
                                    
                                    {/* 回复内容卡片 */}
                                    <Card className="p-3 hover:border-blue-300 transition-colors">
                                      <p className="text-sm whitespace-pre-wrap leading-relaxed">
                                        {reply.reply_text}
                                      </p>
                                    </Card>
                                    
                                    {/* 中文释义（可折叠） */}
                                    {showTranslation && (
                                      <div className="text-xs">
                                        <button
                                          type="button"
                                          onClick={() => toggleTranslation(replyId)}
                                          className="flex items-center gap-1 text-blue-600 hover:text-blue-700 mb-1"
                                        >
                                          {isExpanded ? (
                                            <ChevronUp className="w-3 h-3" />
                                          ) : (
                                            <ChevronDown className="w-3 h-3" />
                                          )}
                                          <span>中文释义（内部参考）</span>
                                        </button>
                                        {isExpanded && (
                                          <div className="pl-4 py-2 px-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-md text-gray-700 dark:text-gray-300">
                                            {reply.zh_translation}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </>
                          );
                        }
                        
                        // 降级：解析文本格式回复（兼容旧格式）
                        const paragraphs = message.content.split(/\n\n+/).filter(Boolean);
                        if (paragraphs.length === 0) {
                          paragraphs.push(message.content);
                        }
                        
                        return paragraphs.map((reply, index) => (
                          <div key={index} className="space-y-2">
                            <div className="flex items-center justify-between">
                              <h4 className="text-sm font-medium text-gray-600 dark:text-gray-400">
                                回复 {index + 1}
                              </h4>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-gray-500 hover:text-gray-700 hover:bg-gray-200"
                                onClick={() => handleCopy(reply.trim(), `${message.id}-${index}`)}
                              >
                                {copiedId === `${message.id}-${index}` ? (
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
                            <Card className="p-3 hover:border-blue-300 transition-colors">
                              <p className="text-sm whitespace-pre-wrap">
                                {reply.trim()}
                              </p>
                            </Card>
                          </div>
                        ));
                      })()}
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
