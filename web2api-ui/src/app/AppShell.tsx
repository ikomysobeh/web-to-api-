import { useCallback, useEffect, useState } from "react";

import type { AIModelId, ChatMessage, ChatSession } from "@/types/chat";
import {
  AI_MODELS,
  groupChatsByDate,
  SUGGESTION_PROMPTS,
  type ChatGroup,
} from "@/data/mockChats";

import { useAuth } from "@/context/AuthContext";
import { getCookiesStatus, chatStream } from "@/services/api";
import { CookieSetupModal } from "@/components/modals/CookieSetupModal";

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

const MODEL_MAP: Record<AIModelId, string> = {
  "lumina-flash": "gemini-3-flash",
  "lumina-pro": "gemini-3-flash",
  "lumina-reasoning": "gemini-3-flash",
};

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

export default function AppShell() {
  const { token } = useAuth();

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState<AIModelId>("lumina-pro");
  const [showCookieModal, setShowCookieModal] = useState(false);

  const activeChat = sessions.find((s) => s.id === activeChatId) ?? null;
  const sidebarGroups = groupChatsByDate(sessions);

  useEffect(() => {
    if (!token) return;
    getCookiesStatus(token)
      .then((data) => {
        if (!data.connected) setShowCookieModal(true);
      })
      .catch(() => {
        setShowCookieModal(true);
      });
  }, [token]);

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
      if (!trimmed || !token) return;

      const userMessage = msg("user", trimmed);
      const pendingReply = msg("assistant", "", "streaming");
      const replyId = pendingReply.id;
      const backendModel = MODEL_MAP[selectedModelId];

      let targetSessionId: string;

      if (activeChatId) {
        targetSessionId = activeChatId;
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
      } else {
        const newSession: ChatSession = {
          id: generateId(),
          title: buildTitle(trimmed),
          modelId: selectedModelId,
          createdAt: new Date(),
          updatedAt: new Date(),
          messages: [userMessage, pendingReply],
        };
        targetSessionId = newSession.id;
        setSessions((prev) => [newSession, ...prev]);
        setActiveChatId(newSession.id);
      }

      void (async () => {
        let fullContent = "";
        try {
          const res = await chatStream(token, trimmed, backendModel);
          const reader = res.body!.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const data = line.slice(6).trim();
              if (data === "[DONE]") continue;

              let chunk = "";
              try {
                const json = JSON.parse(data) as {
                  choices?: { delta?: { content?: string } }[];
                  content?: string;
                };
                chunk =
                  json.choices?.[0]?.delta?.content ??
                  json.content ??
                  "";
              } catch {
                chunk = data;
              }

              if (chunk) {
                fullContent += chunk;
                setSessions((prev) =>
                  prev.map((s) =>
                    s.id === targetSessionId
                      ? {
                          ...s,
                          messages: s.messages.map((m) =>
                            m.id === replyId
                              ? { ...m, content: fullContent }
                              : m,
                          ),
                        }
                      : s,
                  ),
                );
              }
            }
          }

          setSessions((prev) =>
            prev.map((s) =>
              s.id === targetSessionId
                ? {
                    ...s,
                    messages: s.messages.map((m) =>
                      m.id === replyId
                        ? { ...m, content: fullContent, status: "done" as const }
                        : m,
                    ),
                  }
                : s,
            ),
          );
        } catch {
          setSessions((prev) =>
            prev.map((s) =>
              s.id === targetSessionId
                ? {
                    ...s,
                    messages: s.messages.map((m) =>
                      m.id === replyId
                        ? {
                            ...m,
                            content: fullContent || "Sorry, something went wrong. Please try again.",
                            status: "error" as const,
                          }
                        : m,
                    ),
                  }
                : s,
            ),
          );
        }
      })();
    },
    [activeChatId, selectedModelId, token],
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

        <div className="relative flex min-w-0 flex-1 flex-col">
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

        {showCookieModal && (
          <CookieSetupModal onSuccess={() => setShowCookieModal(false)} />
        )}
      </div>
    </TooltipProvider>
  );
}

export { AI_MODELS, SUGGESTION_PROMPTS };
