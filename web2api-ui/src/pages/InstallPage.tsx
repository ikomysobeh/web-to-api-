import { useEffect, useState, type ReactNode } from 'react'
import {
  Check,
  ChevronDown,
  Command,
  Copy,
  Download,
  Loader2,
  Monitor,
  PuzzleIcon,
  RefreshCw,
  ShieldCheck,
  ToggleRight,
} from 'lucide-react'

// Where the extension files are hosted. The installer, the release zip and
// latest.json all live together in this folder (from web2api-ui/public/ext/).
const EXT_BASE = 'https://ai.lcportal.cloud/ext'
const WINDOWS_INSTALLER = `${EXT_BASE}/PNE-LC-AI-Setup.exe`
const MAC_INSTALLER = `${EXT_BASE}/PNE-LC-AI-Setup.pkg`

type OS = 'windows' | 'mac'

function detectOS(): OS {
  const ua =
    (navigator as unknown as { userAgentData?: { platform?: string } })
      .userAgentData?.platform || navigator.userAgent
  if (/mac/i.test(ua)) return 'mac'
  return 'windows'
}

/** A short piece of text (like a URL) with a copy-to-clipboard button. */
function CopyBox({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard blocked — user can still select the text manually */
    }
  }
  return (
    <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5">
      <code className="flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs text-zinc-200">
        {text}
      </code>
      <button
        onClick={copy}
        aria-label="Copy"
        className="flex size-7 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100"
      >
        {copied ? <Check className="size-4 text-emerald-400" /> : <Copy className="size-4" />}
      </button>
    </div>
  )
}

/** One numbered step. */
function Step({ n, title, children }: { n: number; title: string; children?: ReactNode }) {
  return (
    <li className="flex gap-3.5">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-600 to-amber-600 text-xs font-semibold text-white">
        {n}
      </span>
      <div className="flex-1 pt-0.5">
        <p className="text-sm font-medium text-zinc-200">{title}</p>
        {children && <div className="mt-2">{children}</div>}
      </div>
    </li>
  )
}

