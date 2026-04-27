"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Loader2, Copy, Check } from "lucide-react";
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

export function ChatArea({ messages, onSendMessage, isGenerating }: ChatAreaProps) {
  const [input, setInput] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
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
                    <div className="space-y-3">
                      {message.content.split("\n\n").filter(Boolean).map((reply, index) => (
                        <div key={index} className="group">
                          <Card className="p-3 relative hover:border-blue-300 transition-colors">
                            <p className="text-sm whitespace-pre-wrap pr-8">
                              {reply.trim()}
                            </p>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8 p-0"
                              onClick={() => handleCopy(reply.trim(), `${message.id}-${index}`)}
                            >
                              {copiedId === `${message.id}-${index}` ? (
                                <Check className="w-4 h-4 text-green-600" />
                              ) : (
                                <Copy className="w-4 h-4 text-gray-500" />
                              )}
                            </Button>
                          </Card>
                        </div>
                      ))}
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
      <div className="border-t p-4 bg-background">
        <div className="flex gap-2 max-w-3xl mx-auto">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入客户问题..."
            className="min-h-[60px] max-h-[120px] resize-none"
            disabled={isGenerating}
          />
          <Button
            size="icon"
            className="h-[60px] w-[60px] bg-blue-600 hover:bg-blue-700 shrink-0"
            onClick={handleSend}
            disabled={!input.trim() || isGenerating}
          >
            {isGenerating ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground text-center mt-2">
          按 Enter 发送，Shift + Enter 换行
        </p>
      </div>
    </div>
  );
}
