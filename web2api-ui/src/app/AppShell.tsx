import { useEffect, useMemo } from "react";

import type { AIModelId, ApiModel, ChatSession, UserAgent } from "@/types/chat";
import { AI_MODELS, groupChatsByDate, SUGGESTION_PROMPTS } from "@/data/mockChats";
import type { ChatGroup } from "@/data/mockChats";

import { useConversationStore } from "@/stores/conversationStore";
import { CookieSetupModal } from "@/components/modals/CookieSetupModal";

import { TooltipProvider } from "@/components/ui/tooltip";
import { ChatHome } from "@/components/chat/ChatHome";
import { Sidebar, CollapsedSidebarRail } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { MobileSidebar } from "@/components/layout/MobileSidebar";
import { ChatMessages } from "@/components/chat/ChatMessages";

// ---------------------------------------------------------------------------
// Prop interfaces (kept for component contracts)
// ---------------------------------------------------------------------------

export interface SidebarProps {
  groups: ChatGroup[];
  activeChatId: string | null;
  collapsed: boolean;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onToggleCollapse: () => void;
  onDeleteChat: (id: string) => void;
  onRenameChat: (id: string, title: string) => void;
  onClearAll: () => void;
}

export interface MobileSidebarProps {
  groups: ChatGroup[];
  activeChatId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onDeleteChat: (id: string) => void;
  onRenameChat: (id: string, title: string) => void;
  onClearAll: () => void;
}

export interface TopBarProps {
  activeChat: ChatSession | null;
  onNewChat: () => void;
}

export interface ChatHomeProps {
  selectedModelId: AIModelId;
  onSendMessage: (content: string) => void;
  disabled?: boolean;
  onModelChange: (id: AIModelId) => void;
  availableModels: ApiModel[];
  myAgents: UserAgent[];
  selectedAgentId: string | null;
  onAgentChange: (id: string | null) => void;
}

export interface ChatMessagesProps {
  session: ChatSession;
  onSendMessage: (content: string) => void;
  selectedModelId: AIModelId;
  onModelChange: (id: AIModelId) => void;
  onDeleteMessage: (messageId: string) => void;
  onLoadMore: () => void;
  hasMore: boolean;
  isLoadingMore: boolean;
  availableModels: ApiModel[];
  myAgents: UserAgent[];
  selectedAgentId: string | null;
  onAgentChange: (id: string | null) => void;
  agentLocked: boolean;
}

// ---------------------------------------------------------------------------
// AppShell
// ---------------------------------------------------------------------------

