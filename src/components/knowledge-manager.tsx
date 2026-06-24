"use client";

import { useState, useEffect, useCallback } from "react";
import { Upload, FileSpreadsheet, Trash2, CheckCircle, XCircle, Settings, AlertCircle, Loader2, Cloud } from "lucide-react";
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
import { DEFAULT_API_CONFIG, DEFAULT_SYSTEM_PROMPT, getKnowledgeStats, replaceKnowledgeData, getApiConfig, saveApiConfig, MODEL_OPTIONS, PROVIDER_INFO, saveKnowledgeBase } from "@/lib/store";
import { importExcelFile, ImportResult } from "@/lib/excel-parser";
import { KnowledgeBase, ApiConfig } from "@/lib/types";
import { toast } from "sonner";

interface KnowledgeManagerProps {
  onPromptChange?: (prompt: string) => void;
}

type KnowledgeFileNames = NonNullable<KnowledgeBase["fileNames"]>;
type ModelOption = (typeof MODEL_OPTIONS)[number];

function getModelOptionsForProvider(provider: string): ModelOption[] {
  const normalizedProvider = provider.trim().toLowerCase();
  const options = MODEL_OPTIONS.filter((option) => option.provider === provider || option.provider === normalizedProvider);
  if (options.length > 0) return options;

  if (normalizedProvider === 'aliyun' || normalizedProvider === 'bailian' || provider.includes('百炼')) {
    return [{ value: 'qwen-mt-flash', label: 'Qwen MT Flash（翻译）', provider: 'aliyun' }];
  }

  return [];
}

function getSelectableModelValue(provider: string, model: string): string {
  const options = getModelOptionsForProvider(provider);
  if (options.length === 0) return model;
  return options.some((option) => option.value === model) ? model : options[0].value;
}

function withSelectableModel(config: ApiConfig): ApiConfig {
  return {
    ...config,
    model: getSelectableModelValue(config.provider, config.model),
  };
}

function mergeFileNames(existing: KnowledgeFileNames | undefined, next: KnowledgeFileNames | undefined): KnowledgeFileNames {
  const allFiles = Array.from(new Set([
    ...(existing?.allFiles || []),
    ...(next?.allFiles || []),
    ...[
      existing?.faqFile,
      existing?.termFile,
      existing?.functionFile,
      existing?.apiFile,
      existing?.pricingFile,
      next?.faqFile,
      next?.termFile,
      next?.functionFile,
      next?.apiFile,
      next?.pricingFile,
    ].filter((fileName): fileName is string => Boolean(fileName)),
  ]));

  return {
    faqFile: next?.faqFile || existing?.faqFile,
    termFile: next?.termFile || existing?.termFile,
    functionFile: next?.functionFile || existing?.functionFile,
    apiFile: next?.apiFile || existing?.apiFile,
    pricingFile: next?.pricingFile || existing?.pricingFile,
    allFiles,
  };
}

