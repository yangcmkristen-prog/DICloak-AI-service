"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Loader2, Copy, Check, Tag, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Message } from "@/lib/types";
import { toast } from "sonner";

interface ChatAreaProps {
  messages: Message[];
  onSendMessage: (content: string) => Promise<void>;
  isGenerating: boolean;
}

// 解析 AI 回复内容
interface ParsedReply {
  type: 'question_type' | 'reply';
  label?: string;      // 【问题类型】或【回复1】等
  content: string;     // 具体内容
}

function parseAIResponse(content: string): { questionType: string; replies: { label: string; content: string }[] } {
  let questionType = '通用问题';
  const replies: { label: string; content: string }[] = [];
  
  // 按换行分割
  const lines = content.split('\n');
  
  let currentReply: { label: string; content: string } | null = null;
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // 匹配【问题类型：xxx】或【问题类型】xxx
    const questionTypeMatch = trimmedLine.match(/^【?\s*问题类型\s*】?\s*[:：]?\s*(.+)/);
    if (questionTypeMatch) {
      questionType = questionTypeMatch[1].trim();
      continue;
    }
    
    // 匹配【回复1】xxx 或 【回复 1】xxx 等格式
    const replyMatch = trimmedLine.match(/^【?\s*回复\s*[（(]?\d*[）)]?\s*】?\s*(.+)/);
    if (replyMatch) {
      // 保存之前的回复
      if (currentReply) {
        replies.push(currentReply);
      }
      currentReply = {
        label: `回复${replies.length + 1}`,
        content: replyMatch[1].trim(),
      };
      continue;
    }
    
    // 如果没有匹配到回复标题，且有当前回复在进行中，追加内容
    if (currentReply && !replyMatch) {
      // 检查是否是空行或另一个回复的开始
      if (trimmedLine && !trimmedLine.startsWith('【')) {
        currentReply.content += '\n' + trimmedLine;
      }
    }
  }
  
  // 保存最后一个回复
  if (currentReply) {
    replies.push(currentReply);
  }
  
  // 如果没有解析到任何回复，整个内容作为一个回复
  if (replies.length === 0 && content.trim()) {
    replies.push({
      label: '回复',
      content: content.trim(),
    });
  }
  
  return { questionType, replies };
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

  // 渲染 AI 回复
  const renderAIResponse = (message: Message) => {
    const { questionType, replies } = parseAIResponse(message.content);

    return (
      <div className="space-y-4">
        {/* 问题类型 - 固定展示 */}
        <div className="flex items-center gap-2">
          <Tag className="w-4 h-4 text-blue-600" />
          <span className="text-sm font-medium text-muted-foreground">问题类型：</span>
          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
            {questionType}
          </Badge>
        </div>

        {/* 回复列表 */}
        <div className="space-y-3">
          {replies.map((reply, index) => (
            <Card key={index} className="group hover:border-blue-300 transition-colors">
              {/* 回复标题 - 不在复制范围内 */}
              <CardHeader className="py-2 px-4 bg-gray-50 dark:bg-gray-800/50 border-b">
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                  <MessageSquare className="w-4 h-4" />
                  {reply.label}
                </CardTitle>
              </CardHeader>
              
              {/* 回复内容 - 可复制 */}
              <CardContent className="py-3 px-4 relative">
                <p className="text-sm whitespace-pre-wrap pr-10">
                  {reply.content}
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8 p-0"
                  onClick={() => handleCopy(reply.content, `${message.id}-${index}`)}
                >
                  {copiedId === `${message.id}-${index}` ? (
                    <Check className="w-4 h-4 text-green-600" />
                  ) : (
                    <Copy className="w-4 h-4 text-gray-500" />
                  )}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
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
                    renderAIResponse(message)
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
