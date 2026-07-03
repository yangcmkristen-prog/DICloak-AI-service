"use client";

import { useState, useEffect } from "react";
import { MessageSquare, Plus, Trash2, Edit3, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Conversation, ConversationRole } from "@/lib/types";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";


const ROLE_LABELS: Record<ConversationRole, string> = {
  client: "客户",
  end_user: "终端用户",
};

const ROLE_EMOJIS: Record<ConversationRole, string> = {
  client: "👤",
  end_user: "🙋",
};

function getConversationRole(conversation: Conversation): ConversationRole | null {
  const identity = conversation.context?.confirmedIdentity;
  return identity === "client" || identity === "end_user" ? identity : null;
}

interface ConversationListProps {
  conversations: Conversation[];
  currentConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onCreateConversation: () => void;
  onDeleteConversation: (id: string) => void;
  onRenameConversation: (id: string, title: string) => void;
  onUpdateConversationRole: (id: string, role: ConversationRole | null) => void;
}

export function ConversationList({
  conversations,
  currentConversationId,
  onSelectConversation,
  onCreateConversation,
  onDeleteConversation,
  onRenameConversation,
  onUpdateConversationRole,
}: ConversationListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [isTouchDevice, setIsTouchDevice] = useState(() => {
    // 初始检测：使用媒体查询和触摸点检测
    if (typeof window !== 'undefined') {
      const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      const isSmallScreen = window.matchMedia('(max-width: 768px)').matches;
      return isTouch || isSmallScreen;
    }
    return false;
  });

  // 检测是否为触摸设备（持续监听）
  useEffect(() => {
    const checkTouch = () => {
      const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      const isSmallScreen = window.matchMedia('(max-width: 768px)').matches;
      setIsTouchDevice(isTouch || isSmallScreen);
    };
    checkTouch();
    // 监听屏幕大小变化
    window.addEventListener('resize', checkTouch);
    return () => window.removeEventListener('resize', checkTouch);
  }, []);

  const handleStartEdit = (conversation: Conversation) => {
    setEditingId(conversation.id);
    setEditingTitle(conversation.title);
  };

  const handleSaveEdit = () => {
    if (editingId && editingTitle.trim()) {
      onRenameConversation(editingId, editingTitle.trim());
    }
    setEditingId(null);
    setEditingTitle("");
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditingTitle("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSaveEdit();
    } else if (e.key === "Escape") {
      handleCancelEdit();
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 新建按钮 */}
      <div className="p-4">
        <Button
          onClick={onCreateConversation}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white"
        >
          <Plus className="w-4 h-4 mr-2" />
          新建对话
        </Button>
      </div>

      <Separator />

      {/* 对话列表 */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1">
          {conversations.length === 0 ? (
            <div className="text-center text-muted-foreground text-sm py-8">
              暂无对话记录
            </div>
          ) : (
            conversations.map((conversation) => (
              <div
                key={conversation.id}
                className={`group relative flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                  currentConversationId === conversation.id
                    ? "bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800"
                    : "hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
                onMouseEnter={() => setHoveredId(conversation.id)}
                onMouseLeave={() => setHoveredId(null)}
                onTouchStart={() => setHoveredId(conversation.id)}
                onClick={() => {
                  if (editingId !== conversation.id) {
                    // 移动端：第一次点击显示操作按钮，第二次点击才选择对话
                    // PC端：hover 时已显示操作按钮，点击即选择对话
                    if (isTouchDevice) {
                      if (hoveredId === conversation.id) {
                        // 已显示操作按钮，再点击才选择对话
                        onSelectConversation(conversation.id);
                        setHoveredId(null);
                      } else {
                        // 第一次点击，显示操作按钮
                        setHoveredId(conversation.id);
                      }
                    } else {
                      onSelectConversation(conversation.id);
                    }
                  }
                }}
              >
                <MessageSquare className="w-4 h-4 shrink-0 text-gray-500" />

                {editingId === conversation.id ? (
                  <div className="flex-1 flex items-center gap-1">
                    <Input
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={handleKeyDown}
                      className="h-7 text-sm flex-1"
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSaveEdit();
                      }}
                    >
                      <Check className="w-3 h-3 text-green-600" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCancelEdit();
                      }}
                    >
                      <X className="w-3 h-3 text-gray-500" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <span className="flex-1 min-w-0 text-sm truncate">
                      {conversation.title}
                    </span>
                    {getConversationRole(conversation) ? (
                      <span className="shrink-0 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700 dark:bg-blue-950 dark:text-blue-200">
                        {ROLE_LABELS[getConversationRole(conversation)!]}
                      </span>
                    ) : null}

                    {/* 操作按钮 - PC端hover显示，移动端始终显示 */}
                    <div className="flex items-center gap-1 shrink-0 md:opacity-0 md:group-hover:opacity-100">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            title="选择角色"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <span className="text-xs" aria-hidden="true">
                              {getConversationRole(conversation) ? ROLE_EMOJIS[getConversationRole(conversation)!] : "👥"}
                            </span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenuItem onClick={() => onUpdateConversationRole(conversation.id, "client")}>
                            👤 客户
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onUpdateConversationRole(conversation.id, "end_user")}>
                            🙋 终端用户
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onUpdateConversationRole(conversation.id, null)}>
                            不确认角色
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStartEdit(conversation);
                        }}
                      >
                        <Edit3 className="w-3 h-3 text-gray-500" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteConversation(conversation.id);
                        }}
                      >
                        <Trash2 className="w-3 h-3 text-red-500" />
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
