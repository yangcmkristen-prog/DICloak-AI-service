import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import type { ApiConfig } from "@/lib/types";

const CONFIG_KEY = "default";

type ImagePayload = {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
};

async function getImageOcrApiConfig(): Promise<ApiConfig | null> {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from("system_configs")
      .select("config_value")
      .eq("config_key", CONFIG_KEY)
      .maybeSingle();

    if (error || !data?.config_value) return null;
    const value = data.config_value as Record<string, unknown>;
    return (value.imageOcrApiConfig as ApiConfig | undefined) || null;
  } catch (error) {
    console.error("获取图片识别配置失败:", error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { images?: unknown };
    const images = Array.isArray(body.images) ? body.images as ImagePayload[] : [];

    if (images.length === 0) {
      return NextResponse.json({ results: [] });
    }

    const config = await getImageOcrApiConfig();
    if (!config?.apiKey) {
      return NextResponse.json({ error: "请先在设置页配置图片识别模型 API Key" }, { status: 400 });
    }

    const baseUrl = config.baseUrl || "https://dashscope.aliyuncs.com/compatible-mode/v1";
    const results = await Promise.all(images.map(async (image) => {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model || "qwen-vl-ocr",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "请识别图片中的全部可见文字、报错信息、界面元素和关键上下文。只输出客观识别结果，不要给解决方案。",
                },
                {
                  type: "image_url",
                  image_url: { url: image.dataUrl },
                },
              ],
            },
          ],
          temperature: 0,
        }),
      });

      if (!response.ok) {
        throw new Error(`图片识别失败: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      return {
        id: image.id,
        name: image.name,
        text: data.choices?.[0]?.message?.content?.trim() || "",
      };
    }));

    return NextResponse.json({ results });
  } catch (error) {
    console.error("图片识别失败:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "图片识别失败" }, { status: 500 });
  }
}