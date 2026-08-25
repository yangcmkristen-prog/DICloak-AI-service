import { NextRequest, NextResponse } from "next/server";
import { callExtensionTranslateModel, callExtensionTranslateModelStream, getExtensionTranslateApiConfig } from "../copilot/shared";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import { buildCustomerSupportTranslationGuidance } from "@/lib/customer-support-translation";
import { getKnowledgeCacheGeneration } from "@/lib/server/translation-cache-control";

const LANGUAGE_NAMES: Record<string, string> = {
  auto: "自动检测",
  zh: "简体中文",
  en: "英语",
  es: "西班牙语",
  fr: "法语",
  de: "德语",
  "pt-BR": "葡萄牙语（巴西）",
  "pt-PT": "葡萄牙语（欧洲）",
  pt: "葡萄牙语（巴西）",
  ru: "俄语",
  vi: "越南语",
  id: "印尼语",
  th: "泰语",
  ar: "阿拉伯语",
  ja: "日语",
  ko: "韩语",
};


const QWEN_MT_LANGUAGE_NAMES: Record<string, string> = {
  auto: "auto",
  zh: "Chinese",
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  "pt-BR": "Portuguese",
  "pt-PT": "Portuguese",
  pt: "Portuguese",
  ru: "Russian",
  vi: "Vietnamese",
  id: "Indonesian",
  th: "Thai",
  ar: "Arabic",
  ja: "Japanese",
  ko: "Korean",
};

const KNOWLEDGE_TERMS_CACHE_TTL_MS = 10 * 60_000;
let knowledgeTermsCache: { terms: TermRecord[]; expiresAt: number } | null = null;
let knowledgeTermsRequest: Promise<TermRecord[]> | null = null;
const TRANSLATION_CACHE_TTL_MS = 60 * 60_000;
const TRANSLATION_CACHE_MAX_ENTRIES = 500;
const TRANSLATION_CACHE_MAX_INPUT_CHARS = 2_000;
const translationCache = new Map<string, { value: string; expiresAt: number }>();
let observedKnowledgeGeneration = getKnowledgeCacheGeneration();

function getCachedTranslation(key: string): string | null {
  const cached = translationCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    translationCache.delete(key);
    return null;
  }
  translationCache.delete(key);
  translationCache.set(key, cached);
  return cached.value;
}

function cacheTranslation(key: string, value: string): void {
  if (!value) return;
  translationCache.set(key, { value, expiresAt: Date.now() + TRANSLATION_CACHE_TTL_MS });
  while (translationCache.size > TRANSLATION_CACHE_MAX_ENTRIES) {
    const oldestKey = translationCache.keys().next().value;
    if (typeof oldestKey !== "string") break;
    translationCache.delete(oldestKey);
  }
}

