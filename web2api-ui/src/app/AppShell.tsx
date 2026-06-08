import { useCallback, useState } from "react";

import type { AIModelId, ChatMessage, ChatSession } from "@/types/chat";
import {
  AI_MODELS,
  groupChatsByDate,
  MOCK_CHATS,
  SUGGESTION_PROMPTS,
  type ChatGroup,
} from "@/data/mockChats";

import { TooltipProvider } from "@/components/ui/tooltip";
import { ChatHome } from "@/components/chat/ChatHome";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { MobileSidebar } from "@/components/layout/MobileSidebar";
import { ChatMessages } from "@/components/chat/ChatMessages";

export interface SidebarProps {
  groups: ChatGroup[];
  activeChatId: string | null;
  collapsed: boolean;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onToggleCollapse: () => void;
  onDeleteChat: (id: string) => void;
}

export interface MobileSidebarProps {
  groups: ChatGroup[];
  activeChatId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onDeleteChat: (id: string) => void;
}

export interface TopBarProps {
  activeChat: ChatSession | null;
  onOpenMobileSidebar: () => void;
  onNewChat: () => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

export interface ChatHomeProps {
  selectedModelId: AIModelId;
  onSendMessage: (content: string) => void;
  disabled?: boolean;
  onModelChange: (id: AIModelId) => void;
}

export interface ChatMessagesProps {
  session: ChatSession;
  onSendMessage: (content: string) => void;
  selectedModelId: AIModelId;
  onModelChange: (id: AIModelId) => void;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function buildTitle(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= 40) return trimmed;
  return trimmed.slice(0, 37) + "…";
}

function msg(
  role: ChatMessage["role"],
  content: string,
  status: ChatMessage["status"] = "done",
): ChatMessage {
  return { id: generateId(), role, content, createdAt: new Date(), status };
}

function mockAssistantReply(userContent: string): ChatMessage {
  const lower = userContent.toLowerCase();

  if (lower.includes("hello") || lower.includes("hi")) {
    return msg("assistant", "Hello! How can I help you today?");
  }

  if (lower.includes("code") || lower.includes("function")) {
    return msg(
      "assistant",
      "Sure! Here's a starting point. Let me know if you'd like me to adjust it.\n\n```ts\n// Your code here\n```",
    );
  }

  if (lower.includes("explain") || lower.includes("what is")) {
    return msg(
      "assistant",
      "Great question. Let me break that down for you step by step…",
    );
  }

  return msg(
    "assistant",
    "That's an interesting question! I'm Lumina AI — I can help you write code, explain concepts, draft documents, and much more. What would you like to explore?",
  );
}

export default function AppShell() {
  const [sessions, setSessions] = useState<ChatSession[]>(MOCK_CHATS);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState<AIModelId>("lumina-pro");

  const activeChat = sessions.find((s) => s.id === activeChatId) ?? null;
  const sidebarGroups = groupChatsByDate(sessions);

  const handleSelectChat = useCallback((id: string) => {
    setActiveChatId(id);
    setMobileSidebarOpen(false);
  }, []);

  const handleNewChat = useCallback(() => {
    setActiveChatId(null);
    setMobileSidebarOpen(false);
  }, []);

  const handleDeleteChat = useCallback(
    (id: string) => {
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (activeChatId === id) setActiveChatId(null);
    },
    [activeChatId],
  );

  const handleModelChange = useCallback(
    (id: AIModelId) => {
      setSelectedModelId(id);

      if (!activeChatId) return;

      setSessions((prev) =>
        prev.map((s) => (s.id === activeChatId ? { ...s, modelId: id } : s)),
      );
    },
    [activeChatId],
  );

  const handleSendMessage = useCallback(
    (content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return;

      const userMessage = msg("user", trimmed);
      const pendingReply = msg("assistant", "", "sending");

      if (activeChatId) {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === activeChatId
              ? {
                  ...s,
                  messages: [...s.messages, userMessage, pendingReply],
                  updatedAt: new Date(),
                }
              : s,
          ),
        );

        const replyId = pendingReply.id;
        const finalReply = mockAssistantReply(trimmed);

        window.setTimeout(() => {
          setSessions((prev) =>
            prev.map((s) =>
              s.id === activeChatId
                ? {
                    ...s,
                    messages: s.messages.map((m) =>
                      m.id === replyId ? { ...finalReply, id: replyId } : m,
                    ),
                  }
                : s,
            ),
          );
        }, 800);

        return;
      }

      const finalReply = mockAssistantReply(trimmed);
      const pendingFinalReply = { ...finalReply, status: "sending" as const };
      const newSession: ChatSession = {
        id: generateId(),
        title: buildTitle(trimmed),
        modelId: selectedModelId,
        createdAt: new Date(),
        updatedAt: new Date(),
        messages: [userMessage, pendingFinalReply],
      };

      setSessions((prev) => [newSession, ...prev]);
      setActiveChatId(newSession.id);

      const replyId = pendingFinalReply.id;

      window.setTimeout(() => {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === newSession.id
              ? {
                  ...s,
                  messages: s.messages.map((m) =>
                    m.id === replyId ? { ...finalReply, id: replyId } : m,
                  ),
                }
              : s,
          ),
        );
      }, 800);
    },
    [activeChatId, selectedModelId],
  );

  return (
    <TooltipProvider>
      <div className="flex h-screen w-screen overflow-hidden bg-zinc-950 text-foreground">
        <div className="hidden md:flex">
          <Sidebar
            groups={sidebarGroups}
            activeChatId={activeChatId}
            collapsed={sidebarCollapsed}
            onSelectChat={handleSelectChat}
            onNewChat={handleNewChat}
            onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
            onDeleteChat={handleDeleteChat}
          />
        </div>

        <MobileSidebar
          groups={sidebarGroups}
          activeChatId={activeChatId}
          open={mobileSidebarOpen}
          onOpenChange={setMobileSidebarOpen}
          onSelectChat={handleSelectChat}
          onNewChat={handleNewChat}
          onDeleteChat={handleDeleteChat}
        />

        <div className="relative flex min-w-0 flex-1 flex-col ">
          <TopBar
            activeChat={activeChat}
            onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
            onNewChat={handleNewChat}
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
          />

          <main className="flex-1 overflow-hidden">
            {activeChat ? (
              <ChatMessages
                session={activeChat}
                onSendMessage={handleSendMessage}
                selectedModelId={selectedModelId}
                onModelChange={handleModelChange}
              />
            ) : (
              <ChatHome
                selectedModelId={selectedModelId}
                onSendMessage={handleSendMessage}
                onModelChange={handleModelChange}
              />
            )}
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}

export { AI_MODELS, SUGGESTION_PROMPTS };