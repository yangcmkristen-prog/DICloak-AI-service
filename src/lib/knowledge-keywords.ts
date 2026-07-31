const latinStopWords = new Set([
  "a", "an", "the", "is", "are", "can", "could", "do", "does", "how", "what", "why", "please",
  "dicloak", "paraturbo",
]);

const chineseStopWords = new Set([
  "可以", "是否", "能否", "能不能", "怎么", "如何", "什么", "为什么", "这个", "那个", "一下", "请问", "支持",
]);
const genericChineseCharacters = new Set("可以是否能否不能怎么如何什么为什么这个那个一下请问做吗呢呀么的了");
const chineseFillerPattern = /可以|是否|能否|能不能|怎么|如何|什么|为什么|这个|那个|一下|请问/g;

function normalizeKeyword(value: string): string {
  return value.toLowerCase().replace(/[\s_\-]+/g, " ").trim();
}

function isUsefulChineseKeyword(value: string): boolean {
  if (value.length < 2 || chineseStopWords.has(value)) return false;
  return [...value].some((character) => !genericChineseCharacters.has(character));
}

/**
 * Build retrieval keywords from the user's own wording. Model-generated keywords
 * are accepted only when they are explicitly grounded in the original message.
 */
export function extractGroundedKnowledgeKeywords(text: string, aiKeywords: string[] = []): string[] {
  const lower = text.toLowerCase();
  const keywords = new Set<string>();

  for (const token of lower.match(/[a-z0-9][a-z0-9+._/-]*/g) ?? []) {
    if (token.length > 1 && !latinStopWords.has(token)) keywords.add(token);
  }

  for (const segment of lower.match(/[\u4e00-\u9fff]+/g) ?? []) {
    const meaningfulSegments = segment.replace(chineseFillerPattern, " ").split(/\s+/).filter(Boolean);
    for (const meaningfulSegment of meaningfulSegments) {
      const withoutModalParticle = meaningfulSegment.replace(/[吗呢呀么]+$/g, "");
      for (let index = 0; index < withoutModalParticle.length - 1; index += 1) {
        for (let length = 2; length <= 4 && index + length <= withoutModalParticle.length; length += 1) {
          const keyword = withoutModalParticle.slice(index, index + length);
          if (isUsefulChineseKeyword(keyword)) keywords.add(keyword);
        }
      }
    }
  }

  const normalizedMessage = normalizeKeyword(text);
  for (const candidate of aiKeywords) {
    const keyword = normalizeKeyword(candidate);
    if (keyword.length > 1 && !latinStopWords.has(keyword) && normalizedMessage.includes(keyword)) keywords.add(keyword);
  }

  return [...keywords];
}