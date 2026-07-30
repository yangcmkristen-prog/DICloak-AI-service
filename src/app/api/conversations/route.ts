import { NextRequest, NextResponse } from "next/server";
import { getConversations, createConversation, updateConversation, deleteConversation } from "@/lib/store";
import type { ProductName } from "@/lib/types";

export async function GET() {
  try {
    const conversations = getConversations();
    return NextResponse.json({ conversations });
  } catch (error) {
    console.error("Get conversations error:", error);
    return NextResponse.json({ error: "获取对话列表失败" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { title?: string; product?: ProductName };
    const product: ProductName = body.product === 'paraturbo' ? 'paraturbo' : 'dicloak';
    const conversation = createConversation(product, body.title);
    return NextResponse.json({ conversation });
  } catch (error) {
    console.error("Create conversation error:", error);
    return NextResponse.json({ error: "创建对话失败" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { id, ...updates } = await request.json();
    if (!id) {
      return NextResponse.json({ error: "缺少对话ID" }, { status: 400 });
    }
    updateConversation(id, updates);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update conversation error:", error);
    return NextResponse.json({ error: "更新对话失败" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "缺少对话ID" }, { status: 400 });
    }
    deleteConversation(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete conversation error:", error);
    return NextResponse.json({ error: "删除对话失败" }, { status: 500 });
  }
}
