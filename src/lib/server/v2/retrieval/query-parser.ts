import type { QueryIntent } from "./types.ts";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

const LATIN_STOP_WORDS = new Set(["the", "and", "for", "from", "with", "this", "that", "what", "where", "how", "can", "does", "have", "has", "want", "would", "like", "just", "came", "come", "across", "website", "websites", "please", "know", "your", "you", "to"]);
const HAN_STOP_WORDS = new Set(["一个", "可以", "怎么", "如何", "哪里", "什么", "已经", "还是", "但是", "请问", "我的", "这个", "那个", "重新", "一直"]);

/** Short, deterministic terms used by lexical recall when a full customer sentence is too long for trigram matching. */
export function extractSearchTerms(question: string): string[] {
  const latin = (question.toLocaleLowerCase().match(/[\p{Script=Latin}\p{N}_./{}-]{2,}/gu) ?? [])
    .filter((term) => !LATIN_STOP_WORDS.has(term));
  const han = (question.match(/\p{Script=Han}+/gu) ?? []).flatMap((segment) => {
    if (segment.length <= 4) return [segment];
    return Array.from({ length: segment.length - 1 }, (_, index) => segment.slice(index, index + 2));
  }).filter((term) => !HAN_STOP_WORDS.has(term));
  const conceptAliases = [
    [/(?:分享|共享).{0,15}(?:订阅|账号|账户)|(?:团队|成员).{0,15}(?:分享|共享)|share.{0,15}(?:subscription|account)/i, ["share", "sharing", "subscription", "team", "account", "multiple sessions"]],
    [/(?:账号不存在|凭据无效)|account\s+does\s+not\s+exist|credentials?\s+(?:is|are)\s+invalid/i, ["account does not exist", "credentials invalid", "账号不存在"]],
    [/(?:环境|浏览器配置|профил|профилей|профили|hồ sơ|môi trường)|\b(?:profiles?|perfil|perfis|ambiente|ambientes)\b/i, ["profile", "environment"]],
    [/(?:用户|成员|席位|участник|участников|пользователь|người dùng|thành viên)|\b(?:users?|members?|seats?|membro|membros|miembro|miembros|usuario|usuarios)\b/i, ["member", "members", "seat", "actual users", "devices"]],
    [/(?:数量|个数|上限|限制|сколько|количество|огранич|bao nhiêu|số lượng|giới hạn)|\b(?:how\s+many|number|count|limit|maximum|quantos|quantas|quantidade|número|cuántos|cuántas|cantidad|límite)\b/i, ["number", "limit", "maximum", "quota"]],
    [/(?:访问|打开|使用|доступ|откры|truy cập|mở|sử dụng)|\b(?:access|open|use|acessar|abrir|usar|acceder|abrir|usar)\b/i, ["access", "open", "use"]],
    [/(?:管理员|超管|администратор|quản trị viên)|\b(?:admin|administrator|adm|gerente|administrador)\b/i, ["admin", "administrator"]],
    [/visualiza(?:ção|cao)\s+gr[aá]tis/i, ["free views", "free likes", "free followers", "maintenance"]],
    [/(?:como\s+)?cri(?:a|ar).{0,12}(?:navegador|novegador)|(?:create|add).{0,12}(?:browser|profile)/i, ["create browser profile", "new profile", "创建环境"]],
  ].flatMap(([pattern, aliases]) => (pattern as RegExp).test(question) ? aliases as string[] : []);
  return [...new Set([...latin, ...han, ...conceptAliases])].slice(0, 40);
}

function detectLanguage(question: string): string {
  if (/\p{Script=Han}/u.test(question)) return "zh";
  if (/\p{Script=Cyrillic}/u.test(question)) return "ru";
  if (/\b(como|perfil|navegador|plano|preço|api local|visualiza(?:ção|cao)|gr[aá]tis|não|usuário)\b/i.test(question)) return "pt";
  if (/\b(cómo|perfil|navegador|precio|cuenta|iniciar sesión)\b/i.test(question)) return "es";
  if (/\b(làm sao|hồ sơ|trình duyệt|giá|tài khoản|đăng nhập)\b/i.test(question)) return "vi";
  return "en";
}

