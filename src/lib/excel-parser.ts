import * as XLSX from 'xlsx';
import {
  FAQItem,
  TroubleshootingItem,
  TroubleshootingFlowItem,
  OutOfScopeItem,
  MappingItem,
  FunctionKnowledge,
  TermItem,
  KnowledgeBase,
  ApiEndpoint,
  ApiParameter,
  PricingPlan,
  PricingRawTable,
  generateId,
} from './types';

// Excel 单元格值类型
type CellValue = string | number | boolean | null | undefined;

// 安全获取单元格值
function getCellValue(cell: CellValue): string {
  if (cell === null || cell === undefined) return '';
  return String(cell).trim();
}

// 安全获取数值
function getNumericValue(cell: CellValue): number | undefined {
  if (typeof cell === 'number') return cell;
  if (typeof cell === 'string') {
    const num = parseFloat(cell);
    return isNaN(num) ? undefined : num;
  }
  return undefined;
}

// 解析标签（逗号或分号分隔）
function parseTags(value: CellValue): string[] {
  const str = getCellValue(value);
  if (!str) return [];
  return str.split(/[,，;；]/).map(s => s.trim()).filter(Boolean);
}

// 通用 Excel 读取函数
function readExcelFile(file: File): Promise<XLSX.WorkBook> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        resolve(workbook);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsArrayBuffer(file);
  });
}

// 解析术语ID列表（支持逗号、空格、分号分隔）
function parseTermIds(value: CellValue): string[] {
  const str = getCellValue(value);
  if (!str) return [];
  // 支持中文逗号、中文顿号、英文逗号、分号、空格分隔
  return str.split(/[,，、\s;；]+/).map(s => s.trim()).filter(Boolean);
}

// 解析 FAQ 基础字段（feature_faq, user_routing, troubleshooting）
function parseFAQBase(row: Record<string, CellValue>): Partial<FAQItem> {
  return {
    category1: getCellValue(row['一级分类']),
    category2: getCellValue(row['二级分类']),
    tags: parseTags(row['标签']),
    termIds: parseTermIds(row['term_id']),  // 修复：列名是 term_id
    questionCN: getCellValue(row['标准问题（中文）']),
    questionEN: getCellValue(row['标准问题（英文）']),
    userPhrases: getCellValue(row['用户问法']),
    answer: getCellValue(row['标准答案']) || getCellValue(row['标准答案（通用）']) || '',
    functionId: getCellValue(row['关联功能ID']),
    priority: getNumericValue(row['优先级']),
    faqId: getCellValue(row['FAQ_ID']),
  };
}

// 解析 feature_faq / user_routing
function parseFAQSheet(sheet: XLSX.WorkSheet, source: 'feature_faq' | 'user_routing'): FAQItem[] {
  const data = XLSX.utils.sheet_to_json<Record<string, CellValue>>(sheet, { defval: '' });
  return data
    .filter(row => getCellValue(row['标准问题（中文）']) || getCellValue(row['FAQ_ID']))
    .map(row => ({
      id: generateId(),
      source,
      ...parseFAQBase(row),
    })) as FAQItem[];
}

// 解析 troubleshooting
function parseTroubleshootingSheet(sheet: XLSX.WorkSheet): TroubleshootingItem[] {
  const data = XLSX.utils.sheet_to_json<Record<string, CellValue>>(sheet, { defval: '' });
  return data
    .filter(row => getCellValue(row['标准问题（中文）']) || getCellValue(row['FAQ_ID']))
    .map(row => {
      const base = parseFAQBase(row);
      return {
        id: generateId(),
        source: 'troubleshooting' as const,
        category1: base.category1 || '',
        category2: base.category2 || '',
        tags: base.tags || [],
        termIds: base.termIds || [],
        questionCN: base.questionCN || '',
        questionEN: base.questionEN || '',
        userPhrases: base.userPhrases || '',
        answer: base.answer || '',
        functionId: base.functionId,
        priority: base.priority,
        faqId: base.faqId || '',
        answerClient: getCellValue(row['标准答案（client）']),
        answerEndUser: getCellValue(row['标准答案（end_user）']),
      };
    });
}

