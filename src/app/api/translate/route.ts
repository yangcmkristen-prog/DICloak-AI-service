import { NextRequest, NextResponse } from "next/server";
import { callExtensionTranslateModel } from "../copilot/shared";
import { getSupabaseClient } from "@/storage/database/supabase-client";

const LANGUAGE_NAMES: Record<string, string> = {
  auto: "自动检测",
  zh: "简体中文",
  en: "英语",
  es: "西班牙语",
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

const LANGUAGE_PROMPT_NAMES: Record<string, string> = {
  auto: "Auto Detect",
  zh: "Simplified Chinese (中文简体, zh-Hans)",
  en: "English",
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

type TermRecord = Record<string, unknown>;

function readTermField(term: TermRecord, language: string): string {
  const fieldMap: Record<string, string[]> = {
    zh: ["termCN", "zh", "cn", "中文"],
    en: ["termEN", "en", "英文"],
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

async function getKnowledgeTerms(): Promise<TermRecord[]> {
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

function buildTranslationTerms(terms: TermRecord[], text: string, sourceLanguage: string | null, targetLanguage: string): TranslationTerm[] {
  const normalizedText = text.toLowerCase();
  const sourceLanguages = sourceLanguage && sourceLanguage !== "auto"
    ? [sourceLanguage]
    : ["zh", "en", "es", "pt-BR", "pt-PT", "ru", "vi"];
  const result: TranslationTerm[] = [];
  const seen = new Set<string>();

  for (const term of terms) {
    const target = readTermField(term, targetLanguage);
    if (!target) continue;

    for (const language of sourceLanguages) {
      const source = readTermField(term, language);
      if (!source || source === target) continue;

      const sourceLower = source.toLowerCase();
      if (!normalizedText.includes(sourceLower)) continue;

      const key = `${sourceLower}->${target.toLowerCase()}`;
      if (seen.has(key)) continue;

      seen.add(key);
      result.push({ source, target });
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
  if (/\b(hemos|desactivar|agregar|entre|otros|hola|gracias|usted|puedo|necesito|cuenta|equipo|configuración|configuracion|contraseña|contrasena|archivo|carpeta|problema)\b/.test(lower) || /[¿¡ñáéíóúü]/.test(lower)) return "es";
  if (/\b(você|voce|obrigado|obrigada|não|nao|estou|preciso|conta|equipe|configurações|configuracoes)\b/.test(lower)) return "pt-BR";
  if (/\b(tu|estás|estas|ficheiro|telemóvel|telemovel|factura|fatura)\b/.test(lower)) return "pt-PT";
  if (/\b(bạn|tôi|không|cần|tài khoản|nhóm)\b/.test(lower)) return "vi";
  if (/\b(saya|anda|tidak|akun|tim|pengaturan)\b/.test(lower)) return "id";
  if (/[а-яё]/i.test(text)) return "ru";
  return null;
}

export async function POST(request: NextRequest) {
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

    const normalizedSourceLanguage = normalizeLanguage(sourceLanguage, "auto", true);
    const detectedSourceLanguage = normalizedSourceLanguage === "auto"
      ? detectSourceLanguage(text)
      : normalizedSourceLanguage;
    const requestedTargetLanguages = Array.isArray(targetLanguages) && targetLanguages.length > 0
      ? targetLanguages.map((language) => normalizeLanguage(language, "zh", false))
      : [normalizeLanguage(targetLanguage, "zh", false)];
    const uniqueTargetLanguages = [...new Set(requestedTargetLanguages)];
    const knowledgeTerms = await getKnowledgeTerms();

    const translateToLanguage = async (normalizedTargetLanguage: string): Promise<string> => {
      const sourceLanguageName = detectedSourceLanguage
        ? LANGUAGE_PROMPT_NAMES[detectedSourceLanguage]
        : LANGUAGE_PROMPT_NAMES[normalizedSourceLanguage];
      const targetLanguageName = LANGUAGE_PROMPT_NAMES[normalizedTargetLanguage];
      const glossaryTerms = buildTranslationTerms(knowledgeTerms, text, detectedSourceLanguage || normalizedSourceLanguage, normalizedTargetLanguage);

      const systemPrompt = [
        "You are a professional translation engine for DICloak customer support.",
        `Source language: ${normalizedSourceLanguage === "auto" ? `auto-detect${detectedSourceLanguage ? ` (detected: ${sourceLanguageName})` : ""}` : sourceLanguageName}.`,
        `Target language: ${targetLanguageName}.`,
        `You MUST output only in ${targetLanguageName}. Do not output English unless the target language is English.`,
        "Preserve tone, line breaks, numbers, emails, URLs, product names, account information, proper nouns, and contextual meaning.",
        "Output only the translated text. Do not add explanations, prefixes, suffixes, quotes, or language labels.",
        ...(glossaryTerms.length > 0 ? [`Use this terminology exactly: ${glossaryTerms.map((term) => `${term.source} => ${term.target}`).join("; ")}.`] : []),
      ].join("\n");

      return callExtensionTranslateModel(systemPrompt, text, 0.1, {
        sourceLang: normalizedSourceLanguage === "auto"
          ? "auto"
          : QWEN_MT_LANGUAGE_NAMES[normalizedSourceLanguage],
        targetLang: QWEN_MT_LANGUAGE_NAMES[normalizedTargetLanguage],
        terms: glossaryTerms,
      });
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
