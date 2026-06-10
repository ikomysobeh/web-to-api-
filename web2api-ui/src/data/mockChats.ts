import type { AIModel, ApiConversation, SuggestionPrompt } from "@/types/chat";

// ---------------------------------------------------------------------------
// AI Models  (Flash · Pro · Reasoning)
// ---------------------------------------------------------------------------

export const AI_MODELS: AIModel[] = [
  {
    id: "lumina-flash",
    name: "Lumina Flash",
    description: "Fastest responses. Ideal for quick questions and simple tasks.",
    contextWindow: "32K tokens",
    badge: "Fast",
  },
  {
    id: "lumina-pro",
    name: "Lumina Pro",
    description: "Best balance of speed and quality for everyday work.",
    contextWindow: "128K tokens",
    badge: "Pro",
  },
  {
    id: "lumina-reasoning",
    name: "Lumina Reasoning",
    description: "Deep step-by-step reasoning for complex problems and research.",
    contextWindow: "1M tokens",
    badge: "Reasoning",
  },
];

// ---------------------------------------------------------------------------
// Suggestion prompts (shown on the empty state / home screen)
// ---------------------------------------------------------------------------

export const SUGGESTION_PROMPTS: SuggestionPrompt[] = [
  {
    id: "sp-1",
    icon: "Code2",
    title: "Write code",
    prompt: "Write a React hook that debounces a value with TypeScript types.",
  },
  {
    id: "sp-2",
    icon: "Lightbulb",
    title: "Brainstorm ideas",
    prompt: "Give me 10 unique startup ideas in the productivity space.",
  },
  {
    id: "sp-3",
    icon: "FileText",
    title: "Summarise text",
    prompt: "Summarise the following article in 3 bullet points:\n\n[paste text here]",
  },
  {
    id: "sp-4",
    icon: "GraduationCap",
    title: "Explain a concept",
    prompt: "Explain how transformers work in machine learning, using simple analogies.",
  },
  {
    id: "sp-5",
    icon: "PenLine",
    title: "Draft an email",
    prompt: "Write a professional follow-up email after a product demo with a potential client.",
  },
  {
    id: "sp-6",
    icon: "Bug",
    title: "Debug code",
    prompt: "Here is a piece of code that isn't working as expected. Can you help me debug it?\n\n```ts\n// paste code here\n```",
  },
];

// ---------------------------------------------------------------------------
// Sidebar grouping utility
// Accepts ApiConversation[] (from backend) and groups by updated_at date.
// ---------------------------------------------------------------------------

export interface ChatGroup {
  label: string;
  chats: ApiConversation[];
}

export function groupChatsByDate(chats: ApiConversation[]): ChatGroup[] {
  const now = new Date();
  const today: ApiConversation[] = [];
  const yesterday: ApiConversation[] = [];
  const last7Days: ApiConversation[] = [];
  const older: ApiConversation[] = [];

  for (const chat of chats) {
    const updatedMs = new Date(chat.updated_at).getTime();
    const diffDays = (now.getTime() - updatedMs) / (1000 * 60 * 60 * 24);

    if (diffDays < 1) today.push(chat);
    else if (diffDays < 2) yesterday.push(chat);
    else if (diffDays < 7) last7Days.push(chat);
    else older.push(chat);
  }

  const groups: ChatGroup[] = [];
  if (today.length) groups.push({ label: "Today", chats: today });
  if (yesterday.length) groups.push({ label: "Yesterday", chats: yesterday });
  if (last7Days.length)
    groups.push({ label: "Previous 7 days", chats: last7Days });
  if (older.length) groups.push({ label: "Older", chats: older });

  return groups;
}