function parseTroubleshootingFlowSheet(sheet: XLSX.WorkSheet): TroubleshootingFlowItem[] {
  const data = XLSX.utils.sheet_to_json<Record<string, CellValue>>(sheet, { defval: '' });
  const validNodeTypes = new Set<TroubleshootingFlowItem['nodeType']>(['question', 'solution', 'diagnosis', 'handoff', 'message']);

  return data.flatMap((row): TroubleshootingFlowItem[] => {
    const flowId = getCellValue(row['FLOW_ID']);
    const nodeId = getCellValue(row['NODE_ID']);
    const rawNodeType = getCellValue(row['NODE_TYPE']).toLowerCase();
    if (!flowId || !nodeId || !validNodeTypes.has(rawNodeType as TroubleshootingFlowItem['nodeType'])) return [];

    const enabledValue = getCellValue(row['是否启用']).toLowerCase();
    return [{
      id: generateId(),
      flowId,
      flowName: getCellValue(row['FLOW_NAME']),
      questionCN: getCellValue(row['标准问题（中文）']),
      userPhrases: getCellValue(row['用户问法']),
      tags: parseTags(row['标签']),
      enabled: !['否', 'false', '0', 'no', 'disabled'].includes(enabledValue),
      nodeId,
      nodeName: getCellValue(row['NODE_NAME']),
      nodeType: rawNodeType as TroubleshootingFlowItem['nodeType'],
      prerequisites: getCellValue(row['PREREQUISITES']),
      question: getCellValue(row['QUESTION']),
      collectField: getCellValue(row['COLLECT_FIELD']),
      matchValue: getCellValue(row['MATCH_VALUE']),
      matchKeywords: getCellValue(row['MATCH_KEYWORDS']),
      nextNodeId: getCellValue(row['NEXT_NODE_ID']),
      solution: getCellValue(row['SOLUTION']),
    }];
  });
}

// 解析 out_of_scope
function parseOutOfScopeSheet(sheet: XLSX.WorkSheet): OutOfScopeItem[] {
  const data = XLSX.utils.sheet_to_json<Record<string, CellValue>>(sheet, { defval: '' });
  return data
    .filter(row => getCellValue(row['标准问题（中文）']) || getCellValue(row['FAQ_ID']))
    .map(row => ({
      id: generateId(),
      source: 'out_of_scope' as const,
      category1: getCellValue(row['一级分类']),
      category2: getCellValue(row['二级分类']),
      tags: parseTags(row['标签（Tags）']),
      termIds: parseTermIds(row['术语ID']).concat(parseTermIds(row['涉及术语'])),
      questionCN: getCellValue(row['标准问题（中文）']),
      questionEN: getCellValue(row['标准问题（英文）']),
      userPhrases: '',
      answer: getCellValue(row['标准答案（英文）']) || '',
      functionId: undefined,
      priority: getNumericValue(row['优先级']),
      faqId: getCellValue(row['FAQ_ID']),
      subType: getCellValue(row['sub_type']),
      matchRule: getCellValue(row['匹配规则']),
    }));
}

// 解析 mapping
function parseMappingSheet(sheet: XLSX.WorkSheet): MappingItem[] {
  const data = XLSX.utils.sheet_to_json<Record<string, CellValue>>(sheet, { defval: '' });
  return data
    .filter(row => getCellValue(row['mapping二级分类']))
    .map(row => ({
      id: generateId(),
      category2: getCellValue(row['mapping二级分类']),
      abbreviation: getCellValue(row['缩写']),
      tags: parseTags(row['标签（Tags）']),
      keywordsEN: getCellValue(row['英文关键词']),
      scenarioTag: getCellValue(row['场景标签']),
      roleScope: getCellValue(row['role_scope']),
      domainKeywords: getCellValue(row['domain_keywords']),
    }));
}

