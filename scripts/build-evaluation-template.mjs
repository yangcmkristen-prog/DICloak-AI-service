import fs from 'node:fs/promises';
import path from 'node:path';
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const outputDirectory = path.resolve(process.cwd(), 'outputs', 'v2-evaluation-template');
const outputPath = path.join(outputDirectory, 'V2评测集模板.xlsx');

const headers = [
  '案例ID', '是否启用', '客户问题', '对话历史', '产品', '语言', '正确知识ID', '知识类型',
  '是否应该追问', '必须包含', '禁止包含', '必须保持原样', '参考回复', '错误类型', '备注',
];

const rows = [
  ['EVAL-HTTP-001', true, '如何创建一个新环境？', '', 'dicloak', 'zh', 'API-DEMO-HTTP-001', 'HTTP API', false, 'POST;/api/v1/environments;env_id', 'Local API', 'POST;/api/v1/environments;env_id;https://docs.example.test/api/v1/environments', '请使用 POST /api/v1/environments，并保留参数 env_id。', 'API类型混淆;Endpoint变化;参数变化', '完全脱敏的 HTTP API 示例'],
  ['EVAL-LOCAL-001', true, 'How do I read a local profile?', '', 'dicloak', 'en', 'API-DEMO-LOCAL-001', 'Local API', false, 'Local API;GET;/local/v2/profiles;profile_id', 'HTTP API', 'GET;/local/v2/profiles;profile_id', 'Use GET /local/v2/profiles with profile_id.', 'API类型混淆;Method变化', '完全脱敏的 Local API 示例'],
  ['EVAL-URL-001', true, 'Send me the setup link and status endpoint.', '', 'dicloak', 'en', 'FAQ-DEMO-URL-001', 'FAQ', false, 'https://help.example.test/start?lang=en#install;/api/v1/status', '', 'https://help.example.test/start?lang=en#install;/api/v1/status', 'Open the setup link, then check /api/v1/status.', 'URL变化;Endpoint变化', '使用 example.test 保证不指向真实系统'],
  ['EVAL-TERM-001', true, 'What should I check in profile settings?', '', 'dicloak', 'en', 'TERM-DEMO-001', '术语', false, 'Profile settings;Browser fingerprint', '', 'Profile settings;Browser fingerprint', 'Check Browser fingerprint in Profile settings.', '术语变化', '脱敏术语示例'],
  ['EVAL-I18N-001', true, '¿Cómo creo un entorno mediante la API?', '', 'dicloak', 'es', 'API-DEMO-HTTP-001', 'HTTP API', false, 'POST;/api/v1/environments;env_id', 'Local API', 'POST;/api/v1/environments;env_id', 'Utilice POST /api/v1/environments con env_id.', '多语言;Endpoint变化', '西班牙语示例'],
  ['EVAL-ASK-001', true, '软件打不开，怎么办？', '客户仅说明“打不开”，没有报错和步骤。', 'paraturbo', 'zh', 'FAQ-DEMO-ASK-001', 'FAQ', true, '报错;步骤', 'DICloak', '', '请提供报错文本和复现步骤。', '应追问;产品串线', '信息不足时应追问'],
  ['EVAL-NONE-001', true, '能否保证某第三方平台永不风控？', '', 'dicloak', 'zh', '', '无知识', false, '需进一步确认', '保证;根据知识库;FAQ_ID', '', '该问题需进一步确认，不能作出保证。', '无知识;内部表达', '无知识不得编造'],
];

