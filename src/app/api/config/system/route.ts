import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

const CONFIG_KEY = 'default';

// 获取系统配置
export async function GET() {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('system_configs')
      .select('*')
      .eq('config_key', CONFIG_KEY)
      .maybeSingle();

    if (error) {
      console.error('获取系统配置失败:', error);
      return NextResponse.json({ error: '获取失败' }, { status: 500 });
    }

    // 如果没有数据，返回默认配置
    if (!data) {
      return NextResponse.json({
        success: true,
        data: {
          systemPrompt: '',
          apiConfig: null,
        },
        isEmpty: true,
      });
    }

    return NextResponse.json({
      success: true,
      data: data.config_value,
      version: data.version || 1,
      updatedAt: data.updated_at,
    });
  } catch (error) {
    console.error('获取系统配置异常:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

// 保存系统配置
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { systemPrompt, apiConfig, extensionTranslateApiConfig, imageOcrApiConfig } = body;

    const client = getSupabaseClient();

    // 先获取当前版本号
    const { data: existingConfig } = await client
      .from('system_configs')
      .select('version, config_value')
      .eq('config_key', CONFIG_KEY)
      .maybeSingle();
    
    const newVersion = (existingConfig?.version || 0) + 1;
    const currentValue =
      existingConfig?.config_value && typeof existingConfig.config_value === 'object' && !Array.isArray(existingConfig.config_value)
        ? existingConfig.config_value as Record<string, unknown>
        : {};

    // 使用 upsert 插入或更新
    const { data, error } = await client
      .from('system_configs')
      .upsert(
        {
          config_key: CONFIG_KEY,
          config_value: {
            ...currentValue,
            systemPrompt: systemPrompt || '',
            apiConfig: apiConfig || null,
            extensionTranslateApiConfig:
              extensionTranslateApiConfig === undefined
                ? currentValue.extensionTranslateApiConfig || null
                : extensionTranslateApiConfig || null,
            imageOcrApiConfig:
              imageOcrApiConfig === undefined
                ? currentValue.imageOcrApiConfig || null
                : imageOcrApiConfig || null,
          },
          version: newVersion,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'config_key' }
      )
      .select()
      .single();

    if (error) {
      console.error('保存系统配置失败:', error);
      return NextResponse.json({ error: '保存失败' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: data,
      version: newVersion,
      updatedAt: data.updated_at,
    });
  } catch (error) {
    console.error('保存系统配置异常:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
