const internalPatterns = [/FAQ_ID/i, /TS_ID/i, /FUNCTION_ID/i, /根据(?:内部)?知识库/, /knowledge base/i];
const askPatterns = [/请(?:提供|补充|告知|问)/, /能否提供/, /please (?:provide|share|confirm)/i, /could you/i, /\?\s*$/];

function occurrences(text, token) {
  return text.split(token).length - 1;
}

export function evaluateAnswer(testCase, answer) {
  const checks = [];
  const add = (name, pass, detail = '') => checks.push({ name, pass, detail });
  for (const expected of testCase.mustInclude) add(`必须包含：${expected}`, answer.includes(expected), expected);
  for (const forbidden of testCase.mustNotInclude) add(`禁止包含：${forbidden}`, !answer.includes(forbidden), forbidden);
  for (const exact of testCase.preserveExact) add(`保持原样：${exact}`, occurrences(answer, exact) >= 1, exact);
  const asks = askPatterns.some((pattern) => pattern.test(answer));
  add(testCase.shouldAsk ? '应该追问' : '不应追问', asks === testCase.shouldAsk, asks ? '检测到追问' : '未检测到追问');
  add('产品不串线', testCase.product === 'dicloak' ? !/Paraturbo/i.test(answer) : !/DICloak/i.test(answer));
  if (testCase.knowledgeType === 'HTTP API') add('HTTP/Local API 不混淆', !/Local API/i.test(answer));
  if (testCase.knowledgeType === 'Local API') add('HTTP/Local API 不混淆', !/HTTP API/i.test(answer));
  add('内部知识 ID 不泄漏', !testCase.knowledgeIds.some((id) => id && answer.includes(id)) && !internalPatterns.slice(0, 3).some((pattern) => pattern.test(answer)));
  add('无内部知识表达', !internalPatterns.slice(3).some((pattern) => pattern.test(answer)));
  return { pass: checks.every((check) => check.pass), checks };
}