// 解析功能知识库
function parseFunctionKnowledgeSheet(sheet: XLSX.WorkSheet): FunctionKnowledge[] {
  const data = XLSX.utils.sheet_to_json<Record<string, CellValue>>(sheet, { defval: '' });
  return data
    .filter(row => getCellValue(row['function_id']) || getCellValue(row['功能点名称']))
    .map(row => ({
      id: generateId(),
      functionId: getCellValue(row['function_id']),
      module1: getCellValue(row['一级模块']),
      pageName: getCellValue(row['页面名称']),
      functionType: getCellValue(row['功能类型']),
      functionName: getCellValue(row['功能点名称']),
      description: getCellValue(row['功能说明']),
      entryPath: getCellValue(row['入口路径']),
      uiPosition: getCellValue(row['界面位置']),
      prerequisites: getCellValue(row['前置条件']),
      steps: getCellValue(row['操作步骤']),
      faqIds: getCellValue(row['常见问题FAQ_ID']),
      keywordsCN: getCellValue(row['关键词（中文）']),
      keywordsEN: getCellValue(row['关键词（英文）']),
    }));
}

// 解析术语库
function parseTermSheet(sheet: XLSX.WorkSheet): TermItem[] {
  const data = XLSX.utils.sheet_to_json<Record<string, CellValue>>(sheet, { defval: '' });
  return data
    .filter(row => getCellValue(row['term_id']) || getCellValue(row['中文术语']))
    .map(row => {
      // is_ui_visible 可能是数字 1/0 或字符串 'TRUE'/'FALSE'
      const isVisibleRaw = row['is_ui_visible'];
      let isVisible = false;
      if (typeof isVisibleRaw === 'number') {
        isVisible = isVisibleRaw === 1;
      } else if (typeof isVisibleRaw === 'string') {
        isVisible = isVisibleRaw === '1' || isVisibleRaw.toUpperCase() === 'TRUE';
      } else if (typeof isVisibleRaw === 'boolean') {
        isVisible = isVisibleRaw;
      }
      return {
        id: generateId(),
        termId: getCellValue(row['term_id']),
        module1: getCellValue(row['一级模块']),
        module2: getCellValue(row['二级模块']),
        termCN: getCellValue(row['中文']),             // 中文列（新版术语库）
        termEN: getCellValue(row['英文']),           // 列名是 英文
        termRU: getCellValue(row['俄语']),
        termPT: getCellValue(row['葡萄牙语（巴西）']),
        termES: getCellValue(row['西班牙语']),
        termVI: getCellValue(row['越南语']),
        termType: getCellValue(row['术语类型']),
        definition: getCellValue(row['定义说明']),
        isUiVisible: isVisible,
      };
    });
}

// 解析 API 端点表
function parseApiEndpointSheet(sheet: XLSX.WorkSheet): ApiEndpoint[] {
  const data = XLSX.utils.sheet_to_json<Record<string, CellValue>>(sheet, { defval: '' });
  return data
    .filter(row => getCellValue(row['api_id']) || getCellValue(row['功能']))
    .map(row => ({
      id: generateId(),
      apiId: getCellValue(row['api_id']),
      apiName: getCellValue(row['功能']),
      apiType: getCellValue(row['API类型']) || 'HTTP API',
      method: getCellValue(row['请求方法']) || 'GET',
      endpoint: getCellValue(row['端点路径']),
      fullpathRule: getCellValue(row['完整路径规则']),
      authMethod: getCellValue(row['鉴权方式']),
      paramLocation: getCellValue(row['请求参数位置']),
      needsEnvId: getCellValue(row['是否需要env_id']),
      description: getCellValue(row['主要用途']),
      responseFields: getCellValue(row['成功响应核心字段']),
      remark: getCellValue(row['备注']),
      module: getCellValue(row['接口模块']),
      object: '', // 从功能中提取
      operation: '', // 从功能中提取
      isSupported: true,
    }));
}

// 解析 API 参数表
function parseApiParameterSheet(sheet: XLSX.WorkSheet): ApiParameter[] {
  const data = XLSX.utils.sheet_to_json<Record<string, CellValue>>(sheet, { defval: '' });
  return data
    .filter(row => getCellValue(row['参数名']) || getCellValue(row['api_id']))
    .map(row => ({
      id: generateId(),
      apiId: getCellValue(row['api_id']),
      apiType: getCellValue(row['API类型']),
      module: getCellValue(row['接口模块']),
      functionName: getCellValue(row['功能']),
      method: getCellValue(row['请求方法']),
      endpoint: getCellValue(row['端点路径']),
      paramLocation: getCellValue(row['参数位置']),
      paramName: getCellValue(row['参数名']),
      paramType: getCellValue(row['数据类型']) || 'string',
      isRequired: getCellValue(row['是否必填']) === '是' || getCellValue(row['是否必填']) === 'true',
      description: getCellValue(row['说明']),
      example: getCellValue(row['可选值/示例']),
      validationRule: getCellValue(row['适用场景']),
      remark: getCellValue(row['备注']),
    }));
}

