import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient, SupabaseNotConfiguredError } from '@/storage/database/supabase-client';

const CONFIG_KEY = 'default';

// 获取系统配置
export async function GET() {
  try {
    let client;
    try {
      client = getSupabaseClient();
    } catch (error) {
      if (error instanceof SupabaseNotConfiguredError) {
        // Supabase 未配置，返回空数据
        console.log('Supabase 未配置，跳过系统配置同步');
        return NextResponse.json({
          success: true,
          data: {
            systemPrompt: '',
            apiConfig: null,
          },
          isEmpty: true,
        });
      }
      throw error;
    }

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
    const { systemPrompt, apiConfig } = body;

    let client;
    try {
      client = getSupabaseClient();
    } catch (error) {
      if (error instanceof SupabaseNotConfiguredError) {
        // Supabase 未配置，返回错误
        console.log('Supabase 未配置，无法保存系统配置');
        return NextResponse.json({ error: '数据库未配置，请联系管理员' }, { status: 503 });
      }
      throw error;
    }

    // 使用 upsert 插入或更新
    const { data, error } = await client
      .from('system_configs')
      .upsert(
        {
          config_key: CONFIG_KEY,
          config_value: {
            systemPrompt: systemPrompt || '',
            apiConfig: apiConfig || null,
          },
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
      updatedAt: data.updated_at,
    });
  } catch (error) {
    console.error('保存系统配置异常:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
