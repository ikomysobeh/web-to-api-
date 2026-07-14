import { useCallback, useEffect, useRef, useState } from "react";
import {
  getEmbedBootstrap,
  chatStream,
  getCookiesStatus,
  getMe,
  listMyAgents,
  getMyAgentSuggestions,
  API_BASE,
} from "@/services/api";
import { WidgetChat, type WidgetMessage } from "@/components/widget/WidgetChat";
import { GeminiSetupGuide, type GeminiGuideState } from "@/components/widget/GeminiSetupGuide";
import type { EmbedConfigAppearance, Suggestion, UserAgent } from "@/types/chat";

const AUTH_BASE_FOR_LOGIN =
  (import.meta.env.VITE_WIDGET_URL as string | undefined)?.replace(/\/$/, "") ??
  window.location.origin;

function getEmbedKey(): string {
  return new URLSearchParams(window.location.search).get("embed") ?? "";
}

// Optional theme override from the host (e.g. the dashboard passes ?theme=dark|light
// so the embedded chat matches its light/dark mode).
function getThemeParam(): "dark" | "light" | null {
  const t = new URLSearchParams(window.location.search).get("theme");
  return t === "dark" || t === "light" ? t : null;
}

type Phase = "waiting-token" | "loading" | "ready" | "error";

