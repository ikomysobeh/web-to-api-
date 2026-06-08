import type { AIModel, ChatMessage, ChatSession, SuggestionPrompt } from "@/types/chat";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

// ---------------------------------------------------------------------------
// AI Models  (Flash Â· Pro Â· Reasoning)
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
// ChatMessage builders
// ---------------------------------------------------------------------------

function userMsg(content: string, createdAt?: Date): ChatMessage {
  return {
    id: makeId(),
    role: "user",
    content,
    createdAt: createdAt ?? new Date(),
    status: "done",
  };
}

function assistantMsg(content: string, createdAt?: Date): ChatMessage {
  return {
    id: makeId(),
    role: "assistant",
    content,
    createdAt: createdAt ?? new Date(),
    status: "done",
  };
}

// ---------------------------------------------------------------------------
// Mock chat sessions
// 5 sessions total: 2 with full message history, 3 metadata-only
// ---------------------------------------------------------------------------

export const MOCK_CHATS: ChatSession[] = [
  // â”€â”€ Session 1 â”€â”€ full messages (today, pinned)
  {
    id: "chat-1",
    title: "React hook for debouncing",
    modelId: "lumina-pro",
    createdAt: daysAgo(0),
    updatedAt: daysAgo(0),
    pinned: true,
    messages: [
      userMsg(
        "Write a React hook that debounces a value with proper TypeScript types.",
        daysAgo(0),
      ),
      assistantMsg(
        `Here's a fully-typed \`useDebounce\` hook:\n\n\`\`\`ts\nimport { useState, useEffect } from "react";\n\nexport function useDebounce<T>(value: T, delay: number): T {\n  const [debounced, setDebounced] = useState<T>(value);\n\n  useEffect(() => {\n    const handler = setTimeout(() => setDebounced(value), delay);\n    return () => clearTimeout(handler);\n  }, [value, delay]);\n\n  return debounced;\n}\n\`\`\`\n\n**Usage:**\n\`\`\`tsx\nconst debouncedSearch = useDebounce(searchTerm, 400);\n\`\`\`\n\nThe generic \`<T>\` ensures the hook retains the exact type of whatever value you pass in â€” \`string\`, \`number\`, or a complex object.`,
        daysAgo(0),
      ),
      userMsg(
        "Can you add a leading-edge option to fire immediately on the first call?",
        daysAgo(0),
      ),
      assistantMsg(
        `Sure! Here's the extended version with a \`leading\` option:\n\n\`\`\`ts\nimport { useState, useEffect, useRef } from "react";\n\ninterface DebounceOptions {\n  leading?: boolean;\n}\n\nexport function useDebounce<T>(\n  value: T,\n  delay: number,\n  options: DebounceOptions = {},\n): T {\n  const { leading = false } = options;\n  const [debounced, setDebounced] = useState<T>(value);\n  const isFirstCall = useRef(true);\n\n  useEffect(() => {\n    if (leading && isFirstCall.current) {\n      setDebounced(value);\n      isFirstCall.current = false;\n      return;\n    }\n    const handler = setTimeout(() => {\n      setDebounced(value);\n      isFirstCall.current = true;\n    }, delay);\n    return () => clearTimeout(handler);\n  }, [value, delay, leading]);\n\n  return debounced;\n}\n\`\`\``,
        daysAgo(0),
      ),
    ],
  },

  // â”€â”€ Session 2 â”€â”€ full messages (yesterday)
  {
    id: "chat-2",
    title: "How transformers work",
    modelId: "lumina-reasoning",
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
    messages: [
      userMsg(
        "Explain how transformers work in machine learning, using simple analogies.",
        daysAgo(1),
      ),
      assistantMsg(
        `Great question! Let me break it down with everyday analogies.\n\n**Reading the whole sentence at once**\nOlder models (RNNs) read text word-by-word like someone listening to speech. Transformers are more like a room of people who each hold a printed copy of the entire passage â€” everyone sees everything simultaneously.\n\n**Attention: "who is talking about whom?"**\nEach word asks every other word: *"how relevant are you to me right now?"* and receives a score. So in *"The cat sat on the mat because it was tired"*, the word "it" correctly attends most strongly to "cat".\n\n**Multi-head attention**\nRather than one conversation, imagine 8â€“16 parallel discussions each focusing on a different relationship â€” grammar, semantics, coreference â€” and then merging notes at the end.\n\n**Positional encoding**\nBecause everyone reads at once, words need position stamps. Without them, "dog bites man" and "man bites dog" would look identical to the model.\n\n**Result:** Transformers parallelise on GPUs, handle very long contexts, and learn richer representations â€” which is why they power everything from large language models to image generators.`,
        daysAgo(1),
      ),
      userMsg("What is multi-head attention, specifically?", daysAgo(1)),
      assistantMsg(
        `Multi-head attention runs several independent attention operations ("heads") in parallel, each with its own learned weight matrices.\n\nIn pseudocode:\n\`\`\`\nfor each head i:\n    Q_i = X @ W_Q_i\n    K_i = X @ W_K_i\n    V_i = X @ W_V_i\n    head_i = softmax(Q_i @ K_i.T / sqrt(d_k)) @ V_i\n\noutput = concat(head_1, ..., head_h) @ W_O\n\`\`\`\n\nEach head can specialise: one might track syntactic dependencies, another semantic similarity, another long-range coreference. The final projection \`W_O\` blends them back into a single representation. A typical model like GPT-3 uses 96 heads across 96 layers.`,
        daysAgo(1),
      ),
    ],
  },

  // â”€â”€ Session 3 â”€â”€ metadata only (2 days ago)
  {
    id: "chat-3",
    title: "Startup ideas in productivity",
    modelId: "lumina-flash",
    createdAt: daysAgo(2),
    updatedAt: daysAgo(2),
    messages: [],
  },

  // â”€â”€ Session 4 â”€â”€ metadata only (4 days ago)
  {
    id: "chat-4",
    title: "Professional follow-up email",
    modelId: "lumina-pro",
    createdAt: daysAgo(4),
    updatedAt: daysAgo(4),
    messages: [],
  },

  // â”€â”€ Session 5 â”€â”€ metadata only (6 days ago)
  {
    id: "chat-5",
    title: "CSS Grid vs Flexbox",
    modelId: "lumina-flash",
    createdAt: daysAgo(6),
    updatedAt: daysAgo(6),
    messages: [],
  },
];

// ---------------------------------------------------------------------------
// Sidebar grouping utility
// ---------------------------------------------------------------------------

export interface ChatGroup {
  label: string;
  chats: ChatSession[];
}

export function groupChatsByDate(chats: ChatSession[]): ChatGroup[] {
  const now = new Date();
  const today: ChatSession[] = [];
  const yesterday: ChatSession[] = [];
  const last7Days: ChatSession[] = [];
  const older: ChatSession[] = [];

  for (const chat of chats) {
    const diffDays =
      (now.getTime() - chat.updatedAt.getTime()) / (1000 * 60 * 60 * 24);

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
