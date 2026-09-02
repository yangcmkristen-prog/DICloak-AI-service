import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import { createSavedPhraseProductVersions, type ProductPhraseVersions } from "@/lib/saved-phrase-products";

const CONFIG_KEY = "saved_phrases";

type SavedPhraseFolder = { id: string; name: string; parentId: string | null };
type SavedPhrase = {
  id: string;
  name: string;
  sourceText: string;
  folderId: string | null;
  translations: Record<string, string>;
  productVersions: ProductPhraseVersions;
  createdAt: number;
};
type SavedPhraseState = { folders: SavedPhraseFolder[]; phrases: SavedPhrase[] };

function normalizeSavedPhraseFolder(folder: unknown): SavedPhraseFolder {
  if (!folder || typeof folder !== "object") return { id: crypto.randomUUID(), name: "未命名文件夹", parentId: null };
  const candidate = folder as { id?: unknown; name?: unknown; parentId?: unknown };
  return {
    id: typeof candidate.id === "string" ? candidate.id : crypto.randomUUID(),
    name: typeof candidate.name === "string" ? candidate.name : "未命名文件夹",
    parentId: typeof candidate.parentId === "string" ? candidate.parentId : null,
  };
}

function normalizeSavedPhraseState(value: unknown): SavedPhraseState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { folders: [], phrases: [] };
  }

  const data = value as Partial<SavedPhraseState>;
  return {
    folders: Array.isArray(data.folders) ? data.folders.map(normalizeSavedPhraseFolder) : [],
    phrases: Array.isArray(data.phrases) ? data.phrases.flatMap((phrase): SavedPhrase[] => {
      if (!phrase || typeof phrase !== "object") return [];
      const candidate = phrase as Partial<SavedPhrase>;
      if (typeof candidate.id !== "string" || typeof candidate.sourceText !== "string") return [];
      const translations = candidate.translations && typeof candidate.translations === "object"
        ? candidate.translations
        : {};
      return [{
        id: candidate.id,
        name: typeof candidate.name === "string" ? candidate.name : candidate.sourceText,
        sourceText: candidate.sourceText,
        folderId: typeof candidate.folderId === "string" ? candidate.folderId : null,
        translations,
        productVersions: createSavedPhraseProductVersions(candidate.sourceText, translations),
        createdAt: typeof candidate.createdAt === "number" ? candidate.createdAt : Date.now(),
      }];
    }) : [],
  };
}

export async function GET() {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from("system_configs")
      .select("config_value, updated_at")
      .eq("config_key", CONFIG_KEY)
      .maybeSingle();

    if (error) {
      console.error("获取收纳话术失败:", error);
      return NextResponse.json({ error: "获取失败" }, { status: 500 });
    }

    const normalizedState = normalizeSavedPhraseState(data?.config_value);
    const needsProductVersionMigration = data !== null
      && JSON.stringify(data.config_value) !== JSON.stringify(normalizedState);

    if (needsProductVersionMigration) {
      const { error: migrationError } = await client
        .from("system_configs")
        .upsert(
          {
            config_key: CONFIG_KEY,
            config_value: normalizedState,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "config_key" },
        );
      if (migrationError) console.error("迁移收纳话术产品版本失败:", migrationError);
    }

    return NextResponse.json({
      success: true,
      data: normalizedState,
      isEmpty: !data,
      updatedAt: data?.updated_at || null,
    });
  } catch (error) {
    console.error("获取收纳话术异常:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json() as { data?: unknown };
    const nextState = normalizeSavedPhraseState(body.data);
    const client = getSupabaseClient();
    const { data, error } = await client
      .from("system_configs")
      .upsert(
        {
          config_key: CONFIG_KEY,
          config_value: nextState,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "config_key" },
      )
      .select("config_value, updated_at")
      .single();

    if (error) {
      console.error("保存收纳话术失败:", error);
      return NextResponse.json({ error: "保存失败" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: normalizeSavedPhraseState(data.config_value),
      updatedAt: data.updated_at,
    });
  } catch (error) {
    console.error("保存收纳话术异常:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
