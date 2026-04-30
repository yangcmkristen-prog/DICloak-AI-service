import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

const CONFIG_KEY = 'default';

// 获取知识库配置
export async function GET() {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('knowledge_configs')
      .select('*')
      .eq('config_key', CONFIG_KEY)
      .maybeSingle();

    if (error) {
      console.error('获取知识库配置失败:', error);
      return NextResponse.json({ error: '获取失败' }, { status: 500 });
    }

    // 如果没有数据，返回空结构
    if (!data) {
      return NextResponse.json({
        success: true,
        data: {
          faqItems: [],
          troubleshootingItems: [],
          outOfScopeItems: [],
          mappingItems: [],
          functionKnowledge: [],
          termItems: [],
          lastUpdated: null,
        },
        isEmpty: true,
      });
    }

    // 检查知识库是否为空
    const kb = data.knowledge_data;
    const isEmpty = !kb.faqItems?.length && !kb.troubleshootingItems?.length && 
                    !kb.outOfScopeItems?.length && !kb.mappingItems?.length && 
                    !kb.functionKnowledge?.length && !kb.termItems?.length;

    return NextResponse.json({
      success: true,
      data: kb,
      updatedAt: data.updated_at,
      isEmpty,
    });
  } catch (error) {
    console.error('获取知识库配置异常:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

// 保存知识库配置
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { knowledgeData } = body;

    if (!knowledgeData) {
      return NextResponse.json({ error: '缺少知识库数据' }, { status: 400 });
    }

    const client = getSupabaseClient();

    // 使用 upsert 插入或更新
    const { data, error } = await client
      .from('knowledge_configs')
      .upsert(
        {
          config_key: CONFIG_KEY,
          knowledge_data: knowledgeData,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'config_key' }
      )
      .select()
      .single();

    if (error) {
      console.error('保存知识库配置失败:', error);
      return NextResponse.json({ error: '保存失败' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: data,
      updatedAt: data.updated_at,
    });
  } catch (error) {
    console.error('保存知识库配置异常:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
