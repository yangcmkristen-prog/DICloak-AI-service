import {
  apiFamily, apiVersion, compact, createRecord, endpointKey, extractTextProtectedFields, normalizeProductScope,
  parseEnabled, protectedField, source, splitList, splitUtterances, text, unique, uniqueProtectedFields, valuesBody,
} from './utils.mjs';

function faqRecord({ values, row, file, sheet, version, type, answerColumns, questionEnglishColumn = '标准问题（英文）', utteranceColumn = '用户问法', defaultProducts = ['dicloak'] }) {
  const id = text(values.FAQ_ID);
  const answers = answerColumns.map((column) => [column, values[column]]).filter(([, value]) => text(value));
  const body = answers.length === 1 ? text(answers[0][1]) : valuesBody(answers);
  const functionIds = splitList(values.function_id ?? values['关联功能ID']);
  const termIds = splitList(values.term_id ?? values['术语ID']);
  return createRecord({
    id,
    type,
    productScope: normalizeProductScope(values['已支持产品'] ?? values['产品'], defaultProducts),
    enabled: parseEnabled(values['是否启用'], true),
    sourceLanguage: 'en',
    title: text(values['标准问题（英文）']) || text(values['标准问题（中文）']) || id,
    canonicalQuestions: [
      { language: 'zh', text: values['标准问题（中文）'] },
      { language: 'en', text: values[questionEnglishColumn] },
    ],
    utterances: splitUtterances(values[utteranceColumn]),
    body,
    termIds,
    tags: splitList(values['标签'] ?? values['标签（Tags）']),
    metadata: {
      category: text(values['一级分类']), subcategory: text(values['二级分类']), priority: text(values['优先级']),
      roleScope: text(values.role_scope), functionIds, originalPlaceholdersPreserved: true,
      ...(answers.length > 1 ? { answerVariants: Object.fromEntries(answers.map(([column, value]) => [column.includes('client') ? 'client' : column.includes('end_user') ? 'end_user' : 'general', text(value)])) } : {}),
      ...(text(values.sub_type) ? { subType: text(values.sub_type) } : {}),
      ...(text(values['匹配规则']) ? { matchRule: text(values['匹配规则']) } : {}),
      ...(text(values['场景标签']) ? { scene: text(values['场景标签']) } : {}),
    },
    protectedFields: uniqueProtectedFields(answers.flatMap(([column, value]) => extractTextProtectedFields(value, column))),
    source: source(file, sheet, row), knowledgeVersion: version,
  });
}

