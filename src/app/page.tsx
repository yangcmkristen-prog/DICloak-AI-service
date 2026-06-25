"use client";

import { useState, useEffect, useCallback } from "react";
import { ArrowRightLeft, Check, Copy, Edit, Languages, Loader2, MessageSquare, Plus, Settings, Trash2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConversationList } from "@/components/conversation-list";
import { ChatArea } from "@/components/chat-area";
import { KnowledgeManager } from "@/components/knowledge-manager";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Conversation, FAQItem, KnowledgeBase, Message, TroubleshootingItem, generateId } from "@/lib/types";
import {
  getConversations,
  saveConversations,
  createConversation,
  deleteConversation as removeConversation,
  updateConversation,
  getCurrentConversationId,
  setCurrentConversationId,
  getKnowledgeBase,
  saveKnowledgeBase,
  getSystemPrompt,
  saveSystemPrompt,
  getApiConfig,
  saveApiConfig,
  detectLanguage,
} from "@/lib/store";
import { toast } from "sonner";

const TRANSLATION_LANGUAGES = [
  { value: "auto", label: "自动检测" },
  { value: "zh", label: "简体中文" },
  { value: "en", label: "英语" },
  { value: "es", label: "西班牙语" },
  { value: "pt", label: "葡萄牙语" },
  { value: "ru", label: "俄语" },
  { value: "vi", label: "越南语" },
  { value: "id", label: "印尼语" },
  { value: "th", label: "泰语" },
  { value: "ar", label: "阿拉伯语" },
  { value: "ja", label: "日语" },
  { value: "ko", label: "韩语" },
];

const TARGET_TRANSLATION_LANGUAGES = TRANSLATION_LANGUAGES.filter((language) => language.value !== "auto");

// 从数据库同步配置到 localStorage
async function syncConfigFromDatabase() {
  try {
    // 同步知识库
    const knowledgeRes = await fetch("/api/config/knowledge");
    const knowledgeData = await knowledgeRes.json();
    if (knowledgeData.success && knowledgeData.data && !knowledgeData.isEmpty) {
      const localKnowledge = await getKnowledgeBase();
      // 如果数据库有数据且 localStorage 为空，则同步
      if (isKnowledgeBaseEmpty(localKnowledge)) {
        saveKnowledgeBase(knowledgeData.data);
      }
    }

    // 同步系统配置
    const systemRes = await fetch("/api/config/system");
    const systemData = await systemRes.json();
    if (systemData.success && systemData.data && !systemData.isEmpty) {
      // 始终同步最新的 system prompt 和 api config（无论 localStorage 是否有数据）
      if (systemData.data.systemPrompt) {
        saveSystemPrompt(systemData.data.systemPrompt);
      }
      if (systemData.data.apiConfig) {
        saveApiConfig(systemData.data.apiConfig);
      }
    }
  } catch (error) {
    console.error("同步配置失败:", error);
  }
}

// 检查知识库是否为空
function isKnowledgeBaseEmpty(kb: Partial<KnowledgeBase> | null | undefined): boolean {
  return !kb || (
    (!kb.faqItems || kb.faqItems.length === 0) &&
    (!kb.troubleshootingItems || kb.troubleshootingItems.length === 0) &&
    (!kb.outOfScopeItems || kb.outOfScopeItems.length === 0) &&
    (!kb.mappingItems || kb.mappingItems.length === 0) &&
    (!kb.functionKnowledge || kb.functionKnowledge.length === 0) &&
    (!kb.termItems || kb.termItems.length === 0)
  );
}

