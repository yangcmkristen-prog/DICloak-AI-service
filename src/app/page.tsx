"use client";

import { useState, useEffect, useCallback } from "react";
import type { DragEvent } from "react";
import { Archive, ArrowRightLeft, Check, ChevronRight, Copy, Edit, Folder, GripVertical, Languages, Loader2, MessageSquare, Plus, Search, Settings, Trash2 } from "lucide-react";
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
  { value: "pt-BR", label: "葡萄牙语（巴西）" },
  { value: "pt-PT", label: "葡萄牙语（欧洲）" },
  { value: "ru", label: "俄语" },
  { value: "vi", label: "越南语" },
  { value: "id", label: "印尼语" },
  { value: "th", label: "泰语" },
  { value: "ar", label: "阿拉伯语" },
  { value: "ja", label: "日语" },
  { value: "ko", label: "韩语" },
];

const TARGET_TRANSLATION_LANGUAGES = TRANSLATION_LANGUAGES.filter((language) => language.value !== "auto");
const PHRASE_TRANSLATION_LANGUAGES = [
  { value: "zh", label: "中文" },
  { value: "en", label: "英文" },
  { value: "pt-BR", label: "葡萄牙语" },
  { value: "es", label: "西班牙语" },
  { value: "ru", label: "俄语" },
  { value: "vi", label: "越南语" },
] as const;
const SAVED_PHRASES_STORAGE_KEY = "diclok_saved_phrases";

type PhraseLanguage = typeof PHRASE_TRANSLATION_LANGUAGES[number]["value"];
type SavedPhraseFolder = { id: string; name: string };
type SavedPhrase = { id: string; name: string; sourceText: string; folderId: string | null; translations: Record<PhraseLanguage, string>; createdAt: number };
type SavedPhraseState = { folders: SavedPhraseFolder[]; phrases: SavedPhrase[] };
type SavedPhraseDragItem = { type: "phrase" | "folder"; id: string };

const getTranslationLanguageLabel = (value: string | null) => TRANSLATION_LANGUAGES.find((language) => language.value === value)?.label || value || "未知语言";

function createEmptyPhraseTranslations(): Record<PhraseLanguage, string> {
  return PHRASE_TRANSLATION_LANGUAGES.reduce((result, language) => {
    result[language.value] = "";
    return result;
  }, {} as Record<PhraseLanguage, string>);
}

function getSavedPhraseState(): SavedPhraseState {
  if (typeof window === "undefined") return { folders: [], phrases: [] };

  try {
    const raw = window.localStorage.getItem(SAVED_PHRASES_STORAGE_KEY);
    if (!raw) return { folders: [], phrases: [] };
    const parsed = JSON.parse(raw) as Partial<SavedPhraseState>;
    return {
      folders: Array.isArray(parsed.folders) ? parsed.folders : [],
      phrases: Array.isArray(parsed.phrases) ? parsed.phrases : [],
    };
  } catch (error) {
    console.error("读取收纳话术失败:", error);
    return { folders: [], phrases: [] };
  }
}