export function KnowledgeManager({ onPromptChange }: KnowledgeManagerProps) {
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [tempPrompt, setTempPrompt] = useState("");
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importResults, setImportResults] = useState<ImportResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [stats, setStats] = useState<{
    faqCount: number;
    troubleshootingCount: number;
    outOfScopeCount: number;
    mappingCount: number;
    functionCount: number;
    termCount: number;
    apiEndpointCount: number;
    apiParameterCount: number;
    pricingPlanCount: number;
    lastUpdated: number;
    fileNames: KnowledgeFileNames;
  }>({
    faqCount: 0,
    troubleshootingCount: 0,
    outOfScopeCount: 0,
    mappingCount: 0,
    functionCount: 0,
    termCount: 0,
    apiEndpointCount: 0,
    apiParameterCount: 0,
    pricingPlanCount: 0,
    lastUpdated: 0,
    fileNames: {
      faqFile: undefined,
      termFile: undefined,
      functionFile: undefined,
      apiFile: undefined,
      pricingFile: undefined,
      allFiles: [],
    },
  });

  // API 配置状态 - 初始为 null，避免 SSR/CSR mismatch
  const [apiConfig, setApiConfig] = useState<ApiConfig | null>(null);
  const [showApiConfig, setShowApiConfig] = useState(false);
  const [extensionTranslateApiConfig, setExtensionTranslateApiConfig] = useState<ApiConfig | null>(null);
  const [showExtensionTranslateConfig, setShowExtensionTranslateConfig] = useState(false);
  // 自定义 HTTP 配置
  const [customEndpoint, setCustomEndpoint] = useState("");
  const [customModelName, setCustomModelName] = useState("");
  const [extensionCustomEndpoint, setExtensionCustomEndpoint] = useState("");
  const [extensionCustomModelName, setExtensionCustomModelName] = useState("");
  // 同步状态
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  // Prompt 版本信息
  const [promptVersion, setPromptVersion] = useState<number | null>(null);
  const [promptUpdatedAt, setPromptUpdatedAt] = useState<string | null>(null);

  // 加载数据 - 从数据库和 localStorage 同步
  useEffect(() => {
    if (typeof window !== "undefined") {
      // 从数据库加载配置
      loadFromDatabase();
    }
    // 仅在组件挂载时从数据库同步一次，避免 updateStats 状态更新触发重复请求
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        // 更新 UI 状态（包括文件名）
        updateStats(kb.fileNames);
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
        // 设置版本信息
        if (config.version !== undefined) {
          setPromptVersion(config.version);
        }
        if (config.updatedAt) {
          setPromptUpdatedAt(config.updatedAt);
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
        if (config.extensionTranslateApiConfig) {
          setExtensionTranslateApiConfig(config.extensionTranslateApiConfig);
          localStorage.setItem("diclok_extension_translate_api_config", JSON.stringify(config.extensionTranslateApiConfig));
          if (config.extensionTranslateApiConfig.customConfig) {
            setExtensionCustomEndpoint(config.extensionTranslateApiConfig.customConfig.endpoint || "");
            setExtensionCustomModelName(config.extensionTranslateApiConfig.customConfig.modelName || "");
          }
        } else {
          const savedExtensionConfig = localStorage.getItem("diclok_extension_translate_api_config");
          setExtensionTranslateApiConfig(savedExtensionConfig ? JSON.parse(savedExtensionConfig) : { ...DEFAULT_API_CONFIG });
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
        const savedExtensionConfig = localStorage.getItem("diclok_extension_translate_api_config");
        setExtensionTranslateApiConfig(savedExtensionConfig ? JSON.parse(savedExtensionConfig) : { ...DEFAULT_API_CONFIG });
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
      const savedExtensionConfig = localStorage.getItem("diclok_extension_translate_api_config");
      setExtensionTranslateApiConfig(savedExtensionConfig ? JSON.parse(savedExtensionConfig) : { ...DEFAULT_API_CONFIG });
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
  const syncSystemConfigToDatabase = async (
    prompt: string,
    apiCfg: ApiConfig | null,
    extensionTranslateCfg: ApiConfig | null = extensionTranslateApiConfig,
  ) => {
    try {
      const response = await fetch('/api/config/system', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemPrompt: prompt,
          apiConfig: apiCfg,
          extensionTranslateApiConfig: extensionTranslateCfg,
        }),
      });
      if (!response.ok) {
        console.error('同步系统配置到数据库失败');
        return null;
      }
      const data = await response.json();
      // 更新版本号状态
      if (data.version !== undefined) {
        setPromptVersion(data.version);
      }
      return data;
    } catch (error) {
      console.error('同步系统配置到数据库失败:', error);
      return null;
    }
  };

  const updateStats = useCallback((fileNames?: KnowledgeFileNames) => {
    const currentStats = getKnowledgeStats();
    currentStats.fileNames = mergeFileNames(currentStats.fileNames, fileNames);
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
          apiEndpoints: [],
          apiParameters: [],
          pricingPlans: [],
          pricingRawTable: undefined,
          fileNames: {
            faqFile: '',
            termFile: '',
            functionFile: '',
            apiFile: '',
            pricingFile: '',
            allFiles: [],
          },
        };

        for (const result of successResults) {
          if (result.data) {
            combinedData.faqItems!.push(...(result.data.faqItems || []));
            combinedData.troubleshootingItems!.push(...(result.data.troubleshootingItems || []));
            combinedData.outOfScopeItems!.push(...(result.data.outOfScopeItems || []));
            combinedData.mappingItems!.push(...(result.data.mappingItems || []));
            combinedData.functionKnowledge!.push(...(result.data.functionKnowledge || []));
            combinedData.termItems!.push(...(result.data.termItems || []));
            combinedData.apiEndpoints!.push(...(result.data.apiEndpoints || []));
            combinedData.apiParameters!.push(...(result.data.apiParameters || []));
            combinedData.pricingPlans!.push(...(result.data.pricingPlans || []));
            // 处理 pricingRawTable（覆盖而非合并）
            if (result.data.pricingRawTable) {
              combinedData.pricingRawTable = result.data.pricingRawTable;
            }
          }
          // 记录文件名
          if (result.fileName) {
            combinedData.fileNames!.allFiles = Array.from(new Set([
              ...(combinedData.fileNames!.allFiles || []),
              result.fileName,
            ]));
            if (result.fileType === 'faq') {
              combinedData.fileNames!.faqFile = result.fileName;
            } else if (result.fileType === 'term') {
              combinedData.fileNames!.termFile = result.fileName;
            } else if (result.fileType === 'function') {
              combinedData.fileNames!.functionFile = result.fileName;
            } else if (result.fileType === 'api') {
              combinedData.fileNames!.apiFile = result.fileName;
            } else if (result.fileType === 'pricing') {
              combinedData.fileNames!.pricingFile = result.fileName;
            }
          }
        }

        replaceKnowledgeData(combinedData as unknown as Record<string, unknown>);
        // 同步到数据库，等待完成后再切换标签页
        const syncSuccess = await syncKnowledgeToDatabase(combinedData as KnowledgeBase);
        updateStats(combinedData.fileNames);
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
        apiEndpoints: [],
        apiParameters: [],
        pricingPlans: [],
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
          headers: {
            "Content-Type": "application/json",
            ...(apiConfig.apiKey ? { "Authorization": `Bearer ${apiConfig.apiKey}` } : {}),
          },
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

  const handleSaveExtensionTranslateApiConfig = async () => {
    if (!extensionTranslateApiConfig) return;

    const configToSave: ApiConfig = extensionTranslateApiConfig.provider === 'custom'
      ? {
          ...extensionTranslateApiConfig,
          customConfig: {
            endpoint: extensionCustomEndpoint,
            modelName: extensionCustomModelName,
            headers: {
              "Content-Type": "application/json",
              ...(extensionTranslateApiConfig.apiKey ? { "Authorization": `Bearer ${extensionTranslateApiConfig.apiKey}` } : {}),
            },
          },
        }
      : withSelectableModel(extensionTranslateApiConfig);

    setExtensionTranslateApiConfig(configToSave);
    localStorage.setItem("diclok_extension_translate_api_config", JSON.stringify(configToSave));
    await syncSystemConfigToDatabase(systemPrompt, apiConfig, configToSave);
    toast.success("扩展翻译模型配置已保存");
    setShowExtensionTranslateConfig(false);
  };

  // 处理 provider 切换
  const handleProviderChange = (provider: ApiConfig['provider']) => {
    if (!apiConfig) return;
    const providerInfo = PROVIDER_INFO[provider];
    const nextModel = getSelectableModelValue(provider, providerInfo.defaultModel);
    setApiConfig(prev => prev ? {
      ...prev,
      provider,
      model: nextModel,
      baseUrl: providerInfo.baseUrl,
    } : null);
  };

  const handleExtensionTranslateProviderChange = (provider: ApiConfig['provider']) => {
    if (!extensionTranslateApiConfig) return;
    const providerInfo = PROVIDER_INFO[provider];
    const nextModel = getSelectableModelValue(provider, providerInfo.defaultModel);
    setExtensionTranslateApiConfig(prev => prev ? {
      ...prev,
      provider,
      model: nextModel,
      baseUrl: providerInfo.baseUrl,
    } : null);
  };

  const totalItems = stats.faqCount + stats.troubleshootingCount + stats.outOfScopeCount + 
                     stats.mappingCount + stats.functionCount + stats.termCount +
                     stats.apiEndpointCount + stats.apiParameterCount + stats.pricingPlanCount;

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
                        {result.stats.apiEndpointCount > 0 && <span>API端点: {result.stats.apiEndpointCount}</span>}
                        {result.stats.apiParameterCount > 0 && <span>API参数: {result.stats.apiParameterCount}</span>}
                        {result.stats.pricingPlanCount > 0 && <span>套餐: {result.stats.pricingPlanCount}</span>}
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
                <StatCard label="FAQ" count={stats.faqCount} color="blue" />
                <StatCard label="排障问题" count={stats.troubleshootingCount} color="orange" />
                <StatCard label="超范围问题" count={stats.outOfScopeCount} color="gray" />
                <StatCard label="问题映射" count={stats.mappingCount} color="purple" />
                <StatCard label="功能知识" count={stats.functionCount} color="green" />
                <StatCard label="术语库" count={stats.termCount} color="pink" />
                <StatCard label="API端点" count={stats.apiEndpointCount} color="cyan" />
                <StatCard label="API参数" count={stats.apiParameterCount} color="teal" />
                <StatCard label="价格套餐" count={stats.pricingPlanCount} color="amber" />
              </div>
              {/* 生效的表格文件 */}
              {(mergeFileNames(stats.fileNames, undefined).allFiles || []).length > 0 && (
                <div className="p-3 bg-muted/50 rounded-lg text-sm">
                  <div className="font-medium mb-2">当前生效的表格:</div>
                  <div className="space-y-1 text-muted-foreground">
                    {(mergeFileNames(stats.fileNames, undefined).allFiles || []).map((fileName) => (
                      <div key={fileName} className="flex items-center gap-2">
                        <FileSpreadsheet className="w-4 h-4 text-blue-500" />
                        <span className="truncate" title={fileName}>{fileName}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
          <CardDescription className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>设置 AI 客服助手的系统提示词，用于定义 AI 的角色和行为规范</span>
            {promptVersion !== null && (
              <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-2 py-0.5 rounded-full font-medium">
                v{promptVersion}
              </span>
            )}
            {promptUpdatedAt && (
              <span className="text-xs text-muted-foreground">
                更新于 {new Date(promptUpdatedAt).toLocaleString('zh-CN', { 
                  month: '2-digit', 
                  day: '2-digit', 
                  hour: '2-digit', 
                  minute: '2-digit' 
                })}
              </span>
            )}
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
                          value={getSelectableModelValue(apiConfig.provider, apiConfig.model)}
                          onChange={(e) => setApiConfig(prev => prev ? { ...prev, model: e.target.value } : prev)}
                          className="w-full p-2 rounded-md border border-input bg-background text-sm"
                        >
                          {getModelOptionsForProvider(apiConfig.provider).map(opt => (
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

      {/* 扩展翻译并清洗模型配置 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            扩展翻译模型配置
          </CardTitle>
          <CardDescription>
            仅用于 WhatsApp 扩展的“翻译并清洗”功能，不影响网页端回复生成，也不影响扩展“生成推荐回复”。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!extensionTranslateApiConfig ? (
            <div className="text-center py-4 text-muted-foreground">加载中...</div>
          ) : (
            <>
              <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm text-emerald-800 dark:text-emerald-200 font-medium mb-1">
                      当前扩展翻译配置
                    </p>
                    <p className="text-sm text-emerald-700 dark:text-emerald-300">
                      {PROVIDER_INFO[extensionTranslateApiConfig.provider]?.name || extensionTranslateApiConfig.provider} - {extensionTranslateApiConfig.model}
                      {!extensionTranslateApiConfig.apiKey && ' (未填写 API Key)'}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowExtensionTranslateConfig(!showExtensionTranslateConfig)}
                    className="shrink-0"
                  >
                    {showExtensionTranslateConfig ? "收起" : "配置"}
                  </Button>
                </div>
              </div>

              {showExtensionTranslateConfig && (
                <div className="space-y-4 border-t pt-4">
                  <div className="space-y-2">
                    <Label htmlFor="extensionTranslateProvider">AI 提供商</Label>
                    <select
                      id="extensionTranslateProvider"
                      value={extensionTranslateApiConfig.provider}
                      onChange={(e) => handleExtensionTranslateProviderChange(e.target.value as ApiConfig['provider'])}
                      className="w-full p-2 rounded-md border border-input bg-background text-sm"
                    >
                      {Object.entries(PROVIDER_INFO).map(([key, info]) => (
                        <option key={key} value={key}>{info.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="extensionTranslateModel">模型</Label>
                    <select
                      id="extensionTranslateModel"
                      value={getSelectableModelValue(extensionTranslateApiConfig.provider, extensionTranslateApiConfig.model)}
                      onChange={(e) => setExtensionTranslateApiConfig(prev => prev ? { ...prev, model: e.target.value } : prev)}
                      className="w-full p-2 rounded-md border border-input bg-background text-sm"
                    >
                      {getModelOptionsForProvider(extensionTranslateApiConfig.provider).map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="extensionTranslateApiKey">API Key</Label>
                    <Input
                      id="extensionTranslateApiKey"
                      type="password"
                      value={extensionTranslateApiConfig.apiKey}
                      onChange={(e) => setExtensionTranslateApiConfig(prev => prev ? { ...prev, apiKey: e.target.value } : prev)}
                      placeholder={PROVIDER_INFO[extensionTranslateApiConfig.provider]?.keyPlaceholder}
                    />
                    <p className="text-xs text-muted-foreground">
                      该 Key 只会用于扩展“翻译并清洗”接口的服务端调用，不会写入扩展程序包。
                    </p>
                  </div>

                  {extensionTranslateApiConfig.provider !== 'coze' && (
                    <div className="space-y-2">
                      <Label htmlFor="extensionTranslateBaseUrl">API 地址（可选）</Label>
                      <Input
                        id="extensionTranslateBaseUrl"
                        value={extensionTranslateApiConfig.baseUrl || ''}
                        onChange={(e) => setExtensionTranslateApiConfig(prev => prev ? { ...prev, baseUrl: e.target.value } : prev)}
                        placeholder={PROVIDER_INFO[extensionTranslateApiConfig.provider]?.baseUrl}
                      />
                      <p className="text-xs text-muted-foreground">
                        使用默认地址可不填，如需代理请填写代理地址。
                      </p>
                    </div>
                  )}

                  <Button onClick={handleSaveExtensionTranslateApiConfig} className="w-full bg-emerald-600 hover:bg-emerald-700">
                    保存扩展翻译配置
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
    cyan: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-300",
    teal: "bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-300",
    amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
  };

  return (
    <div className={`rounded-lg p-3 ${colorClasses[color]}`}>
      <p className="text-2xl font-bold">{count}</p>
      <p className="text-sm opacity-80">{label}</p>
    </div>
  );
}