export function adaptFaqWorkbook({ workbook, file, version, warnings }) {
  const records = [];
  const specs = [
    ['feature_faq', 'faq', ['标准答案'], '用户问法', ['dicloak']],
    ['troubleshooting', 'troubleshooting', ['标准答案（通用）', '标准答案（client）', '标准答案（end_user）'], '用户问法（英文）', ['dicloak']],
    ['user_routing', 'user_routing', ['标准答案'], '用户问法', ['dicloak']],
    ['out_of_scope', 'out_of_scope', ['标准答案（英文）'], '英文关键词', ['dicloak', 'paraturbo']],
  ];
  for (const [sheet, type, answerColumns, utteranceColumn, defaultProducts] of specs) {
    const rows = workbook.rows(sheet);
    for (const entry of rows) {
      const record = faqRecord({ ...entry, file, sheet, version, type, answerColumns, utteranceColumn, defaultProducts });
      if (!record.id) warnings.push({ code: 'FAQ_ID_MISSING', message: 'FAQ 缺少稳定 ID', source: record.source });
      else records.push(record);
    }
  }
  const flowNodes = new Map();
  for (const entry of workbook.rows('troubleshooting_flow')) {
    const flowId = text(entry.values.FLOW_ID);
    const nodeId = text(entry.values.NODE_ID);
    const key = `${flowId}\u0000${nodeId}`;
    flowNodes.set(key, [...(flowNodes.get(key) ?? []), entry]);
  }
  for (const entries of flowNodes.values()) {
    const { values, row } = entries[0];
    const flowId = text(values.FLOW_ID);
    const nodeId = text(values.NODE_ID);
    const id = flowId && nodeId ? `${flowId}:${nodeId}` : '';
    const branches = entries.map((entry) => ({
      matchValue: text(entry.values.MATCH_VALUE), matchKeywords: splitList(entry.values.MATCH_KEYWORDS),
      nextNodeId: text(entry.values.NEXT_NODE_ID), solution: text(entry.values.SOLUTION), notes: text(entry.values.NOTES), sourceRow: entry.row,
    }));
    const branchText = branches.map((branch, index) => valuesBody([
      [`分支 ${index + 1} 匹配值`, branch.matchValue], ['匹配关键词', branch.matchKeywords.join(', ')],
      ['下一节点', branch.nextNodeId], ['解决方案', branch.solution], ['说明', branch.notes],
    ])).filter(Boolean).join('\n\n');
    const body = valuesBody([
      ['节点问题', values.QUESTION], ['前置条件', values.PREREQUISITES], ['收集字段', values.COLLECT_FIELD], ['分支', branchText],
    ]);
    const record = createRecord({
      id, type: 'troubleshooting_flow', productScope: ['dicloak'], enabled: parseEnabled(values['是否启用'], true), sourceLanguage: 'zh',
      title: text(values.NODE_NAME) || text(values.FLOW_NAME) || id,
      canonicalQuestions: [{ language: 'zh', text: values['标准问题（中文）'] }, { language: 'en', text: values['标准问题（英文）'] }],
      utterances: splitUtterances(values['用户问法']), body, termIds: [], tags: splitList(values['标签']),
      metadata: { flowId, flowName: text(values.FLOW_NAME), nodeId, nodeType: text(values.NODE_TYPE), collectField: text(values.COLLECT_FIELD), branches, sourceRows: entries.map((entry) => entry.row) },
      protectedFields: extractTextProtectedFields(body, 'flow'), source: source(file, 'troubleshooting_flow', row), knowledgeVersion: version,
    });
    if (!id) warnings.push({ code: 'FLOW_ID_MISSING', message: '排障流程缺少 FLOW_ID 或 NODE_ID', source: record.source });
    else records.push(record);
  }
  return records;
}

export function adaptTerminology({ workbook, file, version, warnings }) {
  const sheet = workbook.sheetNames[0];
  return workbook.rows(sheet).flatMap(({ values, row }) => {
    const id = text(values.term_id);
    if (!id) {
      warnings.push({ code: 'TERM_ID_MISSING', message: '术语缺少 term_id', source: source(file, sheet, row) });
      return [];
    }
    const translations = {
      zh: text(values['中文']), en: text(values['英文']), ru: text(values['俄语']), pt: text(values['葡萄牙语（巴西）']),
      es: text(values['西班牙语']), vi: text(values['越南语']),
    };
    const protectedFields = Object.entries(translations).flatMap(([language, value]) => value ? [protectedField('term', value, language)] : []);
    return [createRecord({
      id, type: 'terminology', productScope: ['dicloak', 'paraturbo'], enabled: true, sourceLanguage: 'multilingual',
      title: translations.en || translations.zh || id, canonicalQuestions: [], utterances: [],
      body: valuesBody(Object.entries(translations).map(([language, value]) => [language, value])), termIds: [id],
      tags: compact([values['一级模块'], values['二级模块'], values['术语类型']]),
      metadata: { module: text(values['一级模块']), submodule: text(values['二级模块']), termType: text(values['术语类型']), definition: text(values['定义说明']), isUiVisible: parseEnabled(values.is_ui_visible, false), translations },
      protectedFields, source: source(file, sheet, row), knowledgeVersion: version,
    })];
  });
}

