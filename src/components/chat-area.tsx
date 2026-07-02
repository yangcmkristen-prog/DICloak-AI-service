"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { Send, Loader2, Copy, Check, ChevronUp, Plus, X, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { ImageAttachment, Message, generateId } from "@/lib/types";
import { toast } from "sonner";

interface ChatAreaProps {
  messages: Message[];
  onSendMessage: (content: string, attachments?: ImageAttachment[]) => Promise<void>;
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

function normalizeHeaderText(header: string): string {
  return header
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[【】〖〗\[\]{}()（）:：|｜\-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function getSectionType(header: string): ParsedReply["type"] | null {
    const normalizedHeader = normalizeHeaderText(header);

  if (/问题类型|回复类型|tipo de problema|problem type|loai van de|jenis masalah|ประเภทปัญหา|نوع المشكلة|問題タイプ|문제 유형/i.test(normalizedHeader)) return "question";
  if (/身份状态|身份识别|estado de identidad|identity status|trang thai danh tinh|status identitas|สถานะตัวตน|حالة الهوية|本人確認|신원 상태/i.test(normalizedHeader)) return "identity";
  if (/主回复|主要回复|优先发送|回复\s*1|respuesta general|main reply|primary reply|cau tra loi chinh|balasan utama|คำตอบหลัก|الرد الرئيسي|主な返信|주요 답변/i.test(normalizedHeader)) return "main";
  if (/通用回复|respuesta general|general reply|cau tra loi chung|balasan umum|คำตอบทั่วไป|رد عام|一般的な返信|일반 답변/i.test(normalizedHeader)) return "common";
  if (/客户回复|respuesta para cliente|client reply|customer reply|cau tra loi cho khach hang|balasan klien|คำตอบสำหรับลูกค้า|رد العميل|顧客向け返信|고객 답변/i.test(normalizedHeader)) return "client";
  if (/终端用户回复|最终用户回复|respuesta para usuario final|end user reply|final user reply|cau tra loi cho nguoi dung cuoi|balasan pengguna akhir|คำตอบสำหรับผู้ใช้ปลายทาง|رد المستخدم النهائي|エンドユーザー向け返信|최종 사용자 답변/i.test(normalizedHeader)) return "end_user";
  if (/补充建议|补充说明|回复\s*2|sugerencia complementaria|suggestion|supplement|additional advice|goi y bo sung|saran tambahan|ข้อเสนอแนะเพิ่มเติม|اقتراحات اضافية|補足提案|추가 제안/i.test(normalizedHeader)) return "supplement";
  if (/需要补充的信息|需补充信息|回复\s*3|informacion que necesitamos|informacion necesaria|need.*information|additional information|thong tin can bo sung|informasi yang diperlukan|ข้อมูลที่ต้องการเพิ่มเติม|معلومات مطلوبة|必要な追加情報|필요한 추가 정보/i.test(normalizedHeader)) return "info";
  return null;
}

function getSectionTypeFromIcon(icon: string): ParsedReply["type"] | null {
  const iconMap: Record<string, ParsedReply["type"]> = {
    "📌": "question",
    "🛠️": "question",
    "⚠️": "identity",
    "✅": "main",
    "🟡": "common",
    "🔵": "client",
    "🟣": "end_user",
    "💡": "supplement",
    "📝": "info",
    "📎": "info",
  };

  return iconMap[icon] || null;
}

function sanitizeAssistantText(text: string): string {
  return text
    // Remove common markdown emphasis markers while preserving plain text.
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,，。]|$)/g, '$1$2')
    // Unwrap complete DICloak term placeholders: {{Team}} -> Team.
    .replace(/\{\{\s*([^{}]+?)\s*\}\}/g, '$1')
    // Unwrap malformed placeholders occasionally produced by the model: {{Members -> Members.
    .replace(/\{\{\s*([^{}\n]+?)(?=(?:[。！？；;,.，、]|\s|$))/g, '$1')
    .replace(/[{}]/g, '')
    .trim();
}

function parseReplies(content: string, metaData: MetaData | null): ParsedReply[] {
  const result: ParsedReply[] = [];

  // 首先解析 META 数据
  const { metaData: parsedMeta, cleanContent } = parseMetaData(content);
  const finalMeta = parsedMeta || metaData;
  void finalMeta;

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

  /**
   * 直接扫描整段文本中的板块标题，而不是按行判断。
   *
   * 支持：
   * - [主回复]
   * - 【主回复】
   * - 〖主回复〗
   * - ✅【主回复 | 优先发送】
   * - 🛠️【问题类型】
   *
   * 注意：不能使用 (?|...)，JS 正则不支持，会导致 Runtime SyntaxError。
   */
  const sectionHeaderRegex =
    /(?:^|\n)\s*(📌|⚠️|✅|🟡|🔵|🟣|💡|📝|🛠️|👤|☑️|📎)?\s*(?:【|〖|\[)?\s*([^\n【】〖〗\[\]]{1,120}?)\s*(?:】|〗|\])\s*(?=\n|$)/gu;

  const matches = [...cleanContent.matchAll(sectionHeaderRegex)]
    .map((match) => ({
      fullText: match[0],
      index: match.index ?? 0,
      icon: match[1] || "",
      header: match[2] || "",
    }))
    .filter((match) => getSectionType(match.header) || getSectionTypeFromIcon(match.icon));

  if (matches.length === 0) {
    return [{ type: "question", content: cleanContent.trim() }];
  }

  let foundMain = false;

  for (let index = 0; index < matches.length; index++) {
    const match = matches[index];
    const type = getSectionType(match.header) || getSectionTypeFromIcon(match.icon);

    if (!type) continue;

    // 只保留第一个主回复，避免模型重复输出多个主回复卡片
    if (type === "main") {
      if (foundMain) continue;
      foundMain = true;
    }

    const contentStart = match.index + match.fullText.length;
    const nextMatch = matches[index + 1];
    const contentEnd = nextMatch?.index ?? cleanContent.length;
    const sectionText = cleanContent.slice(contentStart, contentEnd).trim();

    if (sectionText) {
      result.push({ type, content: sectionText });
    }
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
    /^\[.*?\]\s*/,
  ];

  for (const pattern of patterns) {
    content = content.replace(pattern, "");
  }

  return sanitizeAssistantText(content);
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // 自动滚动到底部
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);

  const fileToImageAttachment = (file: File): Promise<ImageAttachment> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("图片读取失败"));
        return;
      }
      resolve({
        id: generateId(),
        name: file.name || "clipboard-image.png",
        mimeType: file.type || "image/png",
        dataUrl: reader.result,
      });
    };
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });

  const addImageFiles = async (files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) return;

    try {
      const nextAttachments = await Promise.all(imageFiles.map(fileToImageAttachment));
      setAttachments(prev => [...prev, ...nextAttachments].slice(0, 4));
      toast.success(`已添加 ${nextAttachments.length} 张图片`);
    } catch {
      toast.error("图片读取失败，请重试");
    }
  };

  const handleSend = async () => {
    if ((input.trim() || attachments.length > 0) && !isGenerating) {
      try {
        await onSendMessage(input.trim(), attachments);
        setInput("");
        setAttachments([]);
      } catch {
        // 发送失败时保留输入内容和图片，便于用户重试。
      }
    }
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (files.some((file) => file.type.startsWith("image/"))) {
      void addImageFiles(files);
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
    } catch {
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
    } catch {
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
                    <div className="space-y-3">
                      {message.attachments && message.attachments.length > 0 && (
                        <div className="grid grid-cols-2 gap-2">
                          {message.attachments.map((attachment) => (
                            <Image
                              key={attachment.id}
                              src={attachment.dataUrl}
                              alt={attachment.name}
                              width={160}
                              height={160}
                              unoptimized
                              className="max-h-40 w-auto rounded-md border border-white/30 object-contain"
                            />
                          ))}
                        </div>
                      )}
                      {message.content ? <p className="whitespace-pre-wrap">{message.content}</p> : <p className="text-sm opacity-80">已上传图片</p>}
                    </div>
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
        <div className="max-w-3xl mx-auto space-y-2">
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 rounded-lg border bg-muted/40 p-2">
              {attachments.map((attachment) => (
                <div key={attachment.id} className="relative">
                  <Image
                    src={attachment.dataUrl}
                    alt={attachment.name}
                    width={64}
                    height={64}
                    unoptimized
                    className="h-16 w-16 rounded-md object-cover"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="destructive"
                    className="absolute -right-2 -top-2 h-5 w-5"
                    onClick={() => setAttachments(prev => prev.filter(item => item.id !== attachment.id))}
                    aria-label="移除图片"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2 md:gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => {
                void addImageFiles(Array.from(event.target.files || []));
                event.target.value = "";
              }}
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-[56px] w-[44px] md:h-[60px] md:w-[48px] shrink-0 touch-manipulation"
              onClick={() => fileInputRef.current?.click()}
              disabled={isGenerating}
              aria-label="上传图片"
            >
              <Plus className="w-5 h-5" />
            </Button>
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="输入客户问题，或粘贴截图..."
              className="min-h-[56px] md:min-h-[60px] max-h-[150px] md:max-h-[120px] resize-none text-base md:text-sm"
              disabled={isGenerating}
            />
          <Button
            size="icon"
            className="h-[56px] w-[56px] md:h-[60px] md:w-[60px] bg-blue-600 hover:bg-blue-700 active:bg-blue-800 shrink-0 touch-manipulation"
            onClick={handleSend}
            disabled={(!input.trim() && attachments.length === 0) || isGenerating}
          >
            {isGenerating ? (
              <Loader2 className="w-5 h-5 md:w-6 md:h-6" />
            ) : (
              <Send className="w-5 h-5 md:w-6 md:h-6" />
            )}
          </Button>
        </div>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <ImageIcon className="h-3.5 w-3.5" />
            支持点击加号上传图片，或直接粘贴剪贴板中的截图（最多 4 张）。按 Enter 发送，Shift + Enter 换行。
          </p>
        </div>
      </div>
    </div>
  );
}