// 解析价格功能表（功能对比表格式）
function parsePricingSheet(sheet: XLSX.WorkSheet): { plans: PricingPlan[]; rawTable: PricingRawTable } {
  const data = XLSX.utils.sheet_to_json<Record<string, CellValue>>(sheet, { defval: '' });
  
  // 提取套餐名称（从列名中获取）
  const columns = Object.keys(data[0] || {});
  const planColumns = columns.filter(col => col !== 'Features' && col.includes('/'));
  
  // 保存原始表格数据
  const rawTable: PricingRawTable = {
    columns: columns,
    rows: data.map(row => {
      const rowObj: Record<string, string> = {};
      columns.forEach(col => {
        rowObj[col] = String(row[col] ?? '');
      });
      return rowObj;
    }),
    lastUpdated: Date.now(),
  };
  
  // 为每个套餐创建一条记录
  const plans: PricingPlan[] = planColumns.map(planCol => {
    const [planName, planNameCN] = planCol.split('/');
    const features: string[] = [];
    
    // 收集该套餐支持功能
    data.forEach(row => {
      const featureName = getCellValue(row['Features']);
      const featureValue = row[planCol];
      if (featureName && featureValue !== undefined && featureValue !== '' && featureValue !== 0 && featureValue !== false) {
        features.push(featureName);
      }
    });
    
    return {
      id: generateId(),
      planName: planName || planCol,
      planNameCN: planNameCN || planCol,
      price: 0, // 价格信息需要从详细数据中提取
      priceUnit: '月',
      memberLimit: 0,
      environmentLimit: 0,
      profileLimit: 0,
      features,
      description: String(data.find(row => row['Features'] === 'profile count')?.[planCol] || ''),
    };
  });
  
  return { plans, rawTable };
}

// 从 Sheet 名称推断类型
function inferSheetType(sheetName: string): string {
  const name = sheetName.toLowerCase();
  if (name.includes('troubleshooting_flow') || name.includes('troubleshoot_flow')) return 'troubleshooting_flow';
  if (name.includes('feature_faq')) return 'feature_faq';
  if (name.includes('user_routing')) return 'user_routing';
  if (name.includes('troubleshoot')) return 'troubleshooting';
  if (name.includes('out_of_scope') || name.includes('outofscope')) return 'out_of_scope';
  if (name.includes('mapping') || name.includes('map')) return 'mapping';
  if (name.includes('功能知识库') || name.includes('function')) return 'function_knowledge';
  // API 端点表识别
  if (name.includes('api端点') || name.includes('api_endpoint') || name.includes('端点总表')) return 'api_endpoint';
  if (name.includes('api参数') || name.includes('api_parameter') || name.includes('参数明细')) return 'api_parameter';
  // 价格功能表识别
  if (name.includes('价格') || name.includes('pricing') || name.includes('套餐') || name.includes('功能对比')) return 'pricing';
  // Sheet1 可能是术语库或价格表
  if (name === 'sheet1') return 'sheet1';
  if (name.includes('术语库') || name.includes('term')) return 'term';
  return 'unknown';
}

// 导入结果类型
export interface ImportResult {
  success: boolean;
  message: string;
  fileName: string;  // 文件名
  fileType: 'faq' | 'term' | 'function' | 'api' | 'pricing';  // 文件类型
  stats: {
    faqCount: number;
    troubleshootingCount: number;
    troubleshootingFlowCount: number;
    outOfScopeCount: number;
    mappingCount: number;
    functionCount: number;
    termCount: number;
    apiEndpointCount: number;
    apiParameterCount: number;
    pricingPlanCount: number;
  };
  data?: Partial<KnowledgeBase>;
}