export default function AppShell() {
  const {
    conversations,
    activeConversationId,
    messagesByConvId,
    messagesTotalByConvId,
    availableModels,
    myAgents,
    selectedAgentId,
    sidebarCollapsed,
    mobileSidebarOpen,
    selectedModelId,
    showCookieModal,
    isLoadingMoreMessages,
    loadConversations,
    loadModels,
    loadMyAgents,
    checkCookies,
    selectConversation,
    newChat,
    sendMessage,
    deleteConversation,
    deleteAllConversations,
    renameConversation,
    loadMoreMessages,
    deleteMessage,
    setSidebarCollapsed,
    setMobileSidebarOpen,
    setSelectedModelId,
    setSelectedAgentId,
    setShowCookieModal,
  } = useConversationStore();

  // On mount: load models, check cookies, load conversation list, load user agents
  useEffect(() => {
    void loadModels();
    void checkCookies();
    void loadConversations();
    void loadMyAgents();
  }, [loadModels, checkCookies, loadConversations, loadMyAgents]);

  // Derive sidebar groups from API conversations
  const sidebarGroups = useMemo(
    () => groupChatsByDate(conversations),
    [conversations],
  );

  // Derive active ChatSession for ChatMessages component
  const activeSession = useMemo((): ChatSession | null => {
    if (!activeConversationId) return null;
    const conv = conversations.find((c) => c.id === activeConversationId);
    if (!conv) return null;
    return {
      id: conv.id,
      title: conv.title,
      modelId: selectedModelId,
      createdAt: new Date(conv.created_at),
      updatedAt: new Date(conv.updated_at),
      messages: messagesByConvId[activeConversationId] ?? [],
    };
  }, [activeConversationId, conversations, messagesByConvId, selectedModelId]);

  const handleModelChange = (id: AIModelId) => {
    setSelectedModelId(id);
  };

  // The agent is bound to the conversation once chat starts — lock it there.
  const activeConversation = activeConversationId
    ? conversations.find((c) => c.id === activeConversationId)
    : null;
  const activeAgentId = activeConversation?.agent_id ?? null;

  return (
    <TooltipProvider>
      <div className="app-bg flex h-screen w-screen overflow-hidden text-foreground">
        {/* Desktop sidebar (user-toggleable expand/collapse) */}
        <div className="hidden md:flex">
          <Sidebar
            groups={sidebarGroups}
            activeChatId={activeConversationId}
            collapsed={sidebarCollapsed}
            onSelectChat={(id) => void selectConversation(id)}
            onNewChat={newChat}
            onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
            onDeleteChat={(id) => void deleteConversation(id)}
            onRenameChat={(id, title) => void renameConversation(id, title)}
            onClearAll={() => void deleteAllConversations()}
          />
        </div>

        {/* Mobile: persistent collapsed icon rail — hidden while the drawer is
            open so its translucent glass background can't bleed through the
            drawer (which caused overlapping logos) or intercept clicks meant
            for the drawer's own controls. */}
        {!mobileSidebarOpen && (
          <div className="flex md:hidden">
            <CollapsedSidebarRail onNewChat={newChat} onOpenMenu={() => setMobileSidebarOpen(true)} />
          </div>
        )}

        {/* Mobile sidebar */}
        <MobileSidebar
          groups={sidebarGroups}
          activeChatId={activeConversationId}
          open={mobileSidebarOpen}
          onOpenChange={setMobileSidebarOpen}
          onSelectChat={(id) => void selectConversation(id)}
          onNewChat={newChat}
          onDeleteChat={(id) => void deleteConversation(id)}
          onRenameChat={(id, title) => void renameConversation(id, title)}
          onClearAll={() => void deleteAllConversations()}
        />

        {/* Main content */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          <TopBar
            activeChat={activeSession}
            onNewChat={newChat}
          />

          <main className="min-w-0 flex-1 overflow-hidden">
            {activeSession ? (
              <ChatMessages
                session={activeSession}
                onSendMessage={(content) => void sendMessage(content)}
                selectedModelId={selectedModelId}
                onModelChange={handleModelChange}
                onDeleteMessage={(msgId) => void deleteMessage(activeConversationId!, msgId)}
                onLoadMore={() => void loadMoreMessages(activeConversationId!)}
                hasMore={
                  (messagesTotalByConvId[activeConversationId!] ?? 0) >
                  (messagesByConvId[activeConversationId!]?.length ?? 0)
                }
                isLoadingMore={isLoadingMoreMessages}
                availableModels={availableModels}
                myAgents={myAgents}
                selectedAgentId={activeAgentId}
                onAgentChange={setSelectedAgentId}
                agentLocked
              />
            ) : (
              <ChatHome
                selectedModelId={selectedModelId}
                onSendMessage={(content) => void sendMessage(content)}
                onModelChange={handleModelChange}
                availableModels={availableModels}
                myAgents={myAgents}
                selectedAgentId={selectedAgentId}
                onAgentChange={setSelectedAgentId}
              />
            )}
          </main>
        </div>

        {/* Cookie setup modal — blocks UI until Gemini is connected */}
        {showCookieModal && (
          <CookieSetupModal onSuccess={() => setShowCookieModal(false)} />
        )}
      </div>
    </TooltipProvider>
  );
}

export { AI_MODELS, SUGGESTION_PROMPTS };