export default function InstallPage() {
  const [os, setOs] = useState<OS>('windows')
  const [ready, setReady] = useState(false)
  const [showTrouble, setShowTrouble] = useState(false)

  useEffect(() => {
    setOs(detectOS())
    setReady(true)
  }, [])

  if (!ready) {
    return (
      <div className="app-bg flex h-screen w-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-orange-500" />
      </div>
    )
  }

  return (
    <div className="app-bg relative min-h-screen w-full overflow-x-hidden">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute left-1/2 top-0 size-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-orange-600/20 to-amber-600/10 blur-3xl" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-xl flex-col items-center px-4 py-12">
        {/* Brand / header */}
        <img src="/favicon.svg" alt="PNE LC AI" className="mb-5 size-14" />
        <h1 className="text-center text-3xl font-semibold tracking-tight text-zinc-50">
          Install the PNE LC AI extension
        </h1>
        <p className="mt-2 max-w-md text-center text-sm text-zinc-400">
          Connects your Gemini account to PNE LC AI. A quick one-time setup — after that it
          keeps itself up to date automatically.
        </p>

        {/* OS switch */}
        <div className="mt-8 flex w-full max-w-xs rounded-2xl border border-white/10 bg-white/[0.03] p-1">
          <button
            onClick={() => setOs('windows')}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${
              os === 'windows'
                ? 'bg-gradient-to-br from-orange-600 to-amber-600 text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Monitor className="size-4" /> Windows
          </button>
          <button
            onClick={() => setOs('mac')}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${
              os === 'mac'
                ? 'bg-gradient-to-br from-orange-600 to-amber-600 text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Command className="size-4" /> macOS
          </button>
        </div>

        {/* Steps card */}
        <div className="mt-6 w-full rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-xl sm:p-8">
          {os === 'windows' ? (
            <ol className="flex flex-col gap-6">
              <Step n={1} title="Download and run the installer">
                <a
                  href={WINDOWS_INSTALLER}
                  download
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-orange-600 to-amber-600 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:from-orange-500 hover:to-amber-500 active:scale-[0.99]"
                >
                  <Download className="size-4" /> Download PNE-LC-AI-Setup.exe
                </a>
                <p className="mt-2 text-xs text-zinc-500">
                  No administrator rights needed. If Windows shows a “Windows protected your
                  PC” warning, click <span className="text-zinc-300">More info → Run anyway</span>{' '}
                  (it’s our own installer, just not yet code-signed).
                </p>
              </Step>

              <Step n={2} title="Turn on Developer mode in Chrome">
                <p className="text-sm text-zinc-400">
                  The installer opens Chrome’s extensions page for you. In the{' '}
                  <span className="font-medium text-zinc-200">top-right corner</span>, switch{' '}
                  <span className="font-medium text-zinc-200">Developer mode</span> ON and
                  leave it on.
                </p>
                <p className="mt-2 text-xs text-zinc-500">
                  If the page didn’t open, paste this into Chrome’s address bar:
                </p>
                <div className="mt-2">
                  <CopyBox text="chrome://extensions" />
                </div>
              </Step>

              <Step n={3} title="Click “Load unpacked” and pick the folder">
                <p className="text-sm text-zinc-400">
                  Click <span className="font-medium text-zinc-200">Load unpacked</span>{' '}
                  (top-left), then choose the{' '}
                  <span className="font-medium text-zinc-200">extension</span> folder that the
                  installer opened for you, and click{' '}
                  <span className="font-medium text-zinc-200">Select Folder</span>.
                </p>
                <p className="mt-2 text-xs text-zinc-500">
                  That folder is at{' '}
                  <span className="font-mono text-zinc-400">
                    %LOCALAPPDATA%\PNE LC AI\extension
                  </span>
                  .
                </p>
              </Step>

              <Step n={4} title="Done — you’re connected">
                <p className="text-sm text-zinc-400">
                  “PNE LC AI” now appears in your extensions. Open the app, sign in, and click
                  the extension to connect Gemini. Pin it to your toolbar if you like.
                </p>
              </Step>
            </ol>
          ) : (
            <ol className="flex flex-col gap-6">
              <Step n={1} title="Download and open the installer">
                <a
                  href={MAC_INSTALLER}
                  download
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-orange-600 to-amber-600 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:from-orange-500 hover:to-amber-500 active:scale-[0.99]"
                >
                  <Download className="size-4" /> Download PNE-LC-AI-Setup.pkg
                </a>
                <p className="mt-2 text-xs text-zinc-500">
                  No administrator rights needed. If macOS says it “cannot be opened because it
                  is from an unidentified developer,” <span className="text-zinc-300">right-click
                  the file → Open</span>, then confirm (it’s our own installer, just not yet
                  Apple-notarized).
                </p>
              </Step>

              <Step n={2} title="Turn on Developer mode in Chrome">
                <p className="text-sm text-zinc-400">
                  The installer opens the extension folder for you. In Chrome, open the
                  extensions page and switch{' '}
                  <span className="font-medium text-zinc-200">Developer mode</span> ON
                  (top-right) — leave it on.
                </p>
                <p className="mt-2 text-xs text-zinc-500">Paste into Chrome’s address bar:</p>
                <div className="mt-2">
                  <CopyBox text="chrome://extensions" />
                </div>
              </Step>

              <Step n={3} title="Click “Load unpacked” and pick the folder">
                <p className="text-sm text-zinc-400">
                  Click <span className="font-medium text-zinc-200">Load unpacked</span>{' '}
                  (top-left), then choose the{' '}
                  <span className="font-medium text-zinc-200">extension</span> folder that opened.
                </p>
                <p className="mt-2 text-xs text-zinc-500">
                  That folder is at{' '}
                  <span className="font-mono text-zinc-400">
                    ~/Library/Application Support/PNE LC AI/extension
                  </span>
                  .
                </p>
              </Step>

              <Step n={4} title="Done — you’re connected">
                <p className="text-sm text-zinc-400">
                  “PNE LC AI” now appears in your extensions. Open the app, sign in, and click
                  the extension to connect Gemini.
                </p>
              </Step>
            </ol>
          )}
        </div>

        {/* Reassurance line */}
        <div className="mt-5 flex items-start gap-2.5 rounded-2xl border border-emerald-400/15 bg-emerald-500/[0.06] px-4 py-3">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-400" />
          <p className="text-xs leading-relaxed text-emerald-200/80">
            After setup, the extension updates itself automatically in the background — you
            never need to reinstall or repeat these steps.
          </p>
        </div>

        {/* Troubleshooting (collapsible) */}
        {(
          <div className="mt-4 w-full">
            <button
              onClick={() => setShowTrouble((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
            >
              <ChevronDown
                className={`size-3.5 transition-transform ${showTrouble ? 'rotate-180' : ''}`}
              />
              The extension disappeared after a Chrome update?
            </button>
            {showTrouble && (
              <div className="mt-3 space-y-2 rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-xs text-zinc-400">
                <p className="flex items-start gap-2">
                  <PuzzleIcon className="mt-0.5 size-3.5 shrink-0 text-zinc-500" />
                  Occasionally, after a big Chrome update, Chrome turns off Developer-mode
                  extensions.
                </p>
                <p className="flex items-start gap-2">
                  <ToggleRight className="mt-0.5 size-3.5 shrink-0 text-zinc-500" />
                  Just open <span className="font-mono text-zinc-300">chrome://extensions</span>,
                  make sure <span className="text-zinc-300">Developer mode</span> is ON, and
                  toggle <span className="text-zinc-300">PNE LC AI</span> back on. No reinstall
                  needed.
                </p>
              </div>
            )}
          </div>
        )}

        <p className="mt-8 flex items-center gap-1.5 text-xs text-zinc-600">
          <RefreshCw className="size-3" /> Chrome only · auto-updating
        </p>
      </div>
    </div>
  )
}