// 导入单个 Excel 文件
export async function importExcelFile(file: File): Promise<ImportResult> {
  try {
    const workbook = await readExcelFile(file);
    const sheetNames = workbook.SheetNames;

    // 使用确定存在的本地数组完成整个解析过程，避免可选的 Partial 字段在
    // 新增 Sheet 类型或热更新后的旧数据结构中出现 undefined.push/length。
    const faqItems: FAQItem[] = [];
    const troubleshootingItems: TroubleshootingItem[] = [];
    const troubleshootingFlowItems: TroubleshootingFlowItem[] = [];
    const outOfScopeItems: OutOfScopeItem[] = [];
    const mappingItems: MappingItem[] = [];
    const functionKnowledge: FunctionKnowledge[] = [];
    const termItems: TermItem[] = [];
    const apiEndpoints: ApiEndpoint[] = [];
    const apiParameters: ApiParameter[] = [];
    const pricingPlans: PricingPlan[] = [];

    const result: Partial<KnowledgeBase> = {
      faqItems,
      troubleshootingItems,
      troubleshootingFlowItems,
      outOfScopeItems,
      mappingItems,
      functionKnowledge,
      termItems,
      apiEndpoints,
      apiParameters,
      pricingPlans,
    };

    for (const sheetName of sheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const sheetType = inferSheetType(sheetName);
      
      // 调试：打印每个 sheet 的列名
      const sheetData = XLSX.utils.sheet_to_json<Record<string, CellValue>>(sheet, { defval: '' });
      if (sheetData.length > 0) {
        console.log(`[EXCEL DEBUG] Sheet "${sheetName}" (类型: ${sheetType}) 的列名:`, Object.keys(sheetData[0]));
      }

      switch (sheetType) {
        case 'feature_faq':
        case 'user_routing':
          faqItems.push(...parseFAQSheet(sheet, sheetType));
          break;
        case 'troubleshooting':
          troubleshootingItems.push(...parseTroubleshootingSheet(sheet));
          break;
        case 'troubleshooting_flow':
          troubleshootingFlowItems.push(...parseTroubleshootingFlowSheet(sheet));
          break;
        case 'out_of_scope':
          outOfScopeItems.push(...parseOutOfScopeSheet(sheet));
          break;
        case 'mapping':
          mappingItems.push(...parseMappingSheet(sheet));
          break;
        case 'function_knowledge':
          functionKnowledge.push(...parseFunctionKnowledgeSheet(sheet));
          break;
        case 'term':
          termItems.push(...parseTermSheet(sheet));
          break;
        case 'api_endpoint':
          apiEndpoints.push(...parseApiEndpointSheet(sheet));
          break;
        case 'api_parameter':
          apiParameters.push(...parseApiParameterSheet(sheet));
          break;
        case 'pricing':
          const pricingResult = parsePricingSheet(sheet);
          pricingPlans.push(...pricingResult.plans);
          result.pricingRawTable = pricingResult.rawTable;
          break;
        case 'sheet1':
          // Sheet1 需要自动检测类型
          if (sheetData.length > 0) {
            const columns = Object.keys(sheetData[0]);
            // 如果有 Features 列和套餐列（包含 '/'），则是价格功能表
            if (columns.includes('Features') && columns.some(col => col.includes('/'))) {
              console.log('[EXCEL DEBUG] Sheet1 检测为价格功能表');
              const sheet1PricingResult = parsePricingSheet(sheet);
              pricingPlans.push(...sheet1PricingResult.plans);
              result.pricingRawTable = sheet1PricingResult.rawTable;
            }
            // 如果有 term_id 或 中文/英文 列，则是术语库
            else if (columns.includes('term_id') || (columns.includes('中文') && columns.includes('英文'))) {
              console.log('[EXCEL DEBUG] Sheet1 检测为术语库');
              termItems.push(...parseTermSheet(sheet));
            } else {
              console.log('[EXCEL DEBUG] Sheet1 类型未识别，列名:', columns);
            }
          }
          break;
        default:
          // 尝试通用解析
          console.log(`未识别的 Sheet 类型: ${sheetName}`);
      }
    }

    const totalCount = 
      faqItems.length +
      troubleshootingItems.length +
      troubleshootingFlowItems.length +
      outOfScopeItems.length +
      mappingItems.length +
      functionKnowledge.length +
      termItems.length +
      apiEndpoints.length +
      apiParameters.length +
      pricingPlans.length;

    // 判断文件类型：优先根据实际解析出的内容判断，避免 FAQ 文件因 Sheet1/术语页被误归类
    let fileType: 'faq' | 'term' | 'function' | 'api' | 'pricing' = 'faq';
    if (faqItems.length > 0 || troubleshootingItems.length > 0 || troubleshootingFlowItems.length > 0 || outOfScopeItems.length > 0 || mappingItems.length > 0) {
      fileType = 'faq';
    } else if (apiEndpoints.length > 0 || apiParameters.length > 0) {
      fileType = 'api';
    } else if (pricingPlans.length > 0) {
      fileType = 'pricing';
    } else if (functionKnowledge.length > 0) {
      fileType = 'function';
    } else if (termItems.length > 0) {
      fileType = 'term';
    }

    return {
      success: true,
      message: `成功解析 ${sheetNames.length} 个工作表，共 ${totalCount} 条记录`,
      fileName: file.name,
      fileType,
      stats: {
        faqCount: faqItems.length,
        troubleshootingCount: troubleshootingItems.length,
        troubleshootingFlowCount: troubleshootingFlowItems.length,
        outOfScopeCount: outOfScopeItems.length,
        mappingCount: mappingItems.length,
        functionCount: functionKnowledge.length,
        termCount: termItems.length,
        apiEndpointCount: apiEndpoints.length,
        apiParameterCount: apiParameters.length,
        pricingPlanCount: pricingPlans.length,
      },
      data: result,
    };
  } catch (error) {
    return {
      success: false,
      message: `导入失败: ${error instanceof Error ? error.message : '未知错误'}`,
      fileName: file.name,
      fileType: 'faq',
      stats: {
        faqCount: 0,
        troubleshootingCount: 0,
        troubleshootingFlowCount: 0,
        outOfScopeCount: 0,
        mappingCount: 0,
        functionCount: 0,
        termCount: 0,
        apiEndpointCount: 0,
        apiParameterCount: 0,
        pricingPlanCount: 0,
      },
    };
  }
}

