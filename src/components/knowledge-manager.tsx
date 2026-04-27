"use client";

import { useState, useEffect } from "react";
import { FileText, Link2, Trash2, Plus, ExternalLink, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { KnowledgeItem } from "@/lib/types";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/store";
import { toast } from "sonner";

const PROMPT_KEY = "diclok_system_prompt";

interface KnowledgeManagerProps {
  items: KnowledgeItem[];
  onAddItem: (item: Omit<KnowledgeItem, "id" | "createdAt">) => void;
  onDeleteItem: (id: string) => void;
  onPromptChange?: (prompt: string) => void;
}

export function KnowledgeManager({
  items,
  onAddItem,
  onDeleteItem,
  onPromptChange,
}: KnowledgeManagerProps) {
  const [feishuUrl, setFeishuUrl] = useState("");
  const [documentName, setDocumentName] = useState("");
  const [documentContent, setDocumentContent] = useState("");
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [tempPrompt, setTempPrompt] = useState("");
  const [isAlertOpen, setIsAlertOpen] = useState(false);

  // 加载保存的 prompt
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedPrompt = localStorage.getItem(PROMPT_KEY);
      if (savedPrompt) {
        setSystemPrompt(savedPrompt);
        setTempPrompt(savedPrompt);
      } else {
        setTempPrompt(DEFAULT_SYSTEM_PROMPT);
      }
    }
  }, []);

  const handleAddFeishu = () => {
    if (!feishuUrl.trim()) {
      toast.error("请输入飞书链接");
      return;
    }
    if (!isValidUrl(feishuUrl)) {
      toast.error("请输入有效的链接");
      return;
    }
    onAddItem({
      name: `飞书多维表格 ${items.filter((i) => i.type === "feishu").length + 1}`,
      type: "feishu",
      url: feishuUrl.trim(),
    });
    setFeishuUrl("");
    toast.success("飞书链接已添加");
  };

  const handleAddDocument = () => {
    if (!documentName.trim()) {
      toast.error("请输入文档名称");
      return;
    }
    if (!documentContent.trim()) {
      toast.error("请输入文档内容");
      return;
    }
    onAddItem({
      name: documentName.trim(),
      type: "document",
      content: documentContent.trim(),
    });
    setDocumentName("");
    setDocumentContent("");
    toast.success("文档已添加");
  };

  const handleConfirmPrompt = () => {
    setSystemPrompt(tempPrompt);
    if (typeof window !== "undefined") {
      localStorage.setItem(PROMPT_KEY, tempPrompt);
    }
    if (onPromptChange) {
      onPromptChange(tempPrompt);
    }
    setIsAlertOpen(false);
    toast.success("系统 Prompt 已更新");
  };

  const handleOpenAlert = () => {
    setTempPrompt(systemPrompt);
    setIsAlertOpen(true);
  };

  const isValidUrl = (url: string): boolean => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h2 className="text-2xl font-semibold mb-6">知识库管理</h2>

      <Tabs defaultValue="feishu" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="feishu" className="flex items-center gap-2">
            <Link2 className="w-4 h-4" />
            飞书多维表格
          </TabsTrigger>
          <TabsTrigger value="document" className="flex items-center gap-2">
            <FileText className="w-4 h-4" />
            文档内容
          </TabsTrigger>
        </TabsList>

        <TabsContent value="feishu" className="mt-6 space-y-6">
          <Card className="p-6 space-y-4">
            <div>
              <Label htmlFor="feishu-url">飞书多维表格链接</Label>
              <Input
                id="feishu-url"
                value={feishuUrl}
                onChange={(e) => setFeishuUrl(e.target.value)}
                placeholder="https://xxx.feishu.cn/base/xxx"
                className="mt-2"
              />
            </div>
            <Button onClick={handleAddFeishu} className="bg-blue-600 hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-2" />
              添加链接
            </Button>
          </Card>

          <div className="space-y-3">
            <h3 className="font-medium">已添加的飞书链接</h3>
            {items.filter((i) => i.type === "feishu").length === 0 ? (
              <p className="text-muted-foreground text-sm">暂无添加的链接</p>
            ) : (
              items
                .filter((i) => i.type === "feishu")
                .map((item) => (
                  <Card key={item.id} className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <Link2 className="w-5 h-5 text-blue-500 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{item.name}</p>
                        <p className="text-sm text-muted-foreground truncate">{item.url}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {item.url && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => window.open(item.url, "_blank")}
                        >
                          <ExternalLink className="w-4 h-4" />
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          onDeleteItem(item.id);
                          toast.success("已删除");
                        }}
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </Button>
                    </div>
                  </Card>
                ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="document" className="mt-6 space-y-6">
          <Card className="p-6 space-y-4">
            <div>
              <Label htmlFor="doc-name">文档名称</Label>
              <Input
                id="doc-name"
                value={documentName}
                onChange={(e) => setDocumentName(e.target.value)}
                placeholder="例如：产品常见问题解答"
                className="mt-2"
              />
            </div>
            <div>
              <Label htmlFor="doc-content">文档内容</Label>
              <textarea
                id="doc-content"
                value={documentContent}
                onChange={(e) => setDocumentContent(e.target.value)}
                placeholder="输入文档的完整内容，AI 将根据这些内容生成推荐回复..."
                className="mt-2 w-full min-h-[200px] p-3 rounded-md border border-input bg-background text-sm resize-y"
              />
            </div>
            <Button onClick={handleAddDocument} className="bg-blue-600 hover:bg-blue-700">
              <Plus className="w-4 h-4 mr-2" />
              添加文档
            </Button>
          </Card>

          <div className="space-y-3">
            <h3 className="font-medium">已添加的文档</h3>
            {items.filter((i) => i.type === "document").length === 0 ? (
              <p className="text-muted-foreground text-sm">暂无添加的文档</p>
            ) : (
              items
                .filter((i) => i.type === "document")
                .map((item) => (
                  <Card key={item.id} className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <FileText className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{item.name}</p>
                          <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                            {item.content}
                          </p>
                        </div>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          onDeleteItem(item.id);
                          toast.success("已删除");
                        }}
                        className="shrink-0"
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </Button>
                    </div>
                  </Card>
                ))
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Prompt 设置区域 */}
      <div className="mt-8 pt-6 border-t">
        <Card className="p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-gray-600" />
            <h3 className="font-medium text-lg">系统 Prompt 设置</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            设置 AI 客服助手的系统提示词，用于定义 AI 的角色和行为规范。
          </p>

          <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <p className="text-sm text-blue-800 dark:text-blue-200 font-medium mb-2">
              当前 Prompt 预览
            </p>
            <p className="text-sm text-blue-700 dark:text-blue-300 whitespace-pre-wrap line-clamp-3">
              {systemPrompt}
            </p>
          </div>

          <AlertDialog open={isAlertOpen} onOpenChange={setIsAlertOpen}>
            <AlertDialogTrigger asChild>
              <Button onClick={handleOpenAlert} variant="outline" className="w-full">
                <Settings className="w-4 h-4 mr-2" />
                修改 Prompt
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
              <AlertDialogHeader>
                <AlertDialogTitle>修改系统 Prompt</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div>
                    <p className="mb-2">
                      修改 AI 客服助手的系统提示词，这将影响 AI 生成回复的风格和内容。
                    </p>
                    <p className="text-amber-600 dark:text-amber-400 font-medium">
                      修改后新的对话将使用新的 Prompt，已有的对话历史不受影响。
                    </p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>

              <div className="py-4">
                <Label htmlFor="prompt-content" className="text-base font-medium">
                  Prompt 内容
                </Label>
                <textarea
                  id="prompt-content"
                  value={tempPrompt}
                  onChange={(e) => setTempPrompt(e.target.value)}
                  placeholder="输入系统提示词..."
                  className="mt-2 w-full min-h-[300px] p-3 rounded-md border border-input bg-background text-sm resize-y font-mono"
                />
              </div>

              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction onClick={handleConfirmPrompt}>
                  确认修改
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </Card>
      </div>
    </div>
  );
}