export function adaptFunctions({ workbook, file, version, warnings }) {
  const sheet = workbook.sheetNames[0];
  return workbook.rows(sheet).flatMap(({ values, row }) => {
    const id = text(values.function_id);
    if (!id) {
      warnings.push({ code: 'FUNCTION_ID_MISSING', message: '功能知识缺少 Function ID', source: source(file, sheet, row) });
      return [];
    }
    const termIds = unique([
      ...splitList(values['一级模块术语ID']), ...splitList(values['页面名称术语ID']), ...splitList(values['功能点术语ID']),
    ]);
    const body = valuesBody([
      ['模块', values['一级模块']], ['页面', values['页面名称']], ['功能名称', values['功能点名称']], ['说明', values['功能说明']],
      ['入口', values['入口路径']], ['界面位置', values['界面位置']], ['前置条件', values['前置条件']], ['操作步骤', values['操作步骤']],
    ]);
    return [createRecord({
      id, type: 'function', productScope: normalizeProductScope(values['已支持产品'], ['dicloak']), enabled: true, sourceLanguage: 'zh',
      title: text(values['功能点名称']) || id, canonicalQuestions: [],
      utterances: unique([...splitList(values['关键词（中文）']), ...splitList(values['关键词（英文）']), ...splitList(values['术语匹配词'])]),
      body, termIds, tags: compact([values['一级模块'], values['页面名称'], values['功能类型'], values['是否高频']]),
      metadata: {
        module: text(values['一级模块']), page: text(values['页面名称']), functionType: text(values['功能类型']), functionName: text(values['功能点名称']),
        description: text(values['功能说明']), entryPath: text(values['入口路径']), uiLocation: text(values['界面位置']), prerequisites: text(values['前置条件']),
        steps: text(values['操作步骤']), keywordsZh: splitList(values['关键词（中文）']), keywordsEn: splitList(values['关键词（英文）']),
        faqIds: splitList(values['常见问题FAQ_ID']), termType: text(values['术语类型']), notes: text(values['备注']),
      },
      protectedFields: uniqueProtectedFields([...extractTextProtectedFields(body, 'body'), ...termIds.map((termId) => protectedField('term', termId, 'termIds'))]),
      source: source(file, sheet, row), knowledgeVersion: version,
    })];
  });
}

function parameterProtectedFields(values) {
  const location = text(values['参数位置']).toLowerCase();
  const name = text(values['参数名']);
  const fields = [protectedField('parameter', name, '参数名')];
  if (/response/.test(location)) fields.push(protectedField('response_field', name, '参数名'));
  if (/body|query|header|path|request/.test(location)) fields.push(protectedField('request_field', name, '参数名'));
  if (/body/.test(location)) fields.push(protectedField('json_key', name, '参数名'));
  const errorText = `${text(values['说明'])} ${text(values['可选值/示例'])} ${text(values['备注'])}`;
  for (const match of errorText.matchAll(/\b(?:HTTP\s*)?([1-5]\d{2}|\d{5,6})\b/g)) fields.push(protectedField('error_code', match[1], '说明/示例/备注'));
  return fields;
}

