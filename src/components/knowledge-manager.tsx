"use client";

import { useState, useEffect, useCallback } from "react";
import { Upload, FileSpreadsheet, Trash2, RefreshCw, CheckCircle, XCircle, Settings, AlertCircle, Loader2, Cloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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
import { DEFAULT_SYSTEM_PROMPT, getKnowledgeStats, replaceKnowledgeData, getKnowledgeBase, getApiConfig, saveApiConfig, ApiConfig, DEFAULT_API_CONFIG, MODEL_OPTIONS, PROVIDER_INFO, saveKnowledgeBase, KnowledgeStats } from "@/lib/store";
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
  const [stats, setStats] = useState<KnowledgeStats>({
    faqCount: 0,
    troubleshootingCount: 0,
    outOfScopeCount: 0,
    mappingCount: 0,
    functionCount: 0,
    termCount: 0,
    lastUpdated: 0,
    feature_faq: 0,
    troubleshooting: 0,
    user_routing: 0,
    out_of_scope: 0,
    mapping: 0,
    功能知识: 0,
    术语: 0,
    total: 0,
  });

  // API 配置状态 - 初始为 null，避免 SSR/CSR mismatch
  const [apiConfig, setApiConfig] = useState<ApiConfig | null>(null);
  const [showApiConfig, setShowApiConfig] = useState(false);
  // 自定义 HTTP 配置
  const [customEndpoint, setCustomEndpoint] = useState("");
  const [customModelName, setCustomModelName] = useState("");
  // 同步状态
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');

  // 加载数据 - 从数据库和 localStorage 同步
  useEffect(() => {
    if (typeof window !== "undefined") {
      // 从数据库加载配置
      loadFromDatabase();
    }
  }, []);

  const loadFromDatabase = async () => {
    try {
      // 并行加载知识库和系统配置
      const [knowledgeRes, systemRes] = await Promise.all([
        fetch('/api/config/knowledge'),
        fetch('/api/config/system'),
      ]);

      // 检查响应是否为 JSON（不是 HTML 或错误页面）
      const contentType = knowledgeRes.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.warn('API 返回的不是 JSON，跳过数据库加载');
        updateStats();
        return;
      }

      const knowledgeData = await knowledgeRes.json();
      const systemData = await systemRes.json();

      // 如果数据库有数据，使用数据库数据
      if (knowledgeData.success && !knowledgeData.isEmpty) {
        const kb = knowledgeData.data;
        // 使用数据库的 updatedAt 作为 lastUpdated（确保跨设备同步）
        if (knowledgeData.updatedAt) {
          kb.lastUpdated = new Date(knowledgeData.updatedAt).getTime();
        }
        replaceKnowledgeData(kb);
        saveKnowledgeBase(kb);
        // 更新 UI 状态
        updateStats();
      } else {
        // 否则使用 localStorage
        updateStats();
      }

      // 处理系统配置（Prompt 和 API）
      if (systemData.success && !systemData.isEmpty) {
        const config = systemData.data;
        // 设置 Prompt
        if (config.systemPrompt) {
          setSystemPrompt(config.systemPrompt);
          localStorage.setItem("diclok_system_prompt", config.systemPrompt);
        }
        // 设置 API 配置
        if (config.apiConfig) {
          setApiConfig(config.apiConfig);
          saveApiConfig(config.apiConfig);
          if (config.apiConfig.customConfig) {
            setCustomEndpoint(config.apiConfig.customConfig.endpoint || "");
            setCustomModelName(config.apiConfig.customConfig.modelName || "");
          }
        }
      } else {
        // 使用 localStorage
        const savedPrompt = localStorage.getItem("diclok_system_prompt");
        if (savedPrompt) {
          setSystemPrompt(savedPrompt);
        }
        const savedApiConfig = getApiConfig();
        setApiConfig(savedApiConfig);
        if (savedApiConfig.customConfig) {
          setCustomEndpoint(savedApiConfig.customConfig.endpoint || "");
          setCustomModelName(savedApiConfig.customConfig.modelName || "");
        }
      }
    } catch (error) {
      console.error('从数据库加载配置失败:', error);
      // 降级使用 localStorage
      const savedPrompt = localStorage.getItem("diclok_system_prompt");
      if (savedPrompt) {
        setSystemPrompt(savedPrompt);
      }
      const savedApiConfig = getApiConfig();
      setApiConfig(savedApiConfig);
      updateStats();
    }
  };

  // 同步知识库到数据库
  const syncKnowledgeToDatabase = async (data: KnowledgeBase): Promise<boolean> => {
    setSyncStatus('syncing');
    try {
      const response = await fetch('/api/config/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ knowledgeData: data }),
      });
      if (!response.ok) {
        console.error('同步知识库到数据库失败');
        setSyncStatus('error');
        return false;
      }
      setSyncStatus('synced');
      return true;
    } catch (error) {
      console.error('同步知识库到数据库失败:', error);
      setSyncStatus('error');
      return false;
    }
  };

  // 同步系统配置到数据库
  const syncSystemConfigToDatabase = async (prompt: string, apiCfg: ApiConfig | null) => {
    try {
      const response = await fetch('/api/config/system', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemPrompt: prompt, apiConfig: apiCfg }),
      });
      if (!response.ok) {
        console.error('同步系统配置到数据库失败');
      }
    } catch (error) {
      console.error('同步系统配置到数据库失败:', error);
    }
  };

  const updateStats = useCallback(() => {
    const currentStats = getKnowledgeStats();
    setStats(currentStats);
  }, []);

  const handleOpenAlert = () => {
    setTempPrompt(systemPrompt);
    setIsAlertOpen(true);
  };

  const handleConfirmPrompt = async () => {
    setSystemPrompt(tempPrompt);
    if (typeof window !== "undefined") {
      localStorage.setItem("diclok_system_prompt", tempPrompt);
    }
    // 同步到数据库，等待完成后再关闭
    await syncSystemConfigToDatabase(tempPrompt, apiConfig);
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
        // 同步到数据库，等待完成后再切换标签页
        const syncSuccess = await syncKnowledgeToDatabase(combinedData as KnowledgeBase);
        updateStats();
        if (syncSuccess) {
          toast.success(`成功导入 ${successResults.length} 个文件，已同步到云端`);
        } else {
          toast.error('导入成功但同步失败，请刷新重试');
        }
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

  const handleClearKnowledge = async () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("diclok_knowledge");
      updateStats();
      // 同步清空到数据库
      await syncKnowledgeToDatabase({
        faqItems: [],
        troubleshootingItems: [],
        outOfScopeItems: [],
        mappingItems: [],
        functionKnowledge: [],
        termItems: [],
        lastUpdated: Date.now(),
      });
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

  // 保存 API 配置
  const handleSaveApiConfig = async () => {
    if (!apiConfig) return;
    
    // 如果是自定义 HTTP，保存自定义配置
    if (apiConfig.provider === 'custom') {
      const configToSave: ApiConfig = {
        ...apiConfig,
        customConfig: {
          endpoint: customEndpoint,
          modelName: customModelName,
        },
      };
      saveApiConfig(configToSave);
      // 同步到数据库
      await syncSystemConfigToDatabase(systemPrompt, configToSave);
    } else {
      saveApiConfig(apiConfig);
      // 同步到数据库
      await syncSystemConfigToDatabase(systemPrompt, apiConfig);
    }
    toast.success("API 配置已保存");
    setShowApiConfig(false);
  };

  // 处理 provider 切换
  const handleProviderChange = (provider: ApiConfig['provider']) => {
    if (!apiConfig) return;
    const providerInfo = PROVIDER_INFO[provider];
    setApiConfig(prev => prev ? {
      ...prev,
      provider,
      model: providerInfo.defaultModel,
      baseUrl: providerInfo.baseUrl,
    } : null);
  };

  const totalItems = (stats.faqCount || 0) + (stats.troubleshootingCount || 0) + (stats.outOfScopeCount || 0) + 
                     (stats.mappingCount || 0) + (stats.functionCount || 0) + (stats.termCount || 0);

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

              {/* 同步状态标注 */}
              {syncStatus === 'synced' && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800">
                  <Cloud className="w-5 h-5 text-green-600" />
                  <span className="text-sm text-green-700 dark:text-green-300 font-medium">
                    已同步到云端
                  </span>
                </div>
              )}
              {syncStatus === 'syncing' && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
                  <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                  <span className="text-sm text-blue-700 dark:text-blue-300 font-medium">
                    正在同步...
                  </span>
                </div>
              )}
              {syncStatus === 'error' && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
                  <AlertCircle className="w-5 h-5 text-red-600" />
                  <span className="text-sm text-red-700 dark:text-red-300 font-medium">
                    同步失败，请重试
                  </span>
                </div>
              )}
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
                <StatCard label="FAQ" count={stats.faqCount || 0} color="blue" />
                <StatCard label="排障问题" count={stats.troubleshootingCount || 0} color="orange" />
                <StatCard label="超范围问题" count={stats.outOfScopeCount || 0} color="gray" />
                <StatCard label="问题映射" count={stats.mappingCount || 0} color="purple" />
                <StatCard label="功能知识" count={stats.functionCount || 0} color="green" />
                <StatCard label="术语库" count={stats.termCount || 0} color="pink" />
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

      {/* API 配置区域 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            AI 模型配置
          </CardTitle>
          <CardDescription>
            选择 AI 模型并配置 API Key，支持豆包、GPT、DeepSeek、Kimi 等
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 加载中状态 */}
          {!apiConfig ? (
            <div className="text-center py-4 text-muted-foreground">加载中...</div>
          ) : (
            <>
              {/* 当前配置预览 */}
              <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-blue-800 dark:text-blue-200 font-medium mb-1">
                      当前配置
                    </p>
                    <p className="text-sm text-blue-700 dark:text-blue-300">
                      {PROVIDER_INFO[apiConfig.provider]?.name || apiConfig.provider} - {apiConfig.model}
                      {!apiConfig.apiKey && ' (使用默认 API)'}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowApiConfig(!showApiConfig)}
                    className="shrink-0"
                  >
                    {showApiConfig ? "收起" : "配置"}
                  </Button>
                </div>
              </div>

              {/* 配置表单 */}
              {showApiConfig && (
                <div className="space-y-4 border-t pt-4">
                  {/* Provider 选择 */}
                  <div className="space-y-2">
                    <Label htmlFor="provider">AI 提供商</Label>
                    <select
                      id="provider"
                      value={apiConfig.provider}
                      onChange={(e) => handleProviderChange(e.target.value as ApiConfig['provider'])}
                      className="w-full p-2 rounded-md border border-input bg-background text-sm"
                    >
                      {Object.entries(PROVIDER_INFO).map(([key, info]) => (
                        <option key={key} value={key}>{info.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* 自定义 HTTP 配置 */}
                  {apiConfig.provider === 'custom' ? (
                    <>
                      {/* 自定义 HTTP 端点 */}
                      <div className="space-y-2">
                        <Label htmlFor="customEndpoint">API 端点 URL</Label>
                        <Input
                          id="customEndpoint"
                          value={customEndpoint}
                          onChange={(e) => setCustomEndpoint(e.target.value)}
                          placeholder="https://api.example.com/v1/chat/completions"
                        />
                        <p className="text-xs text-muted-foreground">
                          输入完整的 API 端点 URL，支持 OpenAI 兼容格式
                        </p>
                      </div>

                      {/* 自定义模型名称 */}
                      <div className="space-y-2">
                        <Label htmlFor="customModel">模型名称</Label>
                        <Input
                          id="customModel"
                          value={customModelName}
                          onChange={(e) => setCustomModelName(e.target.value)}
                          placeholder="gpt-5.4 / claude-3-opus / 自定义模型名"
                        />
                        <p className="text-xs text-muted-foreground">
                          输入要调用的模型名称
                        </p>
                      </div>

                      {/* 自定义 API Key */}
                      <div className="space-y-2">
                        <Label htmlFor="customApiKey">API Key</Label>
                        <Input
                          id="customApiKey"
                          type="password"
                          value={apiConfig.apiKey}
                          onChange={(e) => setApiConfig(prev => prev ? { ...prev, apiKey: e.target.value } : prev)}
                          placeholder="输入 API Key（根据服务端要求）"
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      {/* 模型选择 */}
                      <div className="space-y-2">
                        <Label htmlFor="model">模型</Label>
                        <select
                          id="model"
                          value={apiConfig.model}
                          onChange={(e) => setApiConfig(prev => prev ? { ...prev, model: e.target.value } : prev)}
                          className="w-full p-2 rounded-md border border-input bg-background text-sm"
                        >
                          {MODEL_OPTIONS.filter(opt => opt.provider === apiConfig.provider).map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>

                      {/* API Key */}
                      <div className="space-y-2">
                        <Label htmlFor="apiKey">API Key</Label>
                        <Input
                          id="apiKey"
                          type="password"
                          value={apiConfig.apiKey}
                          onChange={(e) => setApiConfig(prev => prev ? { ...prev, apiKey: e.target.value } : prev)}
                          placeholder={PROVIDER_INFO[apiConfig.provider]?.keyPlaceholder}
                        />
                        <p className="text-xs text-muted-foreground">
                          {apiConfig.provider === 'coze' 
                            ? '使用内置 API，无需填写 Key'
                            : '请填入您的 API Key，费用由您自行承担'
                          }
                        </p>
                      </div>

                      {/* Base URL (可选) */}
                      {apiConfig.provider !== 'coze' && (
                        <div className="space-y-2">
                          <Label htmlFor="baseUrl">API 地址（可选）</Label>
                          <Input
                            id="baseUrl"
                            value={apiConfig.baseUrl || ''}
                            onChange={(e) => setApiConfig(prev => prev ? { ...prev, baseUrl: e.target.value } : prev)}
                            placeholder={PROVIDER_INFO[apiConfig.provider]?.baseUrl}
                          />
                          <p className="text-xs text-muted-foreground">
                            使用默认地址可不填，如需代理请填写代理地址
                          </p>
                        </div>
                      )}
                    </>
                  )}

                  <Button onClick={handleSaveApiConfig} className="w-full bg-blue-600 hover:bg-blue-700">
                    保存配置
                  </Button>
                </div>
              )}
            </>
          )}
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
