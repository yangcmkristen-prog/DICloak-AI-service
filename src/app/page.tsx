"use client";

import { useState, useEffect, useCallback } from "react";
import { MessageSquare, BookOpen, Plus, Pencil, Trash2, Edit } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConversationList } from "@/components/conversation-list";
import { ChatArea } from "@/components/chat-area";
import { KnowledgeManager } from "@/components/knowledge-manager";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Conversation, Message, generateId } from "@/lib/types";
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

// 从数据库同步配置到 localStorage
async function syncConfigFromDatabase() {
  try {
    // 同步知识库
    const knowledgeRes = await fetch("/api/config/knowledge");
    const knowledgeData = await knowledgeRes.json();
    if (knowledgeData.success && knowledgeData.data && !knowledgeData.isEmpty) {
      const localKnowledge = getKnowledgeBase();
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
function isKnowledgeBaseEmpty(kb: any): boolean {
  return !kb || (
    (!kb.faqItems || kb.faqItems.length === 0) &&
    (!kb.troubleshootingItems || kb.troubleshootingItems.length === 0) &&
    (!kb.outOfScopeItems || kb.outOfScopeItems.length === 0) &&
    (!kb.mappingItems || kb.mappingItems.length === 0) &&
    (!kb.functionKnowledge || kb.functionKnowledge.length === 0) &&
    (!kb.termItems || kb.termItems.length === 0)
  );
}

export default function Home() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationIdState] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

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

      // 构建请求
      const detectedLang = detectLanguage(content);
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: content,
          history: currentConversation?.messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          knowledge: knowledgeData,
          systemPrompt: systemPrompt,
          apiConfig: currentApiConfig,
          detectedLanguage: detectedLang,
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
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧边栏 */}
        <aside className="w-72 border-r bg-gray-50/50 dark:bg-gray-900/50 hidden md:flex md:flex-col">
          <ConversationList
            conversations={conversations}
            currentConversationId={currentConversationId}
            onSelectConversation={handleSelectConversation}
            onCreateConversation={handleCreateConversation}
            onDeleteConversation={handleDeleteConversation}
            onRenameConversation={handleRenameConversation}
          />
        </aside>

        {/* 右侧主区域 - 支持页面滚动 */}
        <main className="flex-1 flex flex-col overflow-y-auto">
          <Tabs defaultValue="chat" className="flex-1 flex flex-col min-h-0">
            <TabsList className="w-full justify-start rounded-none border-b px-4 bg-background h-12 shrink-0 sticky top-0 z-10">
              <TabsTrigger
                value="chat"
                className="data-[state=active]:bg-blue-50 data-[state=active]:text-blue-600 data-[state=active]:border-b-2 data-[state=active]:border-blue-600 rounded-none"
              >
                <MessageSquare className="w-4 h-4 mr-2" />
                对话助手
              </TabsTrigger>
              <TabsTrigger
                value="knowledge"
                className="data-[state=active]:bg-blue-50 data-[state=active]:text-blue-600 data-[state=active]:border-b-2 data-[state=active]:border-blue-600 rounded-none"
              >
                <BookOpen className="w-4 h-4 mr-2" />
                知识库
              </TabsTrigger>
            </TabsList>

            <TabsContent value="chat" className="flex-1 flex flex-col m-0 min-h-0">
              {/* 移动端对话选择区域 */}
              <div className="md:hidden p-4 border-b shrink-0 space-y-3">
                <p className="text-red-500 text-sm">mobile-actions-v2</p>
                {/* 第一行：对话选择 */}
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
                {/* 第二行：操作按钮 */}
                <div className="flex items-center gap-2">
                  {/* 新建对话 */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCreateConversation}
                    className="flex-1"
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    新建对话
                  </Button>
                  {/* 编辑当前对话 */}
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
                  {/* 删除当前对话 */}
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
                </div>
              </div>

              <ChatArea
                messages={currentConversation?.messages || []}
                onSendMessage={handleSendMessage}
                isGenerating={isGenerating}
              />
            </TabsContent>

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

            <TabsContent value="knowledge" className="flex-1 m-0">
              <KnowledgeManager />
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </div>
  );
}