function elapsedSince(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

const LANGUAGE_PROMPT_NAMES: Record<string, string> = {
  auto: "Auto Detect",
  zh: "Simplified Chinese (中文简体, zh-Hans)",
  en: "English",
  fr: "French (Français)",
  de: "German (Deutsch)",
  es: "Spanish (Español)",
  "pt-BR": "Brazilian Portuguese (Português do Brasil, pt-BR)",
  "pt-PT": "European Portuguese (Português Europeu, pt-PT)",
  pt: "Brazilian Portuguese (Português do Brasil, pt-BR)",
  ru: "Russian",
  vi: "Vietnamese",
  id: "Indonesian",
  th: "Thai",
  ar: "Arabic",
  ja: "Japanese",
  ko: "Korean",
};


type TranslationTerm = {
  source: string;
  target: string;
};

const ENGLISH_TERMS_KEEP_CASE = new Set(["DICloak", "API", "IP", "ID", "SDK", "FAQ", "URL", "UI"]);

function isAllCapsTerm(value: string): boolean {
  return /[A-Z]/.test(value) && value === value.toUpperCase();
}

function normalizeEnglishTermCasing(target: string): string {
  const trimmed = target.trim();
  if (!trimmed || ENGLISH_TERMS_KEEP_CASE.has(trimmed) || isAllCapsTerm(trimmed)) {
    return trimmed;
  }

  return trimmed
    .split(/(\s+)/)
    .map((part) => {
      if (/^\s+$/.test(part) || ENGLISH_TERMS_KEEP_CASE.has(part) || isAllCapsTerm(part)) {
        return part;
      }

      return /^[A-Z][a-z]+s?$/.test(part)
        ? part.charAt(0).toLowerCase() + part.slice(1)
        : part;
    })
    .join("");
}

type TermRecord = Record<string, unknown>;

function readStringField(term: TermRecord, fields: string[]): string {
  for (const field of fields) {
    const value = term[field];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return "";
}

function readTermType(term: TermRecord): string {
  return readStringField(term, ["termType", "术语类型", "type", "category"]);
}

function isFeatureSettingTerm(term: TermRecord): boolean {
  return readTermType(term).trim() === "功能设置";
}

function normalizeTermTargetForTranslation(target: string, targetLanguage: string, term: TermRecord): string {
  if (targetLanguage !== "en" || isFeatureSettingTerm(term)) return target;
  return normalizeEnglishTermCasing(target);
}


function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsLatinLetter(value: string): boolean {
  return /[A-Za-z]/.test(value);
}

function textContainsTerm(text: string, source: string): boolean {
  const escapedSource = escapeRegExp(source.trim());
  if (!escapedSource) return false;

  if (containsLatinLetter(source)) {
    return new RegExp(`(?<![A-Za-z0-9_])${escapedSource}(?![A-Za-z0-9_])`, "iu").test(text);
  }

  return text.toLowerCase().includes(source.toLowerCase());
}

function isLikelyCategoryTerm(source: string, target: string, term: TermRecord): boolean {
  const termType = readTermType(term).toLowerCase();
  if (/category|分类|类别|分组|标签|topic|section/.test(termType)) return true;

  return /^profiles?$/i.test(source.trim()) && /相关$/.test(target.trim());
}

function isProfilesModuleOperationPath(text: string): boolean {
  return /\b(enter|go to|open|click|navigate to)\s+(the\s+)?Profiles\b/.test(text);
}

function shouldSkipProfileModuleTerm(source: string, target: string, text: string): boolean {
  return /^profiles?$/i.test(source.trim())
    && target.trim() === "环境管理"
    && (source.trim() !== "Profiles" || !isProfilesModuleOperationPath(text));
}

function addTranslationTerm(result: TranslationTerm[], seen: Set<string>, source: string, target: string): void {
  const sourceLower = source.toLowerCase();
  const key = `${sourceLower}->${target.toLowerCase()}`;
  if (seen.has(key)) return;

  seen.add(key);
  result.push({ source, target });
}

function addDICloakContextTerms(result: TranslationTerm[], seen: Set<string>, text: string, sourceLanguage: string | null, targetLanguage: string): void {
  if (targetLanguage !== "zh" || (sourceLanguage && sourceLanguage !== "auto" && sourceLanguage !== "en")) return;

  const profileTerms: TranslationTerm[] = [
    { source: "enter the Profiles", target: "进入环境管理" },
    { source: "enter Profiles", target: "进入环境管理" },
    { source: "go to the Profiles", target: "前往环境管理" },
    { source: "go to Profiles", target: "前往环境管理" },
    { source: "open the Profiles", target: "打开环境管理" },
    { source: "open Profiles", target: "打开环境管理" },
    { source: "click the Profiles", target: "点击环境管理" },
    { source: "click Profiles", target: "点击环境管理" },
    { source: "navigate to the Profiles", target: "导航至环境管理" },
    { source: "navigate to Profiles", target: "导航至环境管理" },
    { source: "create new profiles", target: "新建环境" },
    { source: "create new profile", target: "新建环境" },
    { source: "create profiles", target: "创建环境" },
    { source: "create profile", target: "创建环境" },
    { source: "new profiles", target: "新建环境" },
    { source: "new profile", target: "新建环境" },
    { source: "profiles", target: "环境" },
    { source: "profile", target: "环境" },
  ];

  for (const term of profileTerms) {
    if (textContainsTerm(text, term.source)) {
      addTranslationTerm(result, seen, term.source, term.target);
    }
  }
}

function readTermField(term: TermRecord, language: string): string {
  const fieldMap: Record<string, string[]> = {
    zh: ["termCN", "zh", "cn", "中文"],
    en: ["termEN", "en", "英文"],
    fr: ["termFR", "fr", "法语"],
    de: ["termDE", "de", "德语"],
    es: ["termES", "es", "西班牙语"],
    "pt-BR": ["termPT", "pt", "葡萄牙语（巴西）"],
    "pt-PT": ["termPT", "pt", "葡萄牙语（巴西）"],
    pt: ["termPT", "pt", "葡萄牙语（巴西）"],
    ru: ["termRU", "ru", "俄语"],
    vi: ["termVI", "vi", "越南语"],
  };

  for (const field of fieldMap[language] || []) {
    const value = term[field];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return "";
}

async function fetchKnowledgeTerms(): Promise<TermRecord[]> {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from("knowledge_configs")
      .select("knowledge_data")
      .eq("config_key", "default")
      .maybeSingle();

    if (error || !Array.isArray(data?.knowledge_data?.termItems)) {
      return [];
    }

    return data.knowledge_data.termItems as TermRecord[];
  } catch (error) {
    console.error("获取术语库失败:", error);
    return [];
  }
}

async function getKnowledgeTerms(): Promise<TermRecord[]> {
  const currentGeneration = getKnowledgeCacheGeneration();
  if (observedKnowledgeGeneration !== currentGeneration) {
    knowledgeTermsCache = null;
    knowledgeTermsRequest = null;
    translationCache.clear();
    observedKnowledgeGeneration = currentGeneration;
  }
  const now = Date.now();
  if (knowledgeTermsCache && knowledgeTermsCache.expiresAt > now) {
    return knowledgeTermsCache.terms;
  }

  if (!knowledgeTermsRequest) {
    knowledgeTermsRequest = fetchKnowledgeTerms()
      .then((terms) => {
        knowledgeTermsCache = {
          terms,
          expiresAt: Date.now() + KNOWLEDGE_TERMS_CACHE_TTL_MS,
        };
        return terms;
      })
      .finally(() => {
        knowledgeTermsRequest = null;
      });
  }

  return knowledgeTermsRequest;
}

function buildTranslationTerms(terms: TermRecord[], text: string, sourceLanguage: string | null, targetLanguage: string): TranslationTerm[] {
  const normalizedText = text.toLowerCase();
  const sourceLanguages = sourceLanguage && sourceLanguage !== "auto"
    ? [sourceLanguage]
    : ["zh", "en", "es", "pt-BR", "pt-PT", "ru", "vi"];
  const result: TranslationTerm[] = [];
  const seen = new Set<string>();

  addDICloakContextTerms(result, seen, text, sourceLanguage, targetLanguage);

  for (const term of terms) {
    const rawTarget = readTermField(term, targetLanguage);
    if (!rawTarget) continue;
    const target = normalizeTermTargetForTranslation(rawTarget, targetLanguage, term);

    for (const language of sourceLanguages) {
      const source = readTermField(term, language);
      if (!source || source === target) continue;

      if (!textContainsTerm(normalizedText, source)) continue;
      if (isLikelyCategoryTerm(source, target, term)) continue;
      if (shouldSkipProfileModuleTerm(source, target, text)) continue;

      addTranslationTerm(result, seen, source, target);
      break;
    }

    if (result.length >= 50) break;
  }

  return result;
}

function normalizeLanguage(value: unknown, fallback: string, allowAuto: boolean): string {
  if (typeof value !== "string") return fallback;
  if (value === "pt") return "pt-BR";
  if (LANGUAGE_NAMES[value] && (allowAuto || value !== "auto")) return value;
  return fallback;
}

function detectSourceLanguage(text: string): string | null {
  const lower = text.toLowerCase();
  if (/[\u4e00-\u9fff]/.test(text)) return "zh";
  if (/[ぁ-ゟ゠-ヿ]/.test(text)) return "ja";
  if (/[가-힯]/.test(text)) return "ko";
  if (/[\u0e00-\u0e7f]/.test(text)) return "th";
  if (/[\u0600-\u06ff]/.test(text)) return "ar";
  if (/\b(the|and|you|your|have|has|hello|regarding|failure|issue|methods|network|settings|computer|installed|please|account|team)\b/.test(lower)) return "en";
  if (/\b(bonjour|merci|compte|équipe|equipe|paramètres|parametres|problème|probleme|besoin|aide|connexion)\b/.test(lower) || /[àâçéèêëîïôûùüÿœæ]/.test(lower)) return "fr";
  if (/\b(hallo|danke|konto|team|einstellungen|problem|hilfe|brauche|anmeldung|proxy|profil)\b/.test(lower) || /[äöüß]/.test(lower)) return "de";
  if (/\b(hemos|desactivar|agregar|entre|otros|hola|gracias|usted|puedo|necesito|cuenta|equipo|configuración|configuracion|contraseña|contrasena|archivo|carpeta|problema)\b/.test(lower) || /[¿¡ñáéíóúü]/.test(lower)) return "es";
  if (/\b(você|voce|obrigado|obrigada|não|nao|estou|preciso|conta|equipe|configurações|configuracoes)\b/.test(lower)) return "pt-BR";
  if (/\b(tu|estás|estas|ficheiro|telemóvel|telemovel|factura|fatura)\b/.test(lower)) return "pt-PT";
  if (/\b(bạn|tôi|không|cần|tài khoản|nhóm)\b/.test(lower)) return "vi";
  if (/\b(saya|anda|tidak|akun|tim|pengaturan)\b/.test(lower)) return "id";
  if (/[а-яё]/i.test(text)) return "ru";
  return null;
}

export async function POST(request: NextRequest) {
  const requestStartedAt = performance.now();
  const requestId = crypto.randomUUID();
  try {
    const { text, sourceLanguage = "auto", targetLanguage = "zh", targetLanguages } = await request.json() as {
      text?: unknown;
      sourceLanguage?: unknown;
      targetLanguage?: unknown;
      targetLanguages?: unknown;
    };
    
    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "缺少文本内容" }, { status: 400 });
    }

    const parseMs = elapsedSince(requestStartedAt);
    const detectStartedAt = performance.now();
    const normalizedSourceLanguage = normalizeLanguage(sourceLanguage, "auto", true);
    const detectedSourceLanguage = normalizedSourceLanguage === "auto"
      ? detectSourceLanguage(text)
      : normalizedSourceLanguage;
    const detectMs = elapsedSince(detectStartedAt);
    const requestedTargetLanguages = Array.isArray(targetLanguages) && targetLanguages.length > 0
      ? targetLanguages.map((language) => normalizeLanguage(language, "zh", false))
      : [normalizeLanguage(targetLanguage, "zh", false)];
    const uniqueTargetLanguages = [...new Set(requestedTargetLanguages)];
    const dependenciesStartedAt = performance.now();
    const knowledgeCacheHit = Boolean(knowledgeTermsCache && knowledgeTermsCache.expiresAt > Date.now());
    const [knowledgeTerms, translateConfig] = await Promise.all([
      getKnowledgeTerms(),
      getExtensionTranslateApiConfig(),
    ]);
    const dependenciesMs = elapsedSince(dependenciesStartedAt);

    const translateToLanguage = async (normalizedTargetLanguage: string): Promise<string> => {
      const termMatchStartedAt = performance.now();
      const sourceLanguageName = detectedSourceLanguage
        ? LANGUAGE_PROMPT_NAMES[detectedSourceLanguage]
        : LANGUAGE_PROMPT_NAMES[normalizedSourceLanguage];
      const targetLanguageName = LANGUAGE_PROMPT_NAMES[normalizedTargetLanguage];
      const glossaryTerms = buildTranslationTerms(knowledgeTerms, text, detectedSourceLanguage || normalizedSourceLanguage, normalizedTargetLanguage);
      const termMatchMs = elapsedSince(termMatchStartedAt);
      const customerSupportGuidance = buildCustomerSupportTranslationGuidance(targetLanguageName);

      const systemPrompt = [
        "You are a professional translation engine for DICloak customer support.",
        `Source language: ${normalizedSourceLanguage === "auto" ? `auto-detect${detectedSourceLanguage ? ` (detected: ${sourceLanguageName})` : ""}` : sourceLanguageName}.`,
        `Target language: ${targetLanguageName}.`,
        `You MUST output only in ${targetLanguageName}. Do not output English unless the target language is English.`,
        "Preserve formatting and factual identifiers. Translate faithfully and naturally without adding or omitting meaning.",
        ...customerSupportGuidance,
        "Output only the translated text. Do not add explanations, prefixes, suffixes, quotes, or language labels.",
        ...(glossaryTerms.length > 0 ? [
          `Terminology choices: ${glossaryTerms.map((term) => `${term.source} => ${term.target}`).join("; ")}.`,
          "Use the terminology for lexical consistency, but inflect it and adjust capitalization to fit normal sentence grammar. Do not force title case or uppercase for common nouns inside a sentence; keep proper nouns and acronyms unchanged.",
        ] : []),
      ].join("\n");

      const translationOptions = {
        sourceLang: normalizedSourceLanguage === "auto"
          ? "auto"
          : QWEN_MT_LANGUAGE_NAMES[normalizedSourceLanguage],
        targetLang: QWEN_MT_LANGUAGE_NAMES[normalizedTargetLanguage],
        terms: glossaryTerms,
        domains: [
          "DICloak support: browser profiles, proxies, accounts, teams, and troubleshooting.",
          "Write natural, polite customer-support language without changing facts, requirements, or limitations.",
          "Use natural casing for terminology. Only capitalized plural Profiles in an operation path means the 环境管理 module; create/new profile(s) means 创建环境/新建环境.",
        ].join(" "),
      };
      const cacheKey = JSON.stringify([
        normalizedSourceLanguage,
        detectedSourceLanguage,
        normalizedTargetLanguage,
        text,
        translateConfig?.provider,
        translateConfig?.model,
        glossaryTerms,
      ]);
      const cached = text.length <= TRANSLATION_CACHE_MAX_INPUT_CHARS ? getCachedTranslation(cacheKey) : null;
      if (cached !== null) {
        console.info("[Translation Metrics]", { requestId, cacheHit: true, termMatchMs, totalMs: elapsedSince(requestStartedAt) });
        return cached;
      }
      const modelStartedAt = performance.now();
      const result = await callExtensionTranslateModel(systemPrompt, text, 0.1, translationOptions, translateConfig);
      const modelMs = elapsedSince(modelStartedAt);
      if (text.length <= TRANSLATION_CACHE_MAX_INPUT_CHARS) cacheTranslation(cacheKey, result);
      console.info("[Translation Metrics]", {
        requestId, cacheHit: false, knowledgeCacheHit, parseMs, detectMs, dependenciesMs,
        termMatchMs, modelMs, totalMs: elapsedSince(requestStartedAt), inputChars: text.length,
        matchedTermCount: glossaryTerms.length, provider: translateConfig?.provider, model: translateConfig?.model,
      });
      return result;
    };

    if (Array.isArray(targetLanguages) && targetLanguages.length > 0) {
      const entries = await Promise.all(uniqueTargetLanguages.map(async (language) => [language, await translateToLanguage(language)] as const));
      return NextResponse.json({
        translations: Object.fromEntries(entries),
        sourceLanguage: normalizedSourceLanguage,
        detectedSourceLanguage,
        targetLanguages: uniqueTargetLanguages,
      });
    }

    const normalizedTargetLanguage = uniqueTargetLanguages[0];
    if (request.headers.get("accept")?.includes("text/plain")) {
      const sourceLanguageName = detectedSourceLanguage
        ? LANGUAGE_PROMPT_NAMES[detectedSourceLanguage]
        : LANGUAGE_PROMPT_NAMES[normalizedSourceLanguage];
      const targetLanguageName = LANGUAGE_PROMPT_NAMES[normalizedTargetLanguage];
      const termMatchStartedAt = performance.now();
      const glossaryTerms = buildTranslationTerms(knowledgeTerms, text, detectedSourceLanguage || normalizedSourceLanguage, normalizedTargetLanguage);
      const termMatchMs = elapsedSince(termMatchStartedAt);
      const guidance = buildCustomerSupportTranslationGuidance(targetLanguageName);
      const systemPrompt = [
        "You are a professional DICloak customer-support translation engine.",
        `Source: ${normalizedSourceLanguage === "auto" ? `auto${detectedSourceLanguage ? ` (${sourceLanguageName})` : ""}` : sourceLanguageName}. Target: ${targetLanguageName}.`,
        `Output only ${targetLanguageName}; preserve formatting and factual identifiers; translate naturally without adding or omitting meaning.`,
        ...guidance,
        ...(glossaryTerms.length ? [`Terminology: ${glossaryTerms.map((term) => `${term.source} => ${term.target}`).join("; ")}.`] : []),
      ].join("\n");
      const options = {
        sourceLang: normalizedSourceLanguage === "auto" ? "auto" : QWEN_MT_LANGUAGE_NAMES[normalizedSourceLanguage],
        targetLang: QWEN_MT_LANGUAGE_NAMES[normalizedTargetLanguage],
        terms: glossaryTerms,
        domains: "DICloak support: browser profiles, proxies, accounts, teams, and troubleshooting. Write natural, polite support language without changing facts.",
      };
      const cacheKey = JSON.stringify([normalizedSourceLanguage, detectedSourceLanguage, normalizedTargetLanguage, text, translateConfig?.provider, translateConfig?.model, glossaryTerms]);
      const cached = text.length <= TRANSLATION_CACHE_MAX_INPUT_CHARS ? getCachedTranslation(cacheKey) : null;
      if (cached !== null) {
        console.info("[Translation Metrics]", { requestId, cacheHit: true, totalMs: elapsedSince(requestStartedAt) });
        return new NextResponse(cached, { headers: { "Content-Type": "text/plain; charset=utf-8", "X-Detected-Source-Language": detectedSourceLanguage || "" } });
      }
      const modelStartedAt = performance.now();
      const upstream = await callExtensionTranslateModelStream(translateConfig, systemPrompt, text, 0.1, options);
      let completedTranslation = "";
      const decoder = new TextDecoder();
      const measuredStream = upstream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          completedTranslation += decoder.decode(chunk, { stream: true });
          controller.enqueue(chunk);
        },
        flush() {
          completedTranslation += decoder.decode();
          if (text.length <= TRANSLATION_CACHE_MAX_INPUT_CHARS) cacheTranslation(cacheKey, completedTranslation.trim());
          console.info("[Translation Metrics]", {
            requestId, cacheHit: false, knowledgeCacheHit, parseMs, detectMs, dependenciesMs,
            termMatchMs, modelMs: elapsedSince(modelStartedAt), totalMs: elapsedSince(requestStartedAt),
            inputChars: text.length, matchedTermCount: glossaryTerms.length,
            provider: translateConfig?.provider, model: translateConfig?.model,
          });
        },
      }));
      return new NextResponse(measuredStream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache", "X-Detected-Source-Language": detectedSourceLanguage || "" } });
    }
    const translation = await translateToLanguage(normalizedTargetLanguage);

    return NextResponse.json({
      translation,
      sourceLanguage: normalizedSourceLanguage,
      detectedSourceLanguage,
      targetLanguage: normalizedTargetLanguage,
    });
  } catch (error) {
    console.error("Translation error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "翻译失败" }, { status: 500 });
  }
}
