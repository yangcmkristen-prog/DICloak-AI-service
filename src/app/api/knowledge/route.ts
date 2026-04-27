import { NextRequest, NextResponse } from "next/server";
import { getKnowledgeItems, addKnowledgeItem, deleteKnowledgeItem, updateKnowledgeItem } from "@/lib/store";

export async function GET() {
  try {
    const items = getKnowledgeItems();
    return NextResponse.json({ items });
  } catch (error) {
    console.error("Get knowledge error:", error);
    return NextResponse.json({ error: "获取知识库失败" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const item = await request.json();
    if (!item.name || !item.type) {
      return NextResponse.json({ error: "缺少必要参数" }, { status: 400 });
    }
    const newItem = addKnowledgeItem(item);
    return NextResponse.json({ item: newItem });
  } catch (error) {
    console.error("Add knowledge error:", error);
    return NextResponse.json({ error: "添加知识库失败" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { id, ...updates } = await request.json();
    if (!id) {
      return NextResponse.json({ error: "缺少知识库ID" }, { status: 400 });
    }
    updateKnowledgeItem(id, updates);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update knowledge error:", error);
    return NextResponse.json({ error: "更新知识库失败" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "缺少知识库ID" }, { status: 400 });
    }
    deleteKnowledgeItem(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete knowledge error:", error);
    return NextResponse.json({ error: "删除知识库失败" }, { status: 500 });
  }
}