function saveSavedPhraseState(state: SavedPhraseState) {
  window.localStorage.setItem(SAVED_PHRASES_STORAGE_KEY, JSON.stringify(state));
}

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

  const accountSharingSignals = [
    "раздать",
    "подписк",
    "команда",
    "команде",
    "доступ",
    "поделиться",
    "share account",
    "account sharing",
    "shared account",
    "team share",
    "team access",
    "shared subscription",
    "platform account",
    "tool account",
    "compartir cuenta",
    "cuenta compartida",
    "equipo",
    "suscripción",
    "compartilhar conta",
    "conta compartilhada",
    "equipe",
    "assinatura",
    "chia sẻ tài khoản",
    "nhóm",
    "đăng ký",
    "berbagi akun",
    "akun bersama",
    "tim",
    "langganan",
    "บัญชี",
    "ทีม",
    "اشتراك",
    "حساب",
    "فريق",
    "アカウント共有",
    "チーム",
    "サブスクリプション",
    "계정 공유",
    "팀",
    "구독",
    "账号共享",
    "共享账号",
    "分享账号",
    "团队共享",
    "分发账号",
  ];

  if (accountSharingSignals.some((signal) => text.includes(signal))) {
    [
      "account_sharing",
      "shared_account",
      "multi_open_mode",
      "team_collaboration",
      "member_account",
      "setting",
      "share account",
      "shared account",
      "platform account",
      "tool account",
      "team share",
      "account sharing",
      "multi-open mode",
      "member account",
      "data sync",
      "账号共享",
      "共享账号",
      "团队协作",
      "成员账号",
      "多开模式",
      "数据同步",
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

type PhraseListItemProps = {
  phrase: SavedPhrase;
  editingPhraseId: string | null;
  editingPhraseName: string;
  onOpen: (phrase: SavedPhrase) => void;
  onStartEdit: (phrase: SavedPhrase) => void;
  onChangeEditName: (name: string) => void;
  onSaveEdit: (phraseId: string) => void;
  onDelete: (phraseId: string) => void;
  isDragging: boolean;
  onDragStart: (event: DragEvent<HTMLDivElement>, phrase: SavedPhrase) => void;
  onDragEnd: () => void;
  onDropOnPhrase: (event: DragEvent<HTMLDivElement>, phrase: SavedPhrase) => void;
};

function PhraseListItem({ phrase, editingPhraseId, editingPhraseName, onOpen, onStartEdit, onChangeEditName, onSaveEdit, onDelete, isDragging, onDragStart, onDragEnd, onDropOnPhrase }: PhraseListItemProps) {
  const isEditing = editingPhraseId === phrase.id;

  if (isEditing) {
    return (
      <div className="flex items-center gap-1">
        <Input
          value={editingPhraseName}
          onChange={(event) => onChangeEditName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSaveEdit(phrase.id);
            if (event.key === "Escape") onChangeEditName(phrase.name);
          }}
          className="h-8 min-w-0 text-sm"
          autoFocus
        />
        <Button size="sm" variant="ghost" onClick={() => onSaveEdit(phrase.id)}>保存</Button>
      </div>
    );
  }

  return (
    <div
      className={`group flex min-w-0 items-center gap-1 rounded-md hover:bg-muted ${isDragging ? "opacity-50 ring-1 ring-primary" : ""}`}
      draggable
      onDragStart={(event) => onDragStart(event, phrase)}
      onDragEnd={onDragEnd}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => onDropOnPhrase(event, phrase)}
    >
      <GripVertical className="ml-1 h-4 w-4 shrink-0 cursor-grab text-muted-foreground opacity-60 group-hover:opacity-100" aria-hidden="true" />
      <button type="button" onClick={() => onOpen(phrase)} className="min-w-0 flex-1 truncate px-3 py-2 text-left text-sm">
        {phrase.name}
      </button>
      <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 opacity-70 group-hover:opacity-100" onClick={() => onStartEdit(phrase)} aria-label="修改话术名称">
        <Edit className="h-3.5 w-3.5" />
      </Button>
      <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-red-500 opacity-70 hover:text-red-600 group-hover:opacity-100" onClick={() => onDelete(phrase.id)} aria-label="删除话术">
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
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
  const [detectedSourceLanguage, setDetectedSourceLanguage] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [isTranslationCopied, setIsTranslationCopied] = useState(false);
  const [savedPhraseState, setSavedPhraseState] = useState<SavedPhraseState>({ folders: [], phrases: [] });
  const [expandedFolderIds, setExpandedFolderIds] = useState<string[]>([]);
  const [phraseSearch, setPhraseSearch] = useState("");
  const [isSavePhraseDialogOpen, setIsSavePhraseDialogOpen] = useState(false);
  const [selectedFolderIdForSave, setSelectedFolderIdForSave] = useState("root");
  const [isSavingPhrase, setIsSavingPhrase] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [editingPhraseId, setEditingPhraseId] = useState<string | null>(null);
  const [editingPhraseName, setEditingPhraseName] = useState("");
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState("");
  const [selectedPhrase, setSelectedPhrase] = useState<SavedPhrase | null>(null);
  const [copiedSavedPhraseLanguage, setCopiedSavedPhraseLanguage] = useState<PhraseLanguage | null>(null);
  const [savedPhraseDragItem, setSavedPhraseDragItem] = useState<SavedPhraseDragItem | null>(null);
  const [isSavedPhraseSyncing, setIsSavedPhraseSyncing] = useState(false);

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
    
    void loadSavedPhraseState();

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

      const data = await response.json() as { translation?: string; message?: string; error?: string; detectedSourceLanguage?: string | null };
      if (!response.ok) {
        throw new Error(data.error || "翻译失败");
      }

      setTranslationResult(data.translation || text);
      setDetectedSourceLanguage(data.detectedSourceLanguage || null);
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
    setDetectedSourceLanguage(null);
    setIsTranslationCopied(false);
  };

  const handleSwapTranslationLanguages = () => {
    const resolvedSourceLanguage = sourceLanguage === "auto" ? detectedSourceLanguage : sourceLanguage;

    if (!resolvedSourceLanguage) {
      toast.info("自动检测源语言后再交换语言");
      return;
    }

    setSourceLanguage(targetLanguage);
    setTargetLanguage(resolvedSourceLanguage);
    setDetectedSourceLanguage(null);
  };

  const loadSavedPhraseState = async () => {
    const localState = getSavedPhraseState();
    setSavedPhraseState(localState);
    setIsSavedPhraseSyncing(true);

    try {
      const response = await fetch("/api/saved-phrases", { cache: "no-store" });
      const data = await response.json() as { success?: boolean; data?: SavedPhraseState; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error || "获取收纳话术失败");

      const remoteState = data.data || { folders: [], phrases: [] };
      setSavedPhraseState(remoteState);
      saveSavedPhraseState(remoteState);
    } catch (error) {
      console.error("同步收纳话术失败:", error);
      if (localState.phrases.length > 0 || localState.folders.length > 0) {
        toast.warning("收纳话术云端同步失败，已显示本机缓存");
      }
    } finally {
      setIsSavedPhraseSyncing(false);
    }
  };

  const persistSavedPhraseState = async (nextState: SavedPhraseState) => {
    setSavedPhraseState(nextState);
    saveSavedPhraseState(nextState);
    setIsSavedPhraseSyncing(true);

    try {
      const response = await fetch("/api/saved-phrases", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: nextState }),
      });
      const data = await response.json() as { success?: boolean; data?: SavedPhraseState; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error || "保存收纳话术失败");

      const remoteState = data.data || nextState;
      setSavedPhraseState(remoteState);
      saveSavedPhraseState(remoteState);
    } catch (error) {
      console.error("保存收纳话术到云端失败:", error);
      toast.error(error instanceof Error ? error.message : "云端同步失败，请稍后重试");
    } finally {
      setIsSavedPhraseSyncing(false);
    }
  };

  const handleAddPhraseFolder = () => {
    const name = newFolderName.trim();
    if (!name) {
      toast.error("请输入文件夹名称");
      return;
    }
    const nextState = {
      ...savedPhraseState,
      folders: [...savedPhraseState.folders, { id: generateId(), name }],
    };
    void persistSavedPhraseState(nextState);
    setNewFolderName("");
    toast.success("文件夹已添加");
  };

  const handleSavePhrase = async () => {
    const text = translationInput.trim();
    if (!text || !translationResult) {
      toast.error("请先完成翻译后再收纳话术");
      return;
    }

    setIsSavingPhrase(true);
    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          sourceLanguage,
          targetLanguages: PHRASE_TRANSLATION_LANGUAGES.map((language) => language.value),
        }),
      });
      const data = await response.json() as { translations?: Partial<Record<PhraseLanguage, string>>; error?: string };
      if (!response.ok) throw new Error(data.error || "收纳话术翻译失败");

      const translations = createEmptyPhraseTranslations();
      PHRASE_TRANSLATION_LANGUAGES.forEach((language) => {
        translations[language.value] = data.translations?.[language.value] || text;
      });

      const phrase: SavedPhrase = {
        id: generateId(),
        name: text,
        sourceText: text,
        folderId: selectedFolderIdForSave === "root" ? null : selectedFolderIdForSave,
        translations,
        createdAt: Date.now(),
      };
      await persistSavedPhraseState({ ...savedPhraseState, phrases: [phrase, ...savedPhraseState.phrases] });
      setIsSavePhraseDialogOpen(false);
      setSelectedFolderIdForSave("root");
      toast.success("话术已收纳");
    } catch (error) {
      console.error("收纳话术失败:", error);
      toast.error(error instanceof Error ? error.message : "收纳话术失败，请稍后重试");
    } finally {
      setIsSavingPhrase(false);
    }
  };

  const handleRenamePhrase = (phraseId: string) => {
    const name = editingPhraseName.trim();
    if (!name) return;
    void persistSavedPhraseState({
      ...savedPhraseState,
      phrases: savedPhraseState.phrases.map((phrase) => phrase.id === phraseId ? { ...phrase, name } : phrase),
    });
    setEditingPhraseId(null);
    setEditingPhraseName("");
    toast.success("话术名称已更新");
  };

  const handleRenameFolder = (folderId: string) => {
    const name = editingFolderName.trim();
    if (!name) return;
    void persistSavedPhraseState({
      ...savedPhraseState,
      folders: savedPhraseState.folders.map((folder) => folder.id === folderId ? { ...folder, name } : folder),
    });
    setEditingFolderId(null);
    setEditingFolderName("");
    toast.success("文件夹名称已更新");
  };

  const handleMovePhrase = (phraseId: string, folderValue: string) => {
    const nextFolderId = folderValue === "root" ? null : folderValue;
    const nextState = {
      ...savedPhraseState,
      phrases: savedPhraseState.phrases.map((phrase) => phrase.id === phraseId ? { ...phrase, folderId: nextFolderId } : phrase),
    };
    void persistSavedPhraseState(nextState);
    if (selectedPhrase?.id === phraseId) {
      setSelectedPhrase((phrase) => phrase ? { ...phrase, folderId: nextFolderId } : phrase);
    }
    if (nextFolderId && !expandedFolderIds.includes(nextFolderId)) {
      setExpandedFolderIds((prev) => [...prev, nextFolderId]);
    }
    toast.success("话术所属文件夹已更新");
  };

  const handleSavedPhraseDragStart = (event: DragEvent<HTMLDivElement>, item: SavedPhraseDragItem) => {
    setSavedPhraseDragItem(item);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `${item.type}:${item.id}`);
  };

  const handleSavedPhraseDragEnd = () => {
    setSavedPhraseDragItem(null);
  };

  const handleDropPhraseToFolder = (targetFolderId: string | null, targetPhraseId?: string) => {
    if (savedPhraseDragItem?.type !== "phrase") return;
    const draggedPhrase = savedPhraseState.phrases.find((phrase) => phrase.id === savedPhraseDragItem.id);
    if (!draggedPhrase || draggedPhrase.id === targetPhraseId) return;

    const updatedDraggedPhrase = { ...draggedPhrase, folderId: targetFolderId };
    const remainingPhrases = savedPhraseState.phrases.filter((phrase) => phrase.id !== draggedPhrase.id);
    const targetIndex = typeof targetPhraseId === "string"
      ? remainingPhrases.findIndex((phrase) => phrase.id === targetPhraseId)
      : -1;
    const fallbackIndex = remainingPhrases.reduce((lastIndex, phrase, index) => (
      phrase.folderId === targetFolderId ? index : lastIndex
    ), -1);
    const insertIndex = targetIndex >= 0 ? targetIndex : fallbackIndex + 1;
    const nextPhrases = [...remainingPhrases];
    nextPhrases.splice(insertIndex, 0, updatedDraggedPhrase);

    void persistSavedPhraseState({ ...savedPhraseState, phrases: nextPhrases });
    if (selectedPhrase?.id === draggedPhrase.id) setSelectedPhrase(updatedDraggedPhrase);
    if (targetFolderId && !expandedFolderIds.includes(targetFolderId)) {
      setExpandedFolderIds((prev) => [...prev, targetFolderId]);
    }
    setSavedPhraseDragItem(null);
    toast.success("话术排序已更新");
  };

  const handleDropFolderOnFolder = (targetFolderId: string) => {
    if (savedPhraseDragItem?.type !== "folder" || savedPhraseDragItem.id === targetFolderId) return;

    const draggedFolder = savedPhraseState.folders.find((folder) => folder.id === savedPhraseDragItem.id);
    if (!draggedFolder) return;

    const remainingFolders = savedPhraseState.folders.filter((folder) => folder.id !== draggedFolder.id);
    const targetIndex = remainingFolders.findIndex((folder) => folder.id === targetFolderId);
    const nextFolders = [...remainingFolders];
    nextFolders.splice(targetIndex >= 0 ? targetIndex : nextFolders.length, 0, draggedFolder);

    void persistSavedPhraseState({ ...savedPhraseState, folders: nextFolders });
    setSavedPhraseDragItem(null);
    toast.success("文件夹排序已更新");
  };

  const handlePhraseDrop = (event: DragEvent<HTMLDivElement>, phrase: SavedPhrase) => {
    event.preventDefault();
    event.stopPropagation();
    handleDropPhraseToFolder(phrase.folderId, phrase.id);
  };

  const handleFolderDrop = (event: DragEvent<HTMLDivElement>, folderId: string) => {
    event.preventDefault();
    event.stopPropagation();
    if (savedPhraseDragItem?.type === "folder") {
      handleDropFolderOnFolder(folderId);
      return;
    }
    handleDropPhraseToFolder(folderId);
  };

  const handleRootPhraseDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    handleDropPhraseToFolder(null);
  };


  const handleDeletePhrase = (phraseId: string) => {
    const phrase = savedPhraseState.phrases.find((item) => item.id === phraseId);
    if (!phrase) return;
    if (!window.confirm(`确定要删除「${phrase.name}」吗？删除后其他设备也会同步删除。`)) return;

    void persistSavedPhraseState({
      ...savedPhraseState,
      phrases: savedPhraseState.phrases.filter((item) => item.id !== phraseId),
    });
    if (selectedPhrase?.id === phraseId) setSelectedPhrase(null);
    toast.success("话术已删除");
  };

  const handleCopySavedPhrase = async (phrase: SavedPhrase, language: PhraseLanguage) => {
    try {
      await navigator.clipboard.writeText(phrase.translations[language] || phrase.sourceText);
      setCopiedSavedPhraseLanguage(language);
      toast.success("已复制");
      window.setTimeout(() => setCopiedSavedPhraseLanguage((currentLanguage) => currentLanguage === language ? null : currentLanguage), 1500);
    } catch (error) {
      console.error("复制话术失败:", error);
      toast.error("复制失败，请手动复制");
    }
  };

  const searchedPhrases = phraseSearch.trim()
    ? savedPhraseState.phrases.filter((phrase) => phrase.name.toLowerCase().includes(phraseSearch.trim().toLowerCase()))
    : [];

  const renderSavedPhraseItem = (phrase: SavedPhrase) => (
    <PhraseListItem
      key={phrase.id}
      phrase={phrase}
      editingPhraseId={editingPhraseId}
      editingPhraseName={editingPhraseName}
      onOpen={setSelectedPhrase}
      onStartEdit={(item) => {
        setEditingPhraseId(item.id);
        setEditingPhraseName(item.name);
      }}
      onChangeEditName={setEditingPhraseName}
      onSaveEdit={handleRenamePhrase}
      onDelete={handleDeletePhrase}
      isDragging={savedPhraseDragItem?.type === "phrase" && savedPhraseDragItem.id === phrase.id}
      onDragStart={(event, item) => handleSavedPhraseDragStart(event, { type: "phrase", id: item.id })}
      onDragEnd={handleSavedPhraseDragEnd}
      onDropOnPhrase={handlePhraseDrop}
    />
  );

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
                <div className="mx-auto grid max-w-7xl gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
                  <div className="space-y-6">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-2 sm:gap-4">
                    <div className="min-w-0 space-y-2">
                      <label className="text-sm font-medium">源语言</label>
                      <Select
                        value={sourceLanguage}
                        onValueChange={(value) => {
                          setSourceLanguage(value);
                          setDetectedSourceLanguage(null);
                        }}
                      >
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

                    <div className="flex h-9 items-center justify-center text-muted-foreground self-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={handleSwapTranslationLanguages}
                        aria-label="交换源语言和目标语言"
                      >
                        <ArrowRightLeft className="w-4 h-4" />
                      </Button>
                    </div>

                    <div className="min-w-0 space-y-2">
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
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <label className="shrink-0 text-sm font-medium">翻译输入</label>
                        {sourceLanguage === "auto" && detectedSourceLanguage && (
                          <span className="truncate text-xs text-muted-foreground">
                            已检测：{getTranslationLanguageLabel(detectedSourceLanguage)}
                          </span>
                        )}
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">{translationInput.length} / 5000</span>
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
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setIsSavePhraseDialogOpen(true)}
                          disabled={!translationInput.trim() || !translationResult}
                        >
                          <Archive className="w-4 h-4 mr-1" />
                          收纳话术
                        </Button>
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

                    <aside className="rounded-lg border bg-background p-4 shadow-xs xl:sticky xl:top-4 xl:max-h-[calc(100vh-11rem)] xl:overflow-y-auto">
                      <div className="mb-4 flex items-center justify-between gap-2">
                        <div>
                          <h2 className="text-base font-semibold">收纳话术</h2>
                          <p className="text-xs text-muted-foreground">保存常用翻译，跨设备同步，后续复制不再消耗 token</p>
                        </div>
                        {isSavedPhraseSyncing && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                      </div>
                      <div className="mb-4 flex gap-2">
                        <Input value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} placeholder="新建文件夹" className="min-w-0" />
                        <Button size="icon" variant="outline" onClick={handleAddPhraseFolder} aria-label="添加文件夹">
                          <Plus className="w-4 h-4" />
                        </Button>
                      </div>
                      <div className="relative mb-4">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input value={phraseSearch} onChange={(e) => setPhraseSearch(e.target.value)} placeholder="搜索话术名称" className="pl-9" />
                      </div>
                      <div className="space-y-2">
                        {phraseSearch.trim() ? (
                          searchedPhrases.length > 0 ? searchedPhrases.map(renderSavedPhraseItem) : <p className="py-6 text-center text-sm text-muted-foreground">未找到匹配话术</p>
                        ) : (
                          <>
                            <div
                              className="space-y-1 rounded-md border border-dashed border-transparent p-1 transition-colors hover:border-muted-foreground/30"
                              onDragOver={(event) => event.preventDefault()}
                              onDrop={handleRootPhraseDrop}
                            >
                              {savedPhraseState.phrases.filter((phrase) => !phrase.folderId).map(renderSavedPhraseItem)}
                            </div>
                            {savedPhraseState.folders.map((folder) => {
                              const isExpanded = expandedFolderIds.includes(folder.id);
                              const folderPhrases = savedPhraseState.phrases.filter((phrase) => phrase.folderId === folder.id);
                              return (
                                <div
                                  key={folder.id}
                                  className={`rounded-md border ${savedPhraseDragItem?.type === "folder" && savedPhraseDragItem.id === folder.id ? "opacity-50 ring-1 ring-primary" : ""}`}
                                  onDragOver={(event) => event.preventDefault()}
                                  onDrop={(event) => handleFolderDrop(event, folder.id)}
                                >
                                  {editingFolderId === folder.id ? (
                                    <div className="flex items-center gap-1 px-2 py-2">
                                      <Folder className="h-4 w-4 shrink-0 text-blue-500" />
                                      <Input
                                        value={editingFolderName}
                                        onChange={(event) => setEditingFolderName(event.target.value)}
                                        onKeyDown={(event) => {
                                          if (event.key === "Enter") handleRenameFolder(folder.id);
                                          if (event.key === "Escape") {
                                            setEditingFolderId(null);
                                            setEditingFolderName("");
                                          }
                                        }}
                                        className="h-8 min-w-0 text-sm"
                                        autoFocus
                                      />
                                      <Button size="sm" variant="ghost" onClick={() => handleRenameFolder(folder.id)}>保存</Button>
                                    </div>
                                  ) : (
                                    <div
                                      className="group flex items-center gap-1"
                                      draggable
                                      onDragStart={(event) => handleSavedPhraseDragStart(event, { type: "folder", id: folder.id })}
                                      onDragEnd={handleSavedPhraseDragEnd}
                                    >
                                      <button type="button" onClick={() => setExpandedFolderIds((prev) => isExpanded ? prev.filter((id) => id !== folder.id) : [...prev, folder.id])} className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm font-medium">
                                        <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground opacity-60 group-hover:opacity-100" aria-hidden="true" />
                                        <ChevronRight className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                                        <Folder className="h-4 w-4 text-blue-500" />
                                        <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                                        <span className="text-xs text-muted-foreground">{folderPhrases.length}</span>
                                      </button>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="mr-1 h-8 w-8 shrink-0 opacity-70 group-hover:opacity-100"
                                        onClick={() => {
                                          setEditingFolderId(folder.id);
                                          setEditingFolderName(folder.name);
                                        }}
                                        aria-label="修改文件夹名称"
                                      >
                                        <Edit className="h-3.5 w-3.5" />
                                      </Button>
                                    </div>
                                  )}
                                  {isExpanded && (
                                    <div className="space-y-1 border-t p-2">
                                      {folderPhrases.length > 0 ? folderPhrases.map(renderSavedPhraseItem) : <p className="px-2 py-3 text-xs text-muted-foreground">文件夹暂无话术</p>}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                            {savedPhraseState.phrases.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">暂无收纳话术</p>}
                          </>
                        )}
                      </div>
                    </aside>
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

      <Dialog open={isSavePhraseDialogOpen} onOpenChange={setIsSavePhraseDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>收纳话术</DialogTitle>
            <DialogDescription>选择文件夹；不选择则保存到一级列表。收纳时会一次性生成并储存多语种翻译。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4">
            <label className="text-sm font-medium">保存位置</label>
            <Select value={selectedFolderIdForSave} onValueChange={setSelectedFolderIdForSave}>
              <SelectTrigger>
                <SelectValue placeholder="选择文件夹" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="root">一级列表</SelectItem>
                {savedPhraseState.folders.map((folder) => (
                  <SelectItem key={folder.id} value={folder.id}>{folder.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="line-clamp-3 rounded-md bg-muted p-3 text-xs text-muted-foreground">{translationInput.trim()}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSavePhraseDialogOpen(false)} disabled={isSavingPhrase}>取消</Button>
            <Button onClick={handleSavePhrase} disabled={isSavingPhrase}>
              {isSavingPhrase && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              确认收纳
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selectedPhrase)} onOpenChange={(open) => {
        if (!open) {
          setSelectedPhrase(null);
          setCopiedSavedPhraseLanguage(null);
        }
      }}>
        <DialogContent className="min-w-0 max-h-[90vh] overflow-hidden sm:max-w-[520px]">
          <DialogHeader className="min-w-0 pr-8">
            <DialogTitle className="max-w-full truncate" title={selectedPhrase?.name || "话术详情"}>{selectedPhrase?.name || "话术详情"}</DialogTitle>
            <DialogDescription>查看完整话术，点击语种即可复制已储存的翻译内容。</DialogDescription>
          </DialogHeader>
          {selectedPhrase && (
            <div className="min-w-0 space-y-4 overflow-y-auto py-4 pr-1">
              <div className="min-w-0">
                <div className="mb-2 text-sm font-medium">完整内容</div>
                <div className="max-h-40 overflow-auto rounded-md border bg-muted/40 p-3 text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{selectedPhrase.sourceText}</div>
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium">所属文件夹</div>
                <Select value={selectedPhrase.folderId || "root"} onValueChange={(value) => handleMovePhrase(selectedPhrase.id, value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择文件夹" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="root">一级列表</SelectItem>
                    {savedPhraseState.folders.map((folder) => (
                      <SelectItem key={folder.id} value={folder.id}>{folder.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3">
                {PHRASE_TRANSLATION_LANGUAGES.map((language) => {
                  const isCopied = copiedSavedPhraseLanguage === language.value;

                  return (
                    <Button
                      key={language.value}
                      variant={isCopied ? "default" : "outline"}
                      className="min-w-0 whitespace-normal break-words"
                      onClick={() => handleCopySavedPhrase(selectedPhrase, language.value)}
                    >
                      {isCopied ? (
                        <>
                          <Check className="mr-2 h-4 w-4" />
                          已复制
                        </>
                      ) : language.label}
                    </Button>
                  );
                })}
              </div>
              <Button variant="outline" className="w-full min-w-0 whitespace-normal text-red-500 hover:text-red-600" onClick={() => handleDeletePhrase(selectedPhrase.id)}>
                <Trash2 className="mr-2 h-4 w-4" />
                删除话术
              </Button>
            </div>
          )}
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