export default function WidgetPage() {
  const embedKey = getEmbedKey();
  const [token, setToken] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("waiting-token");
  const [errorMsg, setErrorMsg] = useState("");

  const [appearance, setAppearance] = useState<EmbedConfigAppearance>({});
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [geminiConnected, setGeminiConnected] = useState(false);
  // True only once a cookie-status check has actually completed, so the
  // history-restore/purge logic below never runs on a guess.
  const [cookieChecked, setCookieChecked] = useState(false);
  const [connectPhase, setConnectPhase] = useState<"idle" | "connecting" | "success" | "error">("idle");
  const [connectError, setConnectError] = useState("");
  const [extInstalled, setExtInstalled] = useState(
    typeof document !== "undefined" && document.documentElement.dataset.luminaExt === "1",
  );

  const [messages, setMessages] = useState<WidgetMessage[]>([]);
  const [busy, setBusy] = useState(false);

  // Agents assigned to the logged-in user (GET /api/agents is scoped by token).
  // The user picks one via the header "New chat" menu; chat is sent to that
  // agent through POST /api/chat.
  const [myAgents, setMyAgents] = useState<UserAgent[]>([]);
  const [agentsLoaded, setAgentsLoaded] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  // Per-user, per-agent chat history persisted in this widget's localStorage so a
  // returning user sees their previous conversation. Keyed by embed + user email
  // + agent id to isolate users on shared devices and threads per agent.
  const [userKey, setUserKey] = useState<string | null>(null);
  const defaultSelectedRef = useRef(false);
  const historyRestoredRef = useRef(false);
  const purgedRef = useRef(false);
  const lastAgentKey = useCallback(
    (uk: string) => `lumina_last_agent:${embedKey}:${uk}`,
    [embedKey],
  );
  const chatKey = useCallback(
    (uk: string, agentId: string) => `lumina_chat:${embedKey}:${uk}:${agentId}`,
    [embedKey],
  );
  // Drop the transient empty assistant placeholder before persisting/restoring.
  const cleanHistory = (list: WidgetMessage[]) =>
    list.filter((m) => m.role === "user" || m.content);

  // Show the "connected" confirmation briefly, then reveal the chat.
  const markConnected = useCallback(() => {
    setConnectPhase("success");
    setTimeout(() => setGeminiConnected(true), 1200);
  }, []);

  // The extension content script sets this at document-idle, which may land
  // after React mounts — re-check shortly after load.
  useEffect(() => {
    const check = () => setExtInstalled(document.documentElement.dataset.luminaExt === "1");
    check();
    const id = setTimeout(check, 800);
    return () => clearTimeout(id);
  }, []);

  // 1. Tell the parent we're ready to receive the token, and report which bridge
  // holds this user's cookies so the host can target its logout DELETE correctly.
  useEffect(() => {
    window.parent?.postMessage({ type: "ready" }, "*");
    window.parent?.postMessage({ type: "lumina-bridge", bridge: API_BASE }, "*");
  }, []);

  // 2. Receive the auth token from embed.js (or the login popup)
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.data?.type === "lumina-auth" && typeof e.data.token === "string") {
        setToken(e.data.token);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // 3. Once we have a token, bootstrap the widget + check Gemini status
  useEffect(() => {
    if (!token || !embedKey) return;
    setPhase("loading");
    getEmbedBootstrap(token, embedKey)
      .then((data) => {
        setAppearance(data.config ?? {});
        setSuggestions(data.suggestions ?? []);
        setPhase("ready");
      })
      .catch(async (err) => {
        let msg = "This widget could not be loaded.";
        if (err instanceof Response) {
          try {
            const body = (await err.json()) as { detail?: string };
            msg = body.detail ?? msg;
          } catch { /* ignore */ }
        }
        setErrorMsg(msg);
        setPhase("error");
      });
    getCookiesStatus(token)
      .then((s) => {
        setGeminiConnected(s.connected);
        setCookieChecked(true);
      })
      .catch(() => setGeminiConnected(false));
  }, [token, embedKey]);

  // 3b. Resolve the user's identity so history is scoped per user.
  useEffect(() => {
    if (!token) return;
    getMe(token)
      .then((u) => setUserKey(u.email || "anon"))
      .catch(() => setUserKey("anon"));
  }, [token]);

  // 3b2. Load the agents assigned to this user (server-scoped by the token).
  useEffect(() => {
    if (!token) return;
    listMyAgents(token)
      .then((r) => setMyAgents(r.agents ?? []))
      .catch(() => setMyAgents([]))
      .finally(() => setAgentsLoaded(true));
  }, [token]);

  // 3c. Once agents + identity are known, pick the default agent (last-used if
  // still assigned, else the first). Runs once — subsequent agent switches go
  // through "New chat" (a fresh thread).
  useEffect(() => {
    if (!agentsLoaded || !userKey || defaultSelectedRef.current) return;
    if (myAgents.length === 0) return;
    defaultSelectedRef.current = true;

    let pick = myAgents[0].id;
    try {
      const last = localStorage.getItem(lastAgentKey(userKey));
      if (last && myAgents.some((a) => a.id === last)) pick = last;
    } catch { /* ignore */ }

    setSelectedAgentId(pick);
  }, [agentsLoaded, userKey, myAgents, lastAgentKey]);

  // 3c2. Restore the picked agent's saved thread — but only once Gemini is
  // confirmed connected. A logout drops the user's cookies on the bridge, so a
  // returning session that hasn't reconnected yet must NOT resume an old thread.
  useEffect(() => {
    if (!userKey || !selectedAgentId || !cookieChecked || !geminiConnected) return;
    if (historyRestoredRef.current) return;
    historyRestoredRef.current = true;
    try {
      const raw = localStorage.getItem(chatKey(userKey, selectedAgentId));
      if (raw) {
        const saved = JSON.parse(raw) as WidgetMessage[];
        if (Array.isArray(saved) && saved.length) {
          setMessages((cur) => (cur.length ? cur : cleanHistory(saved)));
        }
      }
    } catch { /* ignore corrupt/unavailable storage */ }
  }, [userKey, selectedAgentId, cookieChecked, geminiConnected, chatKey]);

  // 3c3. A confirmed disconnected state (fresh login after a prior logout, or
  // never connected) means the bridge holds no session — treat it as a clean
  // slate: drop this user's saved threads so a later reconnect starts fresh.
  useEffect(() => {
    if (!userKey || !cookieChecked || geminiConnected) return;
    if (purgedRef.current) return;
    purgedRef.current = true;
    try {
      const prefix = `lumina_chat:${embedKey}:${userKey}:`;
      const toRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) toRemove.push(k);
      }
      toRemove.forEach((k) => localStorage.removeItem(k));
    } catch { /* ignore */ }
    setMessages([]);
  }, [userKey, cookieChecked, geminiConnected, embedKey]);

  // 3c2. Load the selected agent's suggestion cards.
  useEffect(() => {
    if (!token || !selectedAgentId) return;
    getMyAgentSuggestions(token, selectedAgentId)
      .then((r) => setSuggestions(r.suggestions ?? []))
      .catch(() => setSuggestions([]));
  }, [token, selectedAgentId]);

  // 3d. Persist the current thread (last 50, placeholder stripped) per agent.
  useEffect(() => {
    if (!userKey || !selectedAgentId) return;
    try {
      const clean = cleanHistory(messages).slice(-50);
      if (clean.length) {
        localStorage.setItem(chatKey(userKey, selectedAgentId), JSON.stringify(clean));
      }
    } catch {
      /* ignore */
    }
  }, [messages, userKey, selectedAgentId, chatKey]);

  // Start a fresh chat with the chosen agent (from the header "New chat" menu).
  const handleNewChat = useCallback(
    (agentId: string) => {
      setSelectedAgentId(agentId);
      setMessages([]);
      if (userKey) {
        try { localStorage.setItem(lastAgentKey(userKey), agentId); } catch { /* ignore */ }
      }
    },
    [userKey, lastAgentKey],
  );

  // 4. Listen for Gemini connect progress from the extension
  useEffect(() => {
    function onStatus(e: Event) {
      const detail = (e as CustomEvent).detail as { phase?: string; error?: string };
      if (detail?.phase === "done") {
        markConnected();
      } else if (detail?.phase === "error") {
        setConnectPhase("error");
        setConnectError(detail.error ?? "Could not connect Gemini.");
      } else if (detail?.phase) {
        setConnectPhase("connecting");
      }
    }
    window.addEventListener("lumina:gemini-status", onStatus);
    return () => window.removeEventListener("lumina:gemini-status", onStatus);
  }, [markConnected]);

  // 5. While waiting to connect, poll status so the widget auto-advances to
  // chat once the user completes "Connect Gemini Automatically" in the extension.
  useEffect(() => {
    if (phase !== "ready" || geminiConnected || !token) return;
    const id = setInterval(() => {
      getCookiesStatus(token)
        .then((s) => {
          if (s.connected) {
            clearInterval(id);
            markConnected();
          }
        })
        .catch(() => {});
    }, 2000);
    return () => clearInterval(id);
  }, [phase, geminiConnected, token, markConnected]);

  function connectGemini() {
    if (!token || !extInstalled) return;
    setConnectError("");
    setConnectPhase("connecting");
    // Pass the backend URL so the extension posts the Gemini cookies to the same
    // bridge this widget uses (local or production).
    window.dispatchEvent(
      new CustomEvent("lumina:connect-gemini", {
        detail: { token, backendUrl: API_BASE },
      }),
    );
  }

  function openLogin() {
    window.open(`${AUTH_BASE_FOR_LOGIN}/login?embed=1`, "lumina-login", "width=460,height=640");
  }

  const handleSend = useCallback(
    async (text: string) => {
      if (!token || !selectedAgentId) return;
      const agentModel = myAgents.find((a) => a.id === selectedAgentId)?.model ?? "gemini-3-flash";
      const userMsg: WidgetMessage = { id: `u-${Date.now()}`, role: "user", content: text };
      const replyId = `a-${Date.now()}`;
      setMessages((m) => [...m, userMsg, { id: replyId, role: "assistant", content: "" }]);
      setBusy(true);

      let full = "";
      try {
        const res = await chatStream(token, text, agentModel, selectedAgentId);
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
                error?: string;
              };
              if (json.error) throw new Error(json.error);
              chunk = json.choices?.[0]?.delta?.content ?? json.content ?? "";
            } catch (e) {
              if (e instanceof Error && e.message) {
                full = full || `Error: ${e.message}`;
              } else {
                chunk = data;
              }
            }
            if (chunk) {
              full += chunk;
              setMessages((m) => m.map((x) => (x.id === replyId ? { ...x, content: full } : x)));
            }
          }
        }
        if (!full) full = "Sorry, no response.";
        setMessages((m) => m.map((x) => (x.id === replyId ? { ...x, content: full } : x)));
      } catch (err) {
        let msg = "Something went wrong. Please try again.";
        if (err instanceof Response) {
          try {
            const body = (await err.json()) as { detail?: string };
            msg = body.detail ?? msg;
          } catch { /* ignore */ }
        }
        setMessages((m) => m.map((x) => (x.id === replyId ? { ...x, content: msg } : x)));
      } finally {
        setBusy(false);
      }
    },
    [token, selectedAgentId, myAgents],
  );

  const accent = appearance.accentColor ?? "#f97316";
  const theme = getThemeParam() ?? appearance.theme ?? "dark";

  if (!embedKey) {
    return <CenterCard theme={theme}>Missing embed key.</CenterCard>;
  }

  if (phase === "waiting-token") {
    return (
      <CenterCard theme={theme}>
        <p className="mb-3 text-sm">Please sign in to start chatting.</p>
        <button
          type="button"
          onClick={openLogin}
          className="rounded-xl px-4 py-2 text-sm font-medium text-white"
          style={{ background: accent }}
        >
          Sign in
        </button>
      </CenterCard>
    );
  }

  if (phase === "loading") {
    return (
      <CenterCard theme={theme}>
        <div className="size-6 animate-spin rounded-full border-2 border-zinc-600 border-t-orange-500" />
      </CenterCard>
    );
  }

  if (phase === "error") {
    return <CenterCard theme={theme}>{errorMsg}</CenterCard>;
  }

  // ready — but Gemini not connected yet: show the setup guide in the panel
  if (!geminiConnected) {
    const guideState: GeminiGuideState =
      connectPhase === "success"
        ? "success"
        : connectPhase === "error"
          ? "error"
          : connectPhase === "connecting"
            ? "connecting"
            : extInstalled
              ? "waiting"
              : "need-extension";
    return (
      <div className="h-screen">
        <GeminiSetupGuide
          state={guideState}
          errorMsg={connectError}
          theme={theme}
          onConnect={extInstalled ? connectGemini : undefined}
          onRetry={() => {
            setConnectPhase("idle");
            setConnectError("");
          }}
        />
      </div>
    );
  }

  // ready + connected but the user has no assigned agents: nothing to chat with.
  if (agentsLoaded && myAgents.length === 0) {
    return (
      <CenterCard theme={theme}>
        <p className="text-sm font-medium">No agents are assigned to you yet.</p>
        <p className="mt-1 text-xs opacity-70">
          Contact your administrator to get access to an assistant.
        </p>
      </CenterCard>
    );
  }

  // ready + connected: the chat
  return (
    <div className="flex h-screen flex-col">
      <div className="min-h-0 flex-1">
        <WidgetChat
          title={appearance.title ?? "PNE LC AI Assistant"}
          greeting={appearance.greeting ?? "Hi! How can I help you today?"}
          accentColor={accent}
          theme={theme}
          messages={messages}
          busy={busy}
          suggestions={suggestions}
          onSend={handleSend}
          agents={myAgents}
          selectedAgentId={selectedAgentId}
          onNewChat={handleNewChat}
        />
      </div>
    </div>
  );
}

function CenterCard({ theme, children }: { theme: "dark" | "light"; children: React.ReactNode }) {
  return (
    <div
      className={
        theme === "light"
          ? "flex h-screen flex-col items-center justify-center bg-white p-6 text-center text-zinc-700"
          : "flex h-screen flex-col items-center justify-center bg-zinc-950 p-6 text-center text-zinc-300"
      }
    >
      {children}
    </div>
  );
}
