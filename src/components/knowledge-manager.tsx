"use client";

import { useState, useEffect, useCallback } from "react";
import { Upload, FileSpreadsheet, Trash2, RefreshCw, CheckCircle, XCircle, Settings, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
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
import { Progress } from "@/components/ui/progress";
import { DEFAULT_SYSTEM_PROMPT, getKnowledgeStats, replaceKnowledgeData, getKnowledgeBase } from "@/lib/store";
import { importExcelFile, importMultipleExcelFiles, ImportResult } from "@/lib/excel-parser";
import { KnowledgeBase } from "@/lib/types";
import { toast } from "sonner";

interface KnowledgeManagerProps {
  onPromptChange?: (prompt: string) => void;
}

export function KnowledgeManager({ onPromptChange }: KnowledgeManagerProps) {
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [tempPrompt, setTempPrompt] = useState("");
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importResults, setImportResults] = useState<ImportResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [stats, setStats] = useState({
    faqCount: 0,
    troubleshootingCount: 0,
    outOfScopeCount: 0,
    mappingCount: 0,
    functionCount: 0,
    termCount: 0,
    lastUpdated: 0,
  });

  // 加载数据
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedPrompt = localStorage.getItem("diclok_system_prompt");
      if (savedPrompt) {
        setSystemPrompt(savedPrompt);
      }
      updateStats();
    }
  }, []);

  const updateStats = useCallback(() => {
    const currentStats = getKnowledgeStats();
    setStats(currentStats);
  }, []);

  const handleOpenAlert = () => {
    setTempPrompt(systemPrompt);
    setIsAlertOpen(true);
  };

  const handleConfirmPrompt = () => {
    setSystemPrompt(tempPrompt);
    if (typeof window !== "undefined") {
      localStorage.setItem("diclok_system_prompt", tempPrompt);
    }
    if (onPromptChange) {
      onPromptChange(tempPrompt);
    }
    setIsAlertOpen(false);
    toast.success("系统 Prompt 已更新");
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsImporting(true);
    setImportProgress(0);
    setImportResults([]);
    setShowResults(false);

    try {
      const fileArray = Array.from(files);
      const results: ImportResult[] = [];

      for (let i = 0; i < fileArray.length; i++) {
        const file = fileArray[i];
        setImportProgress(Math.round(((i + 0.5) / fileArray.length) * 100));
        
        const result = await importExcelFile(file);
        results.push(result);
        
        setImportProgress(Math.round(((i + 1) / fileArray.length) * 100));
      }

      setImportResults(results);
      setShowResults(true);

      // 如果有成功的结果，更新知识库
      const successResults = results.filter(r => r.success && r.data);
      if (successResults.length > 0) {
        const combinedData: Partial<KnowledgeBase> = {
          faqItems: [],
          troubleshootingItems: [],
          outOfScopeItems: [],
          mappingItems: [],
          functionKnowledge: [],
          termItems: [],
        };

        for (const result of successResults) {
          if (result.data) {
            combinedData.faqItems!.push(...(result.data.faqItems || []));
            combinedData.troubleshootingItems!.push(...(result.data.troubleshootingItems || []));
            combinedData.outOfScopeItems!.push(...(result.data.outOfScopeItems || []));
            combinedData.mappingItems!.push(...(result.data.mappingItems || []));
            combinedData.functionKnowledge!.push(...(result.data.functionKnowledge || []));
            combinedData.termItems!.push(...(result.data.termItems || []));
          }
        }

        replaceKnowledgeData(combinedData as KnowledgeBase);
        updateStats();
        toast.success(`成功导入 ${successResults.length} 个文件`);
      }

      // 显示失败信息
      const failedResults = results.filter(r => !r.success);
      if (failedResults.length > 0) {
        failedResults.forEach(r => {
          toast.error(r.message);
        });
      }
    } catch (error) {
      toast.error(`导入失败: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsImporting(false);
      // 清空文件输入
      event.target.value = '';
    }
  };

  const handleClearKnowledge = () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("diclok_knowledge");
      updateStats();
      toast.success("知识库已清空");
    }
  };

  const formatLastUpdated = () => {
    if (!stats.lastUpdated) return "从未更新";
    const date = new Date(stats.lastUpdated);
    return date.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const totalItems = stats.faqCount + stats.troubleshootingCount + stats.outOfScopeCount + 
                     stats.mappingCount + stats.functionCount + stats.termCount;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h2 className="text-2xl font-semibold mb-6">知识库管理</h2>

      {/* Excel 导入区域 */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5" />
            Excel 文件导入
          </CardTitle>
          <CardDescription>
            上传 FAQ库.xlsx、功能知识库.xlsx、术语库.xlsx 文件导入知识库
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 上传区域 */}
          <div className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg p-8 text-center hover:border-blue-400 transition-colors">
            <input
              type="file"
              id="excel-upload"
              className="hidden"
              accept=".xlsx,.xls"
              multiple
              onChange={handleFileSelect}
              disabled={isImporting}
            />
            <label htmlFor="excel-upload" className="cursor-pointer">
              <Upload className="w-12 h-12 mx-auto mb-4 text-gray-400" />
              <p className="text-lg font-medium mb-2">
                {isImporting ? "导入中..." : "点击上传 Excel 文件"}
              </p>
              <p className="text-sm text-gray-500">
                支持 .xlsx 和 .xls 格式，可同时上传多个文件
              </p>
            </label>
          </div>

          {/* 导入进度 */}
          {isImporting && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>正在导入...</span>
                <span>{importProgress}%</span>
              </div>
              <Progress value={importProgress} />
            </div>
          )}

          {/* 导入结果 */}
          {showResults && importResults.length > 0 && (
            <div className="space-y-3">
              <Label>导入结果</Label>
              {importResults.map((result, index) => (
                <div
                  key={index}
                  className={`flex items-center gap-3 p-3 rounded-lg ${
                    result.success
                      ? "bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800"
                      : "bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800"
                  }`}
                >
                  {result.success ? (
                    <CheckCircle className="w-5 h-5 text-green-600 shrink-0" />
                  ) : (
                    <XCircle className="w-5 h-5 text-red-600 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={`font-medium ${result.success ? "text-green-700 dark:text-green-300" : "text-red-700 dark:text-red-300"}`}>
                      {result.message}
                    </p>
                    {result.success && (
                      <div className="flex flex-wrap gap-3 mt-1 text-sm text-green-600 dark:text-green-400">
                        {result.stats.faqCount > 0 && <span>FAQ: {result.stats.faqCount}</span>}
                        {result.stats.troubleshootingCount > 0 && <span>排障: {result.stats.troubleshootingCount}</span>}
                        {result.stats.outOfScopeCount > 0 && <span>超范围: {result.stats.outOfScopeCount}</span>}
                        {result.stats.mappingCount > 0 && <span>映射: {result.stats.mappingCount}</span>}
                        {result.stats.functionCount > 0 && <span>功能: {result.stats.functionCount}</span>}
                        {result.stats.termCount > 0 && <span>术语: {result.stats.termCount}</span>}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 知识库统计 */}
          {totalItems > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>当前知识库统计</Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClearKnowledge}
                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                >
                  <Trash2 className="w-4 h-4 mr-1" />
                  清空知识库
                </Button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <StatCard label="FAQ" count={stats.faqCount} color="blue" />
                <StatCard label="排障问题" count={stats.troubleshootingCount} color="orange" />
                <StatCard label="超范围问题" count={stats.outOfScopeCount} color="gray" />
                <StatCard label="问题映射" count={stats.mappingCount} color="purple" />
                <StatCard label="功能知识" count={stats.functionCount} color="green" />
                <StatCard label="术语库" count={stats.termCount} color="pink" />
              </div>
              <p className="text-sm text-muted-foreground">
                最后更新: {formatLastUpdated()}
              </p>
            </div>
          )}

          {totalItems === 0 && !isImporting && !showResults && (
            <div className="text-center py-4 text-muted-foreground">
              <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>暂无导入数据，请上传 Excel 文件</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Prompt 设置区域 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            系统 Prompt 设置
          </CardTitle>
          <CardDescription>
            设置 AI 客服助手的系统提示词，用于定义 AI 的角色和行为规范
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
        </CardContent>
      </Card>
    </div>
  );
}

// 统计卡片组件
function StatCard({ label, count, color }: { label: string; count: number; color: string }) {
  const colorClasses: Record<string, string> = {
    blue: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
    orange: "bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300",
    gray: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    purple: "bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300",
    green: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
    pink: "bg-pink-100 text-pink-700 dark:bg-pink-900/50 dark:text-pink-300",
  };

  return (
    <div className={`rounded-lg p-3 ${colorClasses[color]}`}>
      <p className="text-2xl font-bold">{count}</p>
      <p className="text-sm opacity-80">{label}</p>
    </div>
  );
}