export function parseQuery(question: string, requestedProduct: "dicloak" | "paraturbo" = "dicloak"): QueryIntent {
  const normalized = question.trim();
  const upper = normalized.toUpperCase();
  const product = /\bparaturbo\b/i.test(normalized) ? "paraturbo" : /\bdicloak\b/i.test(normalized) ? "dicloak" : requestedProduct;
  const localApi = /\b(local api|api local)\b|本地\s*API|localhost|127\.0\.0\.1/i.test(normalized);
  const httpApi = /\b(http api|open api|remote api|http)\b|HTTP\s*接口|开放\s*API|云端\s*API/i.test(normalized);
  const apiType = localApi ? "local" : httpApi ? "http" : null;
  const apiMention = /\bAPI\b|接口/i.test(normalized);
  const apiVersion = normalized.match(/(?:^|[\s/])(v\d+)(?:\b|\/)/i)?.[1]?.toLowerCase() ?? null;
  const method = METHODS.find((value) => new RegExp(`\\b${value}\\b`, "i").test(upper)) ?? null;
  const renewal = /续费|续期|renew(?:al|ing)?/i.test(normalized);
  const pricing = /套餐|价格|费用|配额|成员数|席位|\bplan\b|pricing|price|quota|upgrade\s+(?:my\s+)?plan|preço/i.test(normalized);
  const troubleshooting = /失败|报错|错误|异常|无法|不能|打不开|不让.{0,6}打开|无效|内容为空|余额不足|一直提示|怎么办|not\s+working|(?:can't|cannot|won't)\s+(?:open|use)|fail(?:ed|ure)?|error|unable|cannot|invalid|insufficient\s+(?:balance|credit)|empty\s+folder/i.test(normalized);
  const outOfScope = /(?:生成|购买|提供).{0,12}(?:AI|Sora|视频|工具账号)|免费.{0,8}(?:浏览|播放|点赞|粉丝)|(?:账号|account).{0,10}(?:封禁|禁用|disabled|unblock)|(?:赚钱|挣钱|earn\s+money|make\s+money)|visualiza(?:ção|cao)\s+gr[aá]tis/i.test(normalized);
  const operationAudit = /(?:谁|何人).{0,8}(?:改|修改|操作)|(?:操作|修改|变更).{0,8}(?:日志|记录)|who.{0,12}(?:changed|modified)|operation\s+log/i.test(normalized);
  const accountSharing = /(?:分享|共享).{0,15}(?:订阅|账号|账户)|(?:团队|成员).{0,15}(?:分享|共享)|share.{0,15}(?:subscription|account)/i.test(normalized);
  const explicitFunctionOperation = /(?:修改|编辑|配置|设置|更换|替换|换成|换掉|换|查看|查询|检测|测试|创建|新建|添加|删除|移除|导入|导出|启用|禁用|重置|打开|关闭).{0,20}(?:环境|浏览器配置|代理|IP|成员|用户|团队|分组|Cookie|扩展|插件|指纹|界面|皮肤|主题|外观|输入|延迟)|(?:环境|浏览器配置|代理|IP|成员|用户|团队|分组|Cookie|扩展|插件|指纹|界面|皮肤|主题|外观|输入|延迟).{0,16}(?:修改|编辑|配置|设置|更换|替换|换|查看|查询|检测|测试|创建|新建|添加|删除|移除|导入|导出|启用|禁用|重置|打开|关闭)|\b(?:edit|modify|configure|change|replace|view|check|test|create|add|delete|remove|import|export|enable|disable|reset|open|close)\w*\b.{0,40}\b(?:profile|environment|proxy|member|user|team|group|cookie|extension|fingerprint|interface|skin|theme|appearance|input|typing|delay|display)\w*\b/i.test(normalized);
  const functionOperation = /(?:como\s+)?cri(?:a|ar).{0,12}(?:navegador|novegador)|(?:create|add).{0,12}(?:browser|profile)|(?:创建|新建).{0,8}(?:环境|浏览器配置)/i.test(normalized) || !troubleshooting && explicitFunctionOperation;
  const functionScopeQuestion = /(?:环境|浏览器配置|代理|成员|用户|团队|分组|Cookie|扩展|插件|指纹|界面|皮肤|主题|外观|推广|返现|奖励).{0,24}(?:是什么|有哪些|有什么|怎么用|如何使用|怎么参与|如何参与|完整流程|区别|差异|对比|比较|哪个好)|(?:what\s+is|what\s+features|how\s+to\s+use|workflow|difference|compare).{0,30}(?:profile|environment|proxy|member|team|cookie|extension|fingerprint|interface|skin|theme|referral|reward)/i.test(normalized);
  const featureCapability = /(?:是否|能否|可不可以|可以|能不能|支持|有没有|有无|有|如何|怎么).{0,30}(?:功能|活动|奖励|返现|按钮|菜单|栏|页面|设置|模式|同步|隐藏|显示|关闭|开启|打开|禁用|启用|界面|皮肤|主题|外观)|(?:功能|活动|奖励|返现|按钮|菜单|栏|页面|设置|模式|界面|皮肤|主题|外观).{0,20}(?:是否|能否|可以|支持|有没有|有吗|怎么|如何)|\b(?:can|could|does|support|have|hide|show|disable|enable|limit|restrict|configure|set|allow)\b.{0,60}\b(?:feature|campaign|reward|referral|button|menu|bar|page|setting|mode|sync|member|profile|device|access|interface|skin|theme|appearance)\b|(?:seria\s+interessante|poderia|pudesse|podemos|é\s+possível|tem\s+como|gostaria|sería\s+interesante|podría|se\s+puede|es\s+posible|quisiera).{0,80}(?:membro|perfil|ambiente|função|configura|limite|acesso|dispositivo|miembro|usuario|función|acceso)|(?:quantos|quantidade|número\s+de|cuántos|cantidad).{0,50}(?:membro|perfil|ambiente|dispositivo|acesso|miembro|usuario)|(?:можно\s+ли|хотелось\s+бы|возможно\s+ли).{0,80}(?:участник|пользователь|профил|доступ|устройств|огранич)|(?:có\s+thể|có\s+hỗ\s+trợ|muốn).{0,80}(?:thành\s+viên|người\s+dùng|hồ\s+sơ|môi\s+trường|truy\s+cập|thiết\s+bị|giới\s+hạn)/i.test(normalized);
  const knowledgeTypes = apiType ? [apiType === "http" ? "http_api" : "local_api"] : renewal ? ["faq", "function"] : pricing ? ["pricing"] : apiMention ? ["http_api", "local_api"] : outOfScope ? ["out_of_scope"] : operationAudit || functionOperation || functionScopeQuestion || featureCapability ? ["function"] : accountSharing ? ["faq"] : troubleshooting ? ["troubleshooting", "troubleshooting_flow", "user_routing"] : [];
  const objectMatch = normalized.match(/(?:对象|object)\s*[:：]?\s*([\w-]+)/i);
  const actionMatch = normalized.match(/(?:动作|action)\s*[:：]?\s*([\w-]+)/i);
  const missingConditions = [];
  if (knowledgeTypes.some((type) => type === "http_api" || type === "local_api")) {
    if (!apiType) missingConditions.push("apiType");
    if (!method) missingConditions.push("method");
  }
  const vagueFailure = /^(?:不让我|无法|不能|打不开|我想要访问链接)|\b(?:not working|can't open|cannot open|disabled)\b|无法正常工作/i.test(normalized);
  const hasSpecificEvidence = /["“”]|\b(?:error|code|status|HTTP|API)\b|错误码|提示|显示|返回|失败/i.test(normalized);
  if (!outOfScope && vagueFailure && !hasSpecificEvidence) missingConditions.push("symptomDetails");
  return { product, language: detectLanguage(normalized), knowledgeTypes, apiType, apiVersion, method, object: objectMatch?.[1] ?? null, action: actionMatch?.[1] ?? null, missingConditions };
}
