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

const STEPS = [
  { n: 1, text: "Install the", highlight: "PNE LC Extension", after: "in Chrome" },
  { n: 2, text: "Sign in to", highlight: "PNE LC AI", after: "on this page" },
  { n: 3, text: "Click the", highlight: "PNE LC icon", after: "in your Chrome toolbar" },
  { n: 4, text: "Click", highlight: '"Connect Gemini Automatically"', after: "— done!" },
];

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

  return (
    <div
      className={
        "flex h-full flex-col overflow-y-auto p-5 " +
        (light ? "bg-white text-zinc-700" : "bg-zinc-950 text-zinc-300")
      }
    >
      {/* Header */}
      <div className="mb-5 text-center">
        <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500/25 to-amber-500/25 ring-1 ring-inset ring-white/10">
          <svg viewBox="0 0 24 24" fill="none" className="size-6 text-orange-300" stroke="currentColor" strokeWidth="1.5">
            <path d="M13.5 10.5L21 3m0 0h-6m6 0v6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M10.5 13.5L3 21m0 0h6m-6 0v-6" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </div>
        <h2 className={"text-lg font-semibold tracking-tight " + (light ? "text-zinc-900" : "text-zinc-50")}>
          Connect your Gemini account
        </h2>
        <p className={"mt-1.5 text-sm " + (light ? "text-zinc-500" : "text-zinc-400")}>
          One click in the PNE LC extension connects your Gemini session automatically.
        </p>
      </div>

      {/* Steps */}
      <ol className="mb-5 flex flex-col gap-3">
        {STEPS.map((step) => (
          <li key={step.n} className="flex items-start gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-500/25 to-amber-500/25 text-xs font-bold text-orange-300 ring-1 ring-inset ring-white/10">
              {step.n}
            </span>
            <p className="text-sm">
              {step.text}{" "}
              <span className={"font-semibold " + (light ? "text-zinc-900" : "text-zinc-100")}>
                {step.highlight}
              </span>{" "}
              {step.after}
            </p>
          </li>
        ))}
      </ol>

      {/* Status / action */}
      <div className="mt-auto">
        {state === "need-extension" && (
          <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-center">
            <p className="text-sm text-amber-300">
              Install the PNE LC extension in Chrome, then reopen this chat to continue.
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
                className="w-full rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-orange-500 disabled:opacity-50"
              >
                {state === "connecting" ? "Connecting…" : "Connect Gemini Automatically"}
              </button>
            )}
            <div className="flex items-center justify-center gap-2.5 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
              <span className="relative flex size-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
                <span className="relative inline-flex size-2.5 rounded-full bg-orange-500" />
              </span>
              <p className="text-sm text-zinc-400">Waiting for extension to connect Gemini…</p>
            </div>
          </div>
        )}

        {state === "success" && (
          <div className="flex items-center justify-center gap-2.5 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3">
            <svg viewBox="0 0 24 24" fill="none" className="size-4 text-emerald-400" stroke="currentColor" strokeWidth="2">
              <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="text-sm text-emerald-300">Gemini connected! Opening chat…</p>
          </div>
        )}

        {state === "error" && (
          <div className="rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3">
            <p className="text-sm text-red-300">{errorMsg || "Could not connect Gemini."}</p>
            {onRetry && (
              <button
                onClick={onRetry}
                className="mt-2 text-xs text-red-300 underline hover:text-red-200"
              >
                Try again
              </button>
            )}
          </div>
        )}

        <p className={"mt-4 text-center text-xs " + (light ? "text-zinc-400" : "text-zinc-600")}>
          Your cookies are sent only to your local PNE LC AI instance and stored securely.
        </p>
      </div>
    </div>
  );
}
