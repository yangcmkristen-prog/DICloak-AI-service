import * as XLSX from 'xlsx';
import {
  FAQItem,
  TroubleshootingItem,
  OutOfScopeItem,
  MappingItem,
  FunctionKnowledge,
  TermItem,
  KnowledgeBase,
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
  return str.split(/[,，\s;；]+/).map(s => s.trim()).filter(Boolean);
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

// 调试函数：打印 sheet 的所有列名
function debugSheetColumns(data: Record<string, CellValue>[], sheetName: string) {
  if (data.length > 0) {
    console.log(`[EXCEL DEBUG] ${sheetName} 的列名:`, Object.keys(data[0]));
  }
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
        termCN: getCellValue(row['中文']),        // 修复：列名是 中文
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

// 从 Sheet 名称推断类型
function inferSheetType(sheetName: string): string {
  const name = sheetName.toLowerCase();
  if (name.includes('feature_faq')) return 'feature_faq';
  if (name.includes('user_routing')) return 'user_routing';
  if (name.includes('troubleshoot')) return 'troubleshooting';
  if (name.includes('out_of_scope') || name.includes('outofscope')) return 'out_of_scope';
  if (name.includes('mapping') || name.includes('map')) return 'mapping';
  if (name.includes('功能知识库') || name.includes('function')) return 'function_knowledge';
  // Sheet1 可能是术语库
  if (name === 'sheet1' || name.includes('术语库') || name.includes('term')) return 'term';
  return 'unknown';
}

// 导入结果类型
export interface ImportResult {
  success: boolean;
  message: string;
  stats: {
    faqCount: number;
    troubleshootingCount: number;
    outOfScopeCount: number;
    mappingCount: number;
    functionCount: number;
    termCount: number;
  };
  data?: Partial<KnowledgeBase>;
}

// 导入单个 Excel 文件
export async function importExcelFile(file: File): Promise<ImportResult> {
  try {
    const workbook = await readExcelFile(file);
    const sheetNames = workbook.SheetNames;

    const result: Partial<KnowledgeBase> = {
      faqItems: [],
      troubleshootingItems: [],
      outOfScopeItems: [],
      mappingItems: [],
      functionKnowledge: [],
      termItems: [],
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
          const faqItems = parseFAQSheet(sheet, sheetType);
          result.faqItems!.push(...faqItems);
          break;
        case 'troubleshooting':
          const troubleshootItems = parseTroubleshootingSheet(sheet);
          result.troubleshootingItems!.push(...troubleshootItems);
          break;
        case 'out_of_scope':
          const outOfScopeItems = parseOutOfScopeSheet(sheet);
          result.outOfScopeItems!.push(...outOfScopeItems);
          break;
        case 'mapping':
          const mappingItems = parseMappingSheet(sheet);
          result.mappingItems!.push(...mappingItems);
          break;
        case 'function_knowledge':
          const functionItems = parseFunctionKnowledgeSheet(sheet);
          result.functionKnowledge!.push(...functionItems);
          break;
        case 'term':
          const termItems = parseTermSheet(sheet);
          result.termItems!.push(...termItems);
          break;
        default:
          // 尝试通用解析
          console.log(`未识别的 Sheet 类型: ${sheetName}`);
      }
    }

    const totalCount = 
      result.faqItems!.length +
      result.troubleshootingItems!.length +
      result.outOfScopeItems!.length +
      result.mappingItems!.length +
      result.functionKnowledge!.length +
      result.termItems!.length;

    return {
      success: true,
      message: `成功解析 ${sheetNames.length} 个工作表，共 ${totalCount} 条记录`,
      stats: {
        faqCount: result.faqItems!.length,
        troubleshootingCount: result.troubleshootingItems!.length,
        outOfScopeCount: result.outOfScopeItems!.length,
        mappingCount: result.mappingItems!.length,
        functionCount: result.functionKnowledge!.length,
        termCount: result.termItems!.length,
      },
      data: result,
    };
  } catch (error) {
    return {
      success: false,
      message: `导入失败: ${error instanceof Error ? error.message : '未知错误'}`,
      stats: {
        faqCount: 0,
        troubleshootingCount: 0,
        outOfScopeCount: 0,
        mappingCount: 0,
        functionCount: 0,
        termCount: 0,
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
    outOfScopeItems: [],
    mappingItems: [],
    functionKnowledge: [],
    termItems: [],
  };

  for (const file of files) {
    const result = await importExcelFile(file);
    results.push(result);
    
    if (result.success && result.data) {
      combinedData.faqItems!.push(...(result.data.faqItems || []));
      combinedData.troubleshootingItems!.push(...(result.data.troubleshootingItems || []));
      combinedData.outOfScopeItems!.push(...(result.data.outOfScopeItems || []));
      combinedData.mappingItems!.push(...(result.data.mappingItems || []));
      combinedData.functionKnowledge!.push(...(result.data.functionKnowledge || []));
      combinedData.termItems!.push(...(result.data.termItems || []));
    }
  }

  const totalStats = {
    faqCount: combinedData.faqItems!.length,
    troubleshootingCount: combinedData.troubleshootingItems!.length,
    outOfScopeCount: combinedData.outOfScopeItems!.length,
    mappingCount: combinedData.mappingItems!.length,
    functionCount: combinedData.functionKnowledge!.length,
    termCount: combinedData.termItems!.length,
  };

  return {
    success: results.every(r => r.success),
    totalStats,
    results,
  };
}
