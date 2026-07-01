import { useCallback, useEffect, useState } from "react";
import { getEmbedBootstrap, embedChatStream, getCookiesStatus } from "@/services/api";
import { WidgetChat, type WidgetMessage } from "@/components/widget/WidgetChat";
import type { EmbedConfigAppearance } from "@/types/chat";

const AUTH_BASE_FOR_LOGIN =
  (import.meta.env.VITE_WIDGET_URL as string | undefined)?.replace(/\/$/, "") ??
  window.location.origin;

function getEmbedKey(): string {
  return new URLSearchParams(window.location.search).get("embed") ?? "";
}

type Phase = "waiting-token" | "loading" | "ready" | "error";

export default function WidgetPage() {
  const embedKey = getEmbedKey();
  const [token, setToken] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("waiting-token");
  const [errorMsg, setErrorMsg] = useState("");

  const [appearance, setAppearance] = useState<EmbedConfigAppearance>({});
  const [geminiConnected, setGeminiConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectMsg, setConnectMsg] = useState("");
  const extInstalled =
    typeof document !== "undefined" && document.documentElement.dataset.luminaExt === "1";

  const [messages, setMessages] = useState<WidgetMessage[]>([]);
  const [busy, setBusy] = useState(false);

  // 1. Tell the parent we're ready to receive the token
  useEffect(() => {
    window.parent?.postMessage({ type: "ready" }, "*");
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
      .then((s) => setGeminiConnected(s.connected))
      .catch(() => setGeminiConnected(false));
  }, [token, embedKey]);

  // 4. Listen for Gemini connect progress from the extension
  useEffect(() => {
    function onStatus(e: Event) {
      const detail = (e as CustomEvent).detail as { phase?: string; error?: string; message?: string };
      if (detail?.phase === "done") {
        setConnecting(false);
        setConnectMsg("Gemini connected.");
        if (token) getCookiesStatus(token).then((s) => setGeminiConnected(s.connected)).catch(() => {});
      } else if (detail?.phase === "error") {
        setConnecting(false);
        setConnectMsg(detail.error ?? "Could not connect Gemini.");
      } else if (detail?.phase) {
        setConnectMsg("Connecting Gemini…");
      }
    }
    window.addEventListener("lumina:gemini-status", onStatus);
    return () => window.removeEventListener("lumina:gemini-status", onStatus);
  }, [token]);

  function connectGemini() {
    if (!token) return;
    if (!extInstalled) {
      setConnectMsg("Please install the Lumina extension to connect Gemini.");
      return;
    }
    setConnecting(true);
    setConnectMsg("Connecting Gemini…");
    window.dispatchEvent(new CustomEvent("lumina:connect-gemini", { detail: { token } }));
  }

  function openLogin() {
    window.open(`${AUTH_BASE_FOR_LOGIN}/login?embed=1`, "lumina-login", "width=460,height=640");
  }

  const handleSend = useCallback(
    async (text: string) => {
      if (!token) return;
      const userMsg: WidgetMessage = { id: `u-${Date.now()}`, role: "user", content: text };
      const replyId = `a-${Date.now()}`;
      setMessages((m) => [...m, userMsg, { id: replyId, role: "assistant", content: "" }]);
      setBusy(true);

      let full = "";
      try {
        const res = await embedChatStream(token, embedKey, text);
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
    [token, embedKey],
  );

  const accent = appearance.accentColor ?? "#7c3aed";
  const theme = appearance.theme ?? "dark";

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
        <div className="size-6 animate-spin rounded-full border-2 border-zinc-600 border-t-violet-500" />
      </CenterCard>
    );
  }

  if (phase === "error") {
    return <CenterCard theme={theme}>{errorMsg}</CenterCard>;
  }

  // ready
  return (
    <div className="flex h-screen flex-col">
      {!geminiConnected && (
        <div className="flex items-center justify-between gap-2 bg-amber-500/15 px-4 py-2 text-xs text-amber-200">
          <span>{connectMsg || "Connect Gemini to start chatting."}</span>
          {extInstalled ? (
            <button
              type="button"
              onClick={connectGemini}
              disabled={connecting}
              className="shrink-0 rounded-lg bg-amber-400/20 px-2.5 py-1 font-medium text-amber-100 disabled:opacity-50"
            >
              {connecting ? "Connecting…" : "Connect Gemini"}
            </button>
          ) : (
            <span className="shrink-0 text-amber-300">Install the extension</span>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1">
        <WidgetChat
          title={appearance.title ?? "Lumina Assistant"}
          greeting={appearance.greeting ?? "Hi! How can I help you today?"}
          accentColor={accent}
          theme={theme}
          messages={messages}
          busy={busy}
          onSend={handleSend}
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