// 导入多个 Excel 文件
export async function importMultipleExcelFiles(files: File[]): Promise<{
  success: boolean;
  totalStats: ImportResult['stats'];
  results: ImportResult[];
}> {
  const results: ImportResult[] = [];
  const combinedData: Partial<KnowledgeBase> = {
    faqItems: [],
    troubleshootingItems: [],
    troubleshootingFlowItems: [],
    outOfScopeItems: [],
    mappingItems: [],
    functionKnowledge: [],
    termItems: [],
    apiEndpoints: [],
    apiParameters: [],
    pricingPlans: [],
  };

  for (const file of files) {
    const result = await importExcelFile(file);
    results.push(result);
    
    if (result.success && result.data) {
      combinedData.faqItems!.push(...(result.data.faqItems || []));
      combinedData.troubleshootingItems!.push(...(result.data.troubleshootingItems || []));
      combinedData.troubleshootingFlowItems!.push(...(result.data.troubleshootingFlowItems || []));
      combinedData.outOfScopeItems!.push(...(result.data.outOfScopeItems || []));
      combinedData.mappingItems!.push(...(result.data.mappingItems || []));
      combinedData.functionKnowledge!.push(...(result.data.functionKnowledge || []));
      combinedData.termItems!.push(...(result.data.termItems || []));
      combinedData.apiEndpoints!.push(...(result.data.apiEndpoints || []));
      combinedData.apiParameters!.push(...(result.data.apiParameters || []));
      combinedData.pricingPlans!.push(...(result.data.pricingPlans || []));
    }
  }

  const totalStats = {
    faqCount: combinedData.faqItems!.length,
    troubleshootingCount: combinedData.troubleshootingItems!.length,
    troubleshootingFlowCount: combinedData.troubleshootingFlowItems!.length,
    outOfScopeCount: combinedData.outOfScopeItems!.length,
    mappingCount: combinedData.mappingItems!.length,
    functionCount: combinedData.functionKnowledge!.length,
    termCount: combinedData.termItems!.length,
    apiEndpointCount: combinedData.apiEndpoints!.length,
    apiParameterCount: combinedData.apiParameters!.length,
    pricingPlanCount: combinedData.pricingPlans!.length,
  };

  return {
    success: results.every(r => r.success),
    totalStats,
    results,
  };
}
