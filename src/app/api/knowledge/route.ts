import { NextRequest, NextResponse } from "next/server";
import { getKnowledgeBase, getKnowledgeStats, replaceKnowledgeData } from "@/lib/store";

export async function GET() {
  try {
    const knowledge = getKnowledgeBase();
    const stats = getKnowledgeStats();
    return NextResponse.json({ knowledge, stats });
  } catch (error) {
    console.error("Get knowledge error:", error);
    return NextResponse.json({ error: "获取知识库失败" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const data = await request.json();
    
    // 替换全部知识库数据
    if (data.knowledge) {
      replaceKnowledgeData(data.knowledge);
      return NextResponse.json({ success: true, stats: getKnowledgeStats() });
    }
    
    return NextResponse.json({ error: "缺少知识库数据" }, { status: 400 });
  } catch (error) {
    console.error("Save knowledge error:", error);
    return NextResponse.json({ error: "保存知识库失败" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    clearKnowledgeBase();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Clear knowledge error:", error);
    return NextResponse.json({ error: "清空知识库失败" }, { status: 500 });
  }
}