const workbook = Workbook.create();
console.log('phase:workbook');
const sheet = workbook.worksheets.add('评测案例');
sheet.showGridLines = false;
sheet.freezePanes.freezeRows(1);
sheet.getRange(`A1:O${rows.length + 1}`).values = [headers, ...rows];
sheet.getRange('A1:O1').format = {
  fill: '#155E75',
  font: { bold: true, color: '#FFFFFF' },
  verticalAlignment: 'center',
  wrapText: true,
  borders: { preset: 'outside', style: 'medium', color: '#0E7490' },
};
sheet.getRange(`A2:O${rows.length + 1}`).format = {
  verticalAlignment: 'top',
  wrapText: true,
  borders: { insideHorizontal: { style: 'thin', color: '#DCE6EA' } },
};
sheet.getRange(`A2:A${rows.length + 1}`).format.font = { bold: true, color: '#0F4C5C' };
sheet.getRange(`B2:B200`).dataValidation = { rule: { type: 'list', values: ['TRUE', 'FALSE'] } };
sheet.getRange(`E2:E200`).dataValidation = { rule: { type: 'list', values: ['dicloak', 'paraturbo'] } };
sheet.getRange(`F2:F200`).dataValidation = { rule: { type: 'list', values: ['zh', 'en', 'es', 'pt', 'ru', 'vi', 'id', 'th', 'ar', 'ja', 'ko', 'mixed'] } };
sheet.getRange(`H2:H200`).dataValidation = { rule: { type: 'list', values: ['HTTP API', 'Local API', 'FAQ', '术语', '功能知识', '套餐', '无知识'] } };
sheet.getRange(`I2:I200`).dataValidation = { rule: { type: 'list', values: ['TRUE', 'FALSE'] } };

const widths = [16, 11, 34, 30, 12, 10, 24, 15, 14, 36, 30, 42, 40, 28, 28];
for (let column = 0; column < widths.length; column += 1) {
  sheet.getRangeByIndexes(0, column, rows.length + 1, 1).format.columnWidth = widths[column];
}
sheet.getRange('1:1').format.rowHeight = 34;
sheet.getRange(`2:${rows.length + 1}`).format.rowHeight = 82;
sheet.tables.add(`A1:O${rows.length + 1}`, true, 'EvaluationCases').style = 'TableStyleMedium2';
console.log('phase:cases');

const guide = workbook.worksheets.add('填写说明');
guide.showGridLines = false;
guide.getRange('A1:D1').merge();
guide.getRange('A1').values = [['V2 固定评测集填写说明']];
guide.getRange('A1:D1').format = { fill: '#155E75', font: { bold: true, color: '#FFFFFF', size: 16 }, verticalAlignment: 'center' };
guide.getRange('A3:D10').values = [
  ['字段', '要求', '格式', '示例'],
  ['案例ID', '全文件唯一且非空', '稳定字符串', 'EVAL-HTTP-001'],
  ['布尔字段', '只允许 TRUE/FALSE 或 是/否', '布尔值', 'TRUE'],
  ['数组字段', '使用英文分号分隔；空项会被忽略', '值1;值2', 'POST;/api/v1/status'],
  ['正确知识ID', '有知识案例至少一个；无知识必须为空', 'ID1;ID2', 'FAQ-DEMO-001'],
  ['必须保持原样', 'URL、Endpoint、Method、参数和术语逐项填写', '值1;值2', 'GET;env_id'],
  ['隐私', '只允许脱敏内容，禁止客户标识与密钥', '文本', 'example.test'],
  ['隔离', '评测题不得导入知识库或作为模型知识', '规则', '仅供评测运行器读取'],
];
guide.getRange('A3:D3').format = { fill: '#D9F0F5', font: { bold: true, color: '#164E63' }, borders: { preset: 'outside', style: 'thin', color: '#67AFC1' } };
guide.getRange('A3:D10').format.wrapText = true;
guide.getRange('A3:D10').format.verticalAlignment = 'top';
guide.getRange('A3:A10').format.font = { bold: true, color: '#155E75' };
guide.getRange('A:A').format.columnWidth = 22;
guide.getRange('B:B').format.columnWidth = 42;
guide.getRange('C:C').format.columnWidth = 26;
guide.getRange('D:D').format.columnWidth = 34;
guide.getRange('1:1').format.rowHeight = 36;
guide.getRange('3:10').format.rowHeight = 42;
guide.freezePanes.freezeRows(3);
console.log('phase:guide');

await fs.mkdir(outputDirectory, { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log('phase:export');
console.log(JSON.stringify({ outputPath }));