function expandDomainKeywords(keywords: string[], userMessage: string): string[] {
  const text = userMessage.toLowerCase();
  const expanded = new Set(keywords.map((keyword) => keyword.toLowerCase()).filter(Boolean));
  const windowSyncSignals = [
    "дублирование экранов",
    "несколько профилей",
    "разных профилях",
    "одним щелчком",
    "одну и ту же ссылку",
    "одно и тоже действие",
    "одно и то же действие",
    "лайк",
    "multi profile",
    "multiple profiles",
    "same link",
    "same action",
    "simultaneously",
    "同步",
    "多个环境",
    "多个窗口",
    "同一链接",
    "相同操作",
  ];

  if (windowSyncSignals.some((signal) => text.includes(signal))) {
    [
      "window synchronizer",
      "window synchronization",
      "window_synchronizer",
      "multi_profile_control",
      "sync_operations",
      "multiple profiles",
      "same link",
      "same action",
      "simultaneous operation",
      "窗口同步",
      "多环境同步",
      "多窗口同步",
    ].forEach((keyword) => expanded.add(keyword));
  }

  return [...expanded];
}

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[\s_\-]+/g, " ").trim();
}

// 前端用 AI 关键词匹配 FAQ
function matchFaqsByKeywords(knowledge: Partial<KnowledgeBase> | null | undefined, keywords: string[], userMessage: string): { faqs: FAQItem[]; troubleshooting: TroubleshootingItem[] } {
  if (!knowledge) {
    return { faqs: [], troubleshooting: [] };
  }

  const msgLower = userMessage.toLowerCase();
  const normalizedMsg = normalizeForMatch(userMessage);
  const keywordsLower = expandDomainKeywords(keywords, userMessage);
  const normalizedKeywords = keywordsLower.map(normalizeForMatch);

  // 计算匹配分数
  const calculateScore = (item: FAQItem | TroubleshootingItem): number => {
    let score = 0;

    // 1. 关键词匹配标签
    if (item.tags && Array.isArray(item.tags)) {
      item.tags.forEach((tag: string) => {
        const tagLower = tag.toLowerCase();
        const normalizedTag = normalizeForMatch(tag);
        normalizedKeywords.forEach(kw => {
          if (normalizedTag.includes(kw) || kw.includes(normalizedTag)) score += 5;
        });
        // 用户消息直接包含标签
        if (msgLower.includes(tagLower) || normalizedMsg.includes(normalizedTag)) score += 3;
      });
    }

    // 2. 关键词匹配标准问题
    if (item.questionCN) {
      const qLower = item.questionCN.toLowerCase();
      normalizedKeywords.forEach(kw => {
        if (normalizeForMatch(qLower).includes(kw)) score += 4;
      });
    }
    if (item.questionEN) {
      const qLower = item.questionEN.toLowerCase();
      normalizedKeywords.forEach(kw => {
        if (normalizeForMatch(qLower).includes(kw)) score += 4;
      });
    }

    // 3. 关键词匹配用户问法
    if (item.userPhrases) {
      const phrases = item.userPhrases.split(/[,，;；\n]+/).map((p: string) => p.trim().toLowerCase());
      phrases.forEach((phrase: string) => {
        if (phrase && msgLower.includes(phrase)) score += 3;
        normalizedKeywords.forEach(kw => {
          if (normalizeForMatch(phrase).includes(kw)) score += 2;
        });
      });
    }

    const searchableText = normalizeForMatch([
      item.questionCN,
      item.questionEN,
      item.userPhrases,
      ...(item.tags || []),
    ].filter(Boolean).join(" "));
    if (normalizedKeywords.includes("window synchronizer") && searchableText.includes("window synchronizer")) score += 12;
    if (normalizedKeywords.includes("window synchronization") && searchableText.includes("window synchronization")) score += 12;
    if (normalizedKeywords.includes("multi profile control") && searchableText.includes("multi profile control")) score += 8;
    if (normalizedKeywords.includes("sync operations") && searchableText.includes("sync operations")) score += 8;

    return score;
  };

  // 匹配 FAQ
  const faqScores = (knowledge.faqItems || [])
    .map((item) => ({ item, score: calculateScore(item) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score);

  // 匹配 Troubleshooting
  const tsScores = (knowledge.troubleshootingItems || [])
    .map((item) => ({ item, score: calculateScore(item) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score);

  // 取前 20 个
  return {
    faqs: faqScores.slice(0, 20).map((m) => m.item),
    troubleshooting: tsScores.slice(0, 20).map((m) => m.item),
  };
}

export default function Home() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationIdState] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState("chat");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [sourceLanguage, setSourceLanguage] = useState("auto");
  const [targetLanguage, setTargetLanguage] = useState("zh");
  const [translationInput, setTranslationInput] = useState("");
  const [translationResult, setTranslationResult] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [isTranslationCopied, setIsTranslationCopied] = useState(false);

  // 移动端编辑对话框状态
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editConversationName, setEditConversationName] = useState("");

  // 重命名对话
  const handleRenameConversation = useCallback((id: string, newName: string) => {
    if (!newName.trim()) return;
    updateConversation(id, { title: newName.trim() });
    setConversations(getConversations());
    setIsEditDialogOpen(false);
  }, []);

  // 初始化加载数据
  useEffect(() => {
    const loadedConversations = getConversations();
    
    // 如果没有对话，自动创建一个
    if (loadedConversations.length === 0) {
      const newConversation = createConversation();
      setConversations([newConversation]);
      setCurrentConversationIdState(newConversation.id);
      setCurrentConversationId(newConversation.id);
    } else {
      setConversations(loadedConversations);
      const currentId = getCurrentConversationId();
      if (currentId) {
        setCurrentConversationIdState(currentId);
      } else {
        setCurrentConversationIdState(loadedConversations[0].id);
        setCurrentConversationId(loadedConversations[0].id);
      }
    }

    // 从数据库同步配置到 localStorage
    syncConfigFromDatabase();
  }, []);

  // 获取当前对话
  const currentConversation = conversations.find((c) => c.id === currentConversationId);

  // 创建新对话
  const handleCreateConversation = () => {
    const newConversation = createConversation();
    setConversations((prev) => [newConversation, ...prev]);
    setCurrentConversationIdState(newConversation.id);
    setCurrentConversationId(newConversation.id);
    toast.success("新对话已创建");
  };

  // 选择对话
  const handleSelectConversation = (id: string) => {
    setCurrentConversationIdState(id);
    setCurrentConversationId(id);
  };

  // 删除对话
  const handleDeleteConversation = (id: string) => {
    removeConversation(id);
    setConversations((prev) => {
      const updated = prev.filter((c) => c.id !== id);
      if (id === currentConversationId) {
        if (updated.length > 0) {
          setCurrentConversationIdState(updated[0].id);
          setCurrentConversationId(updated[0].id);
        } else {
          setCurrentConversationIdState(null);
          setCurrentConversationId(null);
        }
      }
      return updated;
    });
    toast.success("对话已删除");
  };

  // 发送消息并生成推荐回复
  const handleSendMessage = async (content: string) => {
    if (!currentConversationId) {
      toast.error("请先选择一个对话");
      return;
    }

    // 添加用户消息
    const userMessage: Message = {
      id: generateId(),
      role: "user",
      content,
      timestamp: Date.now(),
    };

    setConversations((prev) => {
      const updated = prev.map((c) => {
        if (c.id === currentConversationId) {
          return { ...c, messages: [...c.messages, userMessage] };
        }
        return c;
      });
      saveConversations(updated);
      return updated;
    });

    setIsGenerating(true);

    try {
      // 直接从数据库获取最新配置，确保切换标签页后数据同步
      const [knowledgeRes, systemRes] = await Promise.all([
        fetch("/api/config/knowledge"),
        fetch("/api/config/system"),
      ]);
      
      // 检查响应是否为 JSON（不是 HTML 或错误页面）
      const knowledgeContentType = knowledgeRes.headers.get('content-type');
      const systemContentType = systemRes.headers.get('content-type');
      const knowledgeDataResult = (!knowledgeContentType || !knowledgeContentType.includes('application/json'))
        ? { success: false, isEmpty: true }
        : await knowledgeRes.json();
      const systemDataResult = (!systemContentType || !systemContentType.includes('application/json'))
        ? { success: false, isEmpty: true }
        : await systemRes.json();
      
      const knowledgeData = knowledgeDataResult.success && !knowledgeDataResult.isEmpty 
        ? knowledgeDataResult.data 
        : getKnowledgeBase();
      const systemPrompt = systemDataResult.success && !systemDataResult.isEmpty && systemDataResult.data.systemPrompt
        ? systemDataResult.data.systemPrompt
        : getSystemPrompt();
      const currentApiConfig = systemDataResult.success && !systemDataResult.isEmpty && systemDataResult.data.apiConfig
        ? systemDataResult.data.apiConfig
        : getApiConfig();

      // Step 1: AI 提取关键词
      console.log('[DEBUG] 正在提取关键词...');
      const keywordsRes = await fetch("/api/keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: content,
          apiConfig: currentApiConfig,
        }),
      });
      
      let aiKeywords: string[] = [];
      let originalKeywords: string[] = [];
      if (keywordsRes.ok) {
        const keywordsData = await keywordsRes.json();
        originalKeywords = keywordsData.originalKeywords || [];
        aiKeywords = keywordsData.englishKeywords || []; // 使用英语关键词匹配
        console.log('[DEBUG] 原始关键词:', originalKeywords);
        console.log('[DEBUG] 英语关键词:', aiKeywords);
      } else {
        console.log('[DEBUG] 关键词提取失败，使用备用方案');
      }

      // Step 2: DeepSeek 前置分类
      let classification: Record<string, unknown> | null = null;
      try {
        const classifyRes = await fetch("/api/classify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: content,
            history: currentConversation?.messages.map((m) => ({
              role: m.role,
              content: m.content,
            })) || [],
          }),
        });
        if (classifyRes.ok) {
          classification = (await classifyRes.json()) as Record<string, unknown>;
          console.log("[DEBUG] 分类结果:", classification);
        }
      } catch (classificationError) {
        console.log("[DEBUG] 分类请求异常，继续使用默认后端逻辑:", classificationError);
      }

      // Step 3: 前端用关键词匹配 FAQ
      const matchedFaqs = matchFaqsByKeywords(knowledgeData, aiKeywords, content);
      console.log('[DEBUG] 匹配到 FAQ 数量:', matchedFaqs.faqs.length);
      console.log('[DEBUG] 匹配到 TS 数量:', matchedFaqs.troubleshooting.length);

      // 构建请求
      const detectedLang = detectLanguage(content);
      console.log('[DEBUG] 检测语言:', detectedLang, '原文:', content);
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: content,
          history: currentConversation?.messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          knowledge: {
            ...knowledgeData,
            // 只传递匹配到的 FAQ，减少传输量
            faqItems: matchedFaqs.faqs.length > 0 ? matchedFaqs.faqs : knowledgeData.faqItems,
            troubleshootingItems: matchedFaqs.troubleshooting.length > 0 ? matchedFaqs.troubleshooting : knowledgeData.troubleshootingItems,
          },
          systemPrompt: systemPrompt,
          apiConfig: currentApiConfig,
          detectedLanguage: detectedLang,
          aiKeywords: aiKeywords, // 传递 AI 提取的关键词给后端
          classification,
        }),
      });

      if (!response.ok) {
        throw new Error("生成回复失败");
      }

      // 处理流式响应
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          fullContent += decoder.decode(value, { stream: true });
        }
      }

      // 添加助手消息
      const assistantMessage: Message = {
        id: generateId(),
        role: "assistant",
        content: fullContent,
        timestamp: Date.now(),
      };

      setConversations((prev) => {
        const updated = prev.map((c) => {
          if (c.id === currentConversationId) {
            return { ...c, messages: [...c.messages, assistantMessage] };
          }
          return c;
        });
        saveConversations(updated);
        return updated;
      });
    } catch (error) {
      console.error("生成回复失败:", error);
      toast.error("生成回复失败，请稍后重试");

      // 移除失败的用户消息
      setConversations((prev) => {
        const updated = prev.map((c) => {
          if (c.id === currentConversationId) {
            return { ...c, messages: c.messages.filter((m) => m.id !== userMessage.id) };
          }
          return c;
        });
        saveConversations(updated);
        return updated;
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleTranslate = async () => {
    const text = translationInput.trim();
    if (!text) {
      toast.error("请输入需要翻译的内容");
      return;
    }

    setIsTranslating(true);
    setIsTranslationCopied(false);

    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          sourceLanguage,
          targetLanguage,
        }),
      });

      const data = await response.json() as { translation?: string; message?: string; error?: string };
      if (!response.ok) {
        throw new Error(data.error || "翻译失败");
      }

      setTranslationResult(data.translation || text);
      toast.success(data.message || "翻译成功");
    } catch (error) {
      console.error("翻译失败:", error);
      toast.error(error instanceof Error ? error.message : "翻译失败，请稍后重试");
    } finally {
      setIsTranslating(false);
    }
  };

  const handleCopyTranslation = async () => {
    if (!translationResult) {
      toast.error("暂无可复制的翻译结果");
      return;
    }

    try {
      await navigator.clipboard.writeText(translationResult);
      setIsTranslationCopied(true);
      toast.success("翻译结果已复制");
      window.setTimeout(() => setIsTranslationCopied(false), 1500);
    } catch (error) {
      console.error("复制失败:", error);
      toast.error("复制失败，请手动复制");
    }
  };

  const handleClearTranslation = () => {
    setTranslationInput("");
    setTranslationResult("");
    setIsTranslationCopied(false);
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* 顶部标题栏 */}
      <header className="border-b px-4 py-3 flex items-center justify-between bg-background">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <MessageSquare className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-xl font-semibold">DICloak 客服助手</h1>
        </div>
        <span className="text-xs text-muted-foreground bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
          内部版
        </span>
      </header>

      {/* 主内容区 */}
      <main className="flex-1 min-h-0 overflow-hidden">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col min-h-0">
          <TabsList className="grid w-full grid-cols-2 rounded-none border-b bg-background h-12 shrink-0 p-0">
            <TabsTrigger
              value="chat"
              className="h-full rounded-none data-[state=active]:bg-blue-50 data-[state=active]:text-blue-600 data-[state=active]:border-b-2 data-[state=active]:border-blue-600"
            >
              <MessageSquare className="w-4 h-4 mr-2" />
              对话助手
            </TabsTrigger>
            <TabsTrigger
              value="translate"
              className="h-full rounded-none data-[state=active]:bg-blue-50 data-[state=active]:text-blue-600 data-[state=active]:border-b-2 data-[state=active]:border-blue-600"
            >
              <Languages className="w-4 h-4 mr-2" />
              翻译
            </TabsTrigger>
          </TabsList>

          <TabsContent value="chat" className="flex-1 min-h-0 m-0">
            <div className="h-full flex min-h-0">
              <aside className="w-72 border-r bg-gray-50/50 dark:bg-gray-900/50 hidden md:flex md:flex-col">
                <div className="flex-1 min-h-0">
                  <ConversationList
                    conversations={conversations}
                    currentConversationId={currentConversationId}
                    onSelectConversation={handleSelectConversation}
                    onCreateConversation={handleCreateConversation}
                    onDeleteConversation={handleDeleteConversation}
                    onRenameConversation={handleRenameConversation}
                  />
                </div>
                <div className="border-t p-3">
                  <Button
                    variant="ghost"
                    className="w-full justify-start text-muted-foreground hover:text-foreground"
                    onClick={() => setIsSettingsOpen(true)}
                  >
                    <Settings className="w-4 h-4 mr-2" />
                    设置
                  </Button>
                </div>
              </aside>

              <section className="flex-1 flex flex-col min-h-0 overflow-hidden">
                {/* 移动端对话选择区域 */}
                <div className="md:hidden p-4 border-b shrink-0 space-y-3">
                  <select
                    value={currentConversationId || ""}
                    onChange={(e) => handleSelectConversation(e.target.value)}
                    className="w-full p-2 border rounded-md bg-background"
                  >
                    <option value="" disabled>
                      选择对话
                    </option>
                    {conversations.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCreateConversation}
                      className="flex-1"
                    >
                      <Plus className="w-4 h-4 mr-1" />
                      新建对话
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (currentConversation) {
                          setEditConversationName(currentConversation.title);
                          setIsEditDialogOpen(true);
                        }
                      }}
                      disabled={!currentConversation}
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (currentConversation && confirm(`确定要删除「${currentConversation.title}」吗？`)) {
                          handleDeleteConversation(currentConversation.id);
                        }
                      }}
                      disabled={!currentConversation}
                      className="text-red-500 hover:text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsSettingsOpen(true)}
                    >
                      <Settings className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                <ChatArea
                  messages={currentConversation?.messages || []}
                  onSendMessage={handleSendMessage}
                  isGenerating={isGenerating}
                />
              </section>
            </div>
          </TabsContent>

          <TabsContent value="translate" className="flex-1 min-h-0 m-0 overflow-y-auto">
            <div className="min-h-full flex flex-col">
              <div className="flex-1 p-4 md:p-6 lg:p-8">
                <div className="mx-auto max-w-5xl space-y-6">
                  <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-end">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">源语言</label>
                      <Select value={sourceLanguage} onValueChange={setSourceLanguage}>
                        <SelectTrigger className="w-full bg-background">
                          <SelectValue placeholder="选择源语言" />
                        </SelectTrigger>
                        <SelectContent>
                          {TRANSLATION_LANGUAGES.map((language) => (
                            <SelectItem key={language.value} value={language.value}>
                              {language.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="hidden md:flex h-9 items-center justify-center text-muted-foreground">
                      <ArrowRightLeft className="w-4 h-4" />
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium">目标语言</label>
                      <Select value={targetLanguage} onValueChange={setTargetLanguage}>
                        <SelectTrigger className="w-full bg-background">
                          <SelectValue placeholder="选择目标语言" />
                        </SelectTrigger>
                        <SelectContent>
                          {TARGET_TRANSLATION_LANGUAGES.map((language) => (
                            <SelectItem key={language.value} value={language.value}>
                              {language.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium">翻译输入</label>
                      <span className="text-xs text-muted-foreground">{translationInput.length} / 5000</span>
                    </div>
                    <Textarea
                      value={translationInput}
                      onChange={(e) => setTranslationInput(e.target.value.slice(0, 5000))}
                      placeholder="请输入要翻译的内容..."
                      className="min-h-40 resize-none bg-background"
                    />
                  </div>

                  <div className="flex justify-center">
                    <Button onClick={handleTranslate} disabled={isTranslating || !translationInput.trim()} className="min-w-32">
                      {isTranslating ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Languages className="w-4 h-4 mr-2" />
                      )}
                      翻译
                    </Button>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <label className="text-sm font-medium">翻译结果</label>
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm" onClick={handleCopyTranslation} disabled={!translationResult}>
                          {isTranslationCopied ? (
                            <Check className="w-4 h-4 mr-1" />
                          ) : (
                            <Copy className="w-4 h-4 mr-1" />
                          )}
                          复制
                        </Button>
                        <Button variant="ghost" size="sm" onClick={handleClearTranslation} disabled={!translationInput && !translationResult}>
                          清空
                        </Button>
                      </div>
                    </div>
                    <div className="min-h-40 rounded-md border bg-background p-3 text-sm whitespace-pre-wrap text-foreground shadow-xs">
                      {translationResult || <span className="text-muted-foreground">翻译结果将显示在这里...</span>}
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-t p-3">
                <Button
                  variant="ghost"
                  className="justify-start text-muted-foreground hover:text-foreground"
                  onClick={() => setIsSettingsOpen(true)}
                >
                  <Settings className="w-4 h-4 mr-2" />
                  设置
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </main>

      {/* 移动端编辑对话框 */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>编辑对话</DialogTitle>
            <DialogDescription>修改对话名称</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={editConversationName}
              onChange={(e) => setEditConversationName(e.target.value)}
              placeholder="输入对话名称"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleRenameConversation(currentConversationId!, editConversationName);
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={() => handleRenameConversation(currentConversationId!, editConversationName)}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>设置</DialogTitle>
            <DialogDescription>管理知识库、Prompt、模型与扩展翻译配置</DialogDescription>
          </DialogHeader>
          <KnowledgeManager />
        </DialogContent>
      </Dialog>
    </div>
  );
}