export function adaptApi({ workbook, file, version, warnings }) {
  const endpointSheet = 'API 端点总表';
  const parameterSheet = 'API 参数明细表';
  const paramsById = new Map();
  const paramsByKey = new Map();
  for (const entry of workbook.rows(parameterSheet)) {
    const id = text(entry.values.api_id);
    const key = endpointKey(entry.values);
    if (id) paramsById.set(id, [...(paramsById.get(id) ?? []), entry]);
    paramsByKey.set(key, [...(paramsByKey.get(key) ?? []), entry]);
  }
  return workbook.rows(endpointSheet).flatMap(({ values, row }) => {
    const id = text(values.api_id);
    const family = apiFamily(values['API类型']);
    if (!id || !family) {
      warnings.push({ code: !id ? 'API_ID_MISSING' : 'API_TYPE_INVALID', message: !id ? 'API 端点缺少 api_id' : `无法识别 API 类型：${text(values['API类型'])}`, source: source(file, endpointSheet, row) });
      return [];
    }
    const parameters = paramsById.get(id) ?? paramsByKey.get(endpointKey(values)) ?? [];
    const method = text(values['请求方法']);
    const endpoint = text(values['端点路径']);
    const fullPath = text(values['完整路径规则']);
    const parameterData = parameters.map(({ values: parameter, row: parameterRow }) => ({
      name: text(parameter['参数名']), location: text(parameter['参数位置']), dataType: text(parameter['数据类型']), required: text(parameter['是否必填']),
      description: text(parameter['说明']), allowedOrExample: text(parameter['可选值/示例']), scenario: text(parameter['适用场景']), notes: text(parameter['备注']), row: parameterRow,
    }));
    const body = valuesBody([
      ['API 类型', values['API类型']], ['版本', apiVersion(values['API类型'], endpoint)], ['Method', method], ['Endpoint', endpoint], ['Full Path', fullPath],
      ['对象', values['接口模块']], ['动作', values['功能']], ['用途', values['主要用途']], ['鉴权', values['鉴权方式']], ['请求参数位置', values['请求参数位置']],
      ['成功响应字段', values['成功响应核心字段']], ['参数', parameterData.map((item) => `${item.location} ${item.name} (${item.dataType}, ${item.required})：${item.description}`).join('\n')], ['备注', values['备注']],
    ]);
    const protectedFields = uniqueProtectedFields([
      protectedField('method', method, '请求方法'), protectedField('endpoint', endpoint, '端点路径'), protectedField('full_path', fullPath, '完整路径规则'),
      ...splitList(values['成功响应核心字段']).map((field) => protectedField('response_field', field, '成功响应核心字段')),
      ...parameters.flatMap(({ values: parameter }) => parameterProtectedFields(parameter)), ...extractTextProtectedFields(body, 'body'),
    ]);
    return [createRecord({
      id, type: family, productScope: normalizeProductScope(values['已支持产品'], ['dicloak']), enabled: true, sourceLanguage: 'structured',
      title: `${text(values['功能']) || id} · ${method} ${endpoint}`,
      canonicalQuestions: [], utterances: splitList(values['检索关键词']), body, termIds: [],
      tags: compact([values['API类型'], values['接口模块'], values['功能'], apiVersion(values['API类型'], endpoint)]),
      metadata: {
        apiFamily: family === 'http_api' ? 'HTTP API' : 'Local API', apiType: text(values['API类型']), version: apiVersion(values['API类型'], endpoint),
        method, endpoint, fullPath, object: text(values['接口模块']), action: text(values['功能']), authentication: text(values['鉴权方式']),
        requestLocation: text(values['请求参数位置']), requiresEnvId: text(values['是否需要env_id']), successFields: splitList(values['成功响应核心字段']), parameters: parameterData,
      },
      protectedFields, source: source(file, endpointSheet, row), knowledgeVersion: version,
    })];
  });
}

const pricingPlans = [
  ['Free/免费版', 'free'], ['Base/基础版', 'base'], ['Plus/高阶版', 'plus'], ['Share+/共享版+', 'share-plus'],
];

export function adaptPricing({ workbook, file, version, warnings }) {
  const sheet = workbook.sheetNames[0];
  return workbook.rows(sheet).flatMap(({ values, row }) => {
    const feature = text(values.Features);
    if (!feature) {
      warnings.push({ code: 'PRICING_FEATURE_MISSING', message: '套餐功能项为空', source: source(file, sheet, row) });
      return [];
    }
    return pricingPlans.map(([column, planKey]) => {
      const rawValue = values[column];
      const value = typeof rawValue === 'number' ? rawValue : text(rawValue);
      return createRecord({
        id: `PRICING:${feature}:${planKey}`, type: 'pricing', productScope: ['dicloak', 'paraturbo'], enabled: true, sourceLanguage: 'structured',
        title: `${column} · ${feature}`, canonicalQuestions: [], utterances: [feature, column],
        body: valuesBody([['套餐', column], ['功能项', feature], ['值/限制', value]]), termIds: [], tags: ['pricing', planKey, feature],
        metadata: { planKey, planName: column, feature, value, valueType: typeof rawValue === 'number' ? 'number' : 'text' },
        protectedFields: uniqueProtectedFields([protectedField('term', column, '套餐名称'), ...extractTextProtectedFields(value, column)]),
        source: source(file, sheet, row), knowledgeVersion: version,
      });
    });
  });
}
