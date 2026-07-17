import { useEffect, useState, type ReactNode } from "react";
import {
  Check,
  Command,
  Copy,
  Download,
  Monitor,
  Puzzle,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";

export type GeminiGuideState =
  | "need-extension"
  | "waiting"
  | "connecting"
  | "success"
  | "error";

interface GeminiSetupGuideProps {
  state: GeminiGuideState;
  /** Shown in the "error" state. */
  errorMsg?: string;
  /** Called when the user clicks "Connect Gemini Automatically" (extension installed). */
  onConnect?: () => void;
  /** Called from the "error" state's retry button. */
  onRetry?: () => void;
  theme?: "dark" | "light";
}

// Where the extension installer is hosted.
const EXT_BASE = "https://ai.lcportal.cloud/ext";
const WINDOWS_INSTALLER = `${EXT_BASE}/PNE-LC-AI-Setup.exe`;
const MAC_INSTALLER = `${EXT_BASE}/PNE-LC-AI-Setup.pkg`;

type OS = "windows" | "mac";

function detectOS(): OS {
  const ua =
    (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData
      ?.platform || navigator.userAgent;
  return /mac/i.test(ua) ? "mac" : "windows";
}

/** Inline copy-to-clipboard chip for short snippets like chrome://extensions. */
function CopyChip({ text, light }: { text: string; light: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — user can select manually */
    }
  }
  return (
    <button
      onClick={copy}
      className={
        "group inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 font-mono text-xs transition-colors " +
        (light
          ? "border-zinc-200 bg-zinc-100 text-zinc-700 hover:border-zinc-300 hover:bg-zinc-200"
          : "border-white/10 bg-black/40 text-zinc-300 hover:border-white/20 hover:bg-black/60")
      }
    >
      {text}
      {copied ? (
        <Check className="size-3.5 text-emerald-400" />
      ) : (
        <Copy className={"size-3.5 " + (light ? "text-zinc-400" : "text-zinc-500")} />
      )}
    </button>
  );
}

/**
 * The "Connect your Gemini account" setup guide, rendered inside the embed
 * widget panel. Presentational only — the parent (WidgetPage) owns the token,
 * extension detection, connect action and polling. Styling mirrors the
 * main-app CookieSetupModal so both surfaces look identical.
 */
export function GeminiSetupGuide({
  state,
  errorMsg,
  onConnect,
  onRetry,
  theme = "dark",
}: GeminiSetupGuideProps) {
  const light = theme === "light";
  const [os, setOs] = useState<OS>("windows");

  useEffect(() => {
    setOs(detectOS());
  }, []);

  const connectStep = {
    title: "Connect Gemini",
    body: (
      <p className={"text-xs leading-relaxed " + (light ? "text-zinc-600" : "text-zinc-400")}>
        Click{" "}
        <span className={light ? "font-medium text-zinc-800" : "font-medium text-zinc-200"}>
          Connect Gemini
        </span>{" "}
        below (or the extension icon in your toolbar). This panel closes on its own once
        you’re connected.
      </p>
    ),
  };

  const windowsSteps: { title: string; body: ReactNode }[] = [
    {
      title: "Download & run the installer",
      body: (
        <>
          <a
            href={WINDOWS_INSTALLER}
            download
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-2 rounded-xl bg-gradient-to-b from-orange-500 to-orange-600 px-3.5 py-2 text-xs font-semibold text-white shadow-lg shadow-orange-900/30 transition-all hover:from-orange-400 hover:to-orange-500 active:scale-[0.98]"
          >
            <Download className="size-3.5" /> PNE-LC-AI-Setup.exe
          </a>
          <p className={"mt-2 text-xs leading-relaxed " + (light ? "text-zinc-500" : "text-zinc-500")}>
            No admin rights needed. If you see “Windows protected your PC”, click{" "}
            <span className={light ? "text-zinc-700" : "text-zinc-300"}>More info → Run anyway</span>.
          </p>
        </>
      ),
    },
    {
      title: "Enable Developer mode in Chrome",
      body: (
        <p className={"text-xs leading-relaxed " + (light ? "text-zinc-600" : "text-zinc-400")}>
          The installer opens Chrome’s extensions page. Toggle{" "}
          <span className={light ? "font-medium text-zinc-800" : "font-medium text-zinc-200"}>
            Developer mode
          </span>{" "}
          on (top-right). If it didn’t open, go to <CopyChip text="chrome://extensions" light={light} />
        </p>
      ),
    },
    {
      title: "Load the extension folder",
      body: (
        <p className={"text-xs leading-relaxed " + (light ? "text-zinc-600" : "text-zinc-400")}>
          Click{" "}
          <span className={light ? "font-medium text-zinc-800" : "font-medium text-zinc-200"}>
            Load unpacked
          </span>{" "}
          and pick{" "}
          <span className={light ? "font-mono text-zinc-700" : "font-mono text-zinc-300"}>
            %LOCALAPPDATA%\PNE LC AI\extension
          </span>
          .
        </p>
      ),
    },
    connectStep,
  ];

  const macSteps: { title: string; body: ReactNode }[] = [
    {
      title: "Download & open the installer",
      body: (
        <>
          <a
            href={MAC_INSTALLER}
            download
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-2 rounded-xl bg-gradient-to-b from-orange-500 to-orange-600 px-3.5 py-2 text-xs font-semibold text-white shadow-lg shadow-orange-900/30 transition-all hover:from-orange-400 hover:to-orange-500 active:scale-[0.98]"
          >
            <Download className="size-3.5" /> PNE-LC-AI-Setup.pkg
          </a>
          <p className={"mt-2 text-xs leading-relaxed " + (light ? "text-zinc-500" : "text-zinc-500")}>
            No admin rights needed. If macOS says “unidentified developer”, right-click the
            file → <span className={light ? "text-zinc-700" : "text-zinc-300"}>Open</span>.
          </p>
        </>
      ),
    },
    {
      title: "Enable Developer mode in Chrome",
      body: (
        <p className={"text-xs leading-relaxed " + (light ? "text-zinc-600" : "text-zinc-400")}>
          The installer opens the extension folder. In Chrome, toggle{" "}
          <span className={light ? "font-medium text-zinc-800" : "font-medium text-zinc-200"}>
            Developer mode
          </span>{" "}
          on (top-right). Go to <CopyChip text="chrome://extensions" light={light} />
        </p>
      ),
    },
    {
      title: "Load the extension folder",
      body: (
        <p className={"text-xs leading-relaxed " + (light ? "text-zinc-600" : "text-zinc-400")}>
          Click{" "}
          <span className={light ? "font-medium text-zinc-800" : "font-medium text-zinc-200"}>
            Load unpacked
          </span>{" "}
          and pick{" "}
          <span className={light ? "font-mono text-zinc-700" : "font-mono text-zinc-300"}>
            ~/Library/Application Support/PNE LC AI/extension
          </span>
          .
        </p>
      ),
    },
    connectStep,
  ];

  const steps = os === "windows" ? windowsSteps : macSteps;

  return (
    <div
      className={
        "relative flex h-full flex-col overflow-hidden " +
        (light ? "bg-white text-zinc-700" : "bg-zinc-950 text-zinc-300")
      }
    >
      {/* Ambient top glow */}
      <div className="pointer-events-none absolute inset-x-0 -top-24 h-48 bg-gradient-to-b from-orange-500/20 via-orange-500/[0.06] to-transparent blur-2xl" />

      <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4 px-6 pt-6">
          <div className="flex items-center gap-3.5">
            <span className="relative flex size-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-amber-600 shadow-lg shadow-orange-900/40">
              <Puzzle className="size-5 text-white" />
              <Sparkles className="absolute -right-1 -top-1 size-4 text-amber-300" />
            </span>
            <div className="min-w-0">
              <h2 className={"text-lg font-semibold tracking-tight " + (light ? "text-zinc-900" : "text-zinc-50")}>
                Connect Gemini
              </h2>
              <p className={"text-xs " + (light ? "text-zinc-500" : "text-zinc-500")}>
                One-time setup · takes ~1 minute
              </p>
            </div>
          </div>

          {/* OS segmented control */}
          <div
            className={
              "flex shrink-0 gap-1 rounded-xl border p-1 " +
              (light ? "border-zinc-200 bg-zinc-50" : "border-white/10 bg-white/[0.03]")
            }
          >
            {(["windows", "mac"] as const).map((o) => (
              <button
                key={o}
                onClick={() => setOs(o)}
                className={
                  "flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium transition-all " +
                  (os === o
                    ? light
                      ? "bg-white text-zinc-900 shadow-sm"
                      : "bg-white/10 text-zinc-50 shadow-sm"
                    : light
                      ? "text-zinc-500 hover:text-zinc-800"
                      : "text-zinc-500 hover:text-zinc-300")
                }
              >
                {o === "windows" ? <Monitor className="size-3.5" /> : <Command className="size-3.5" />}
                {o === "windows" ? "Windows" : "macOS"}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="px-6 pb-2 pt-6">
          <ol className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            {steps.map((step, i) => (
              <li
                key={i}
                className={
                  "flex gap-3 rounded-2xl border p-4 " +
                  (light ? "border-zinc-200 bg-zinc-50" : "border-white/10 bg-white/[0.03]")
                }
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-amber-600 text-xs font-bold text-white">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={"text-sm font-semibold " + (light ? "text-zinc-900" : "text-zinc-100")}>
                    {step.title}
                  </p>
                  <div className="mt-1.5">{step.body}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* Reassurance */}
        <div className="mx-6 mb-2 flex items-start gap-2 rounded-xl border border-emerald-400/15 bg-emerald-500/[0.05] px-3.5 py-2.5">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
          <p className={"text-[11px] leading-relaxed " + (light ? "text-emerald-700/80" : "text-emerald-200/70")}>
            Cookies go only to your PNE LC AI instance and stay on your machine. The
            extension keeps itself updated automatically.
          </p>
        </div>
      </div>

      {/* Sticky live status / action footer */}
      <div
        className={
          "border-t px-6 py-4 " +
          (light ? "border-zinc-200 bg-zinc-50/60" : "border-white/10 bg-white/[0.02]")
        }
      >
        {state === "need-extension" && (
          <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-center">
            <p className="text-sm text-amber-500">
              Install the PNE LC extension using the steps above, then reopen this chat.
            </p>
          </div>
        )}

        {(state === "waiting" || state === "connecting") && (
          <div className="flex flex-col gap-3">
            {onConnect && (
              <button
                type="button"
                onClick={onConnect}
                disabled={state === "connecting"}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-orange-500 to-orange-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-orange-900/30 transition-all hover:from-orange-400 hover:to-orange-500 active:scale-[0.99] disabled:opacity-60"
              >
                {state === "connecting" ? (
                  <>
                    <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    Connecting…
                  </>
                ) : (
                  <>
                    <Zap className="size-4" /> Connect Gemini Automatically
                  </>
                )}
              </button>
            )}
            <div className="flex items-center justify-center gap-2.5">
              <span className="relative flex size-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
                <span className="relative inline-flex size-2.5 rounded-full bg-orange-500" />
              </span>
              <p className={"text-sm " + (light ? "text-zinc-500" : "text-zinc-400")}>
                Waiting for the extension to connect…
              </p>
            </div>
          </div>
        )}

        {state === "success" && (
          <div className="flex items-center justify-center gap-3">
            <span className="flex size-5 items-center justify-center rounded-full bg-emerald-500/20">
              <Check className="size-3.5 text-emerald-400" />
            </span>
            <p className="text-sm font-medium text-emerald-500">Gemini connected! Opening chat…</p>
          </div>
        )}

        {state === "error" && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-red-400">{errorMsg || "Could not connect Gemini."}</p>
            {onRetry && (
              <button
                onClick={onRetry}
                className="shrink-0 rounded-lg border border-red-400/30 px-2.5 py-1 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10"
              >
                Try again
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
