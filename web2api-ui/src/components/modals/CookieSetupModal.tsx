import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  Check,
  Command,
  Copy,
  Download,
  Loader2,
  Monitor,
  Puzzle,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { getCookiesStatus, saveCookies } from '@/services/api'
import { useExtensionCookies } from '@/hooks/useExtensionCookies'

interface CookieSetupModalProps {
  onSuccess: () => void
}

// Where the extension installer is hosted.
const EXT_BASE = 'https://ai.lcportal.cloud/ext'
const WINDOWS_INSTALLER = `${EXT_BASE}/PNE-LC-AI-Setup.exe`
const MAC_INSTALLER = `${EXT_BASE}/PNE-LC-AI-Setup.pkg`

type OS = 'windows' | 'mac'

function detectOS(): OS {
  const ua =
    (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData
      ?.platform || navigator.userAgent
  return /mac/i.test(ua) ? 'mac' : 'windows'
}

/** Inline copy-to-clipboard chip for short snippets like chrome://extensions. */
function CopyChip({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked — user can select manually */
    }
  }
  return (
    <button
      onClick={copy}
      className="group inline-flex items-center gap-2 rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 font-mono text-xs text-zinc-300 transition-colors hover:border-white/20 hover:bg-black/60"
    >
      {text}
      {copied ? (
        <Check className="size-3.5 text-emerald-400" />
      ) : (
        <Copy className="size-3.5 text-zinc-500 transition-colors group-hover:text-zinc-300" />
      )}
    </button>
  )
}

interface StepDef {
  title: string
  body: ReactNode
}

const WINDOWS_STEPS: StepDef[] = [
  {
    title: 'Download & run the installer',
    body: (
      <>
        <a
          href={WINDOWS_INSTALLER}
          download
          className="mt-1 inline-flex items-center gap-2 rounded-xl bg-gradient-to-b from-orange-500 to-orange-600 px-3.5 py-2 text-xs font-semibold text-white shadow-lg shadow-orange-900/30 transition-all hover:from-orange-400 hover:to-orange-500 active:scale-[0.98]"
        >
          <Download className="size-3.5" /> PNE-LC-AI-Setup.exe
        </a>
        <p className="mt-2 text-xs leading-relaxed text-zinc-500">
          No admin rights needed. If you see “Windows protected your PC”, click{' '}
          <span className="text-zinc-300">More info → Run anyway</span>.
        </p>
      </>
    ),
  },
  {
    title: 'Enable Developer mode in Chrome',
    body: (
      <p className="text-xs leading-relaxed text-zinc-400">
        The installer opens Chrome’s extensions page. Toggle{' '}
        <span className="font-medium text-zinc-200">Developer mode</span> on (top-right).
        If it didn’t open, go to <CopyChip text="chrome://extensions" />
      </p>
    ),
  },
  {
    title: 'Load the extension folder',
    body: (
      <p className="text-xs leading-relaxed text-zinc-400">
        Click <span className="font-medium text-zinc-200">Load unpacked</span> and pick{' '}
        <span className="font-mono text-zinc-300">%LOCALAPPDATA%\PNE LC AI\extension</span>.
      </p>
    ),
  },
  {
    title: 'Connect Gemini',
    body: (
      <p className="text-xs leading-relaxed text-zinc-400">
        Click the <span className="font-medium text-zinc-200">PNE LC AI</span> icon in your
        toolbar, then <span className="font-medium text-zinc-200">Connect Gemini</span>. This
        panel closes on its own once you’re connected.
      </p>
    ),
  },
]

const MAC_STEPS: StepDef[] = [
  {
    title: 'Download & open the installer',
    body: (
      <>
        <a
          href={MAC_INSTALLER}
          download
          className="mt-1 inline-flex items-center gap-2 rounded-xl bg-gradient-to-b from-orange-500 to-orange-600 px-3.5 py-2 text-xs font-semibold text-white shadow-lg shadow-orange-900/30 transition-all hover:from-orange-400 hover:to-orange-500 active:scale-[0.98]"
        >
          <Download className="size-3.5" /> PNE-LC-AI-Setup.pkg
        </a>
        <p className="mt-2 text-xs leading-relaxed text-zinc-500">
          No admin rights needed. If macOS says “unidentified developer”, right-click the
          file → <span className="text-zinc-300">Open</span>.
        </p>
      </>
    ),
  },
  {
    title: 'Enable Developer mode in Chrome',
    body: (
      <p className="text-xs leading-relaxed text-zinc-400">
        The installer opens the extension folder. In Chrome, toggle{' '}
        <span className="font-medium text-zinc-200">Developer mode</span> on (top-right). Go
        to <CopyChip text="chrome://extensions" />
      </p>
    ),
  },
  {
    title: 'Load the extension folder',
    body: (
      <p className="text-xs leading-relaxed text-zinc-400">
        Click <span className="font-medium text-zinc-200">Load unpacked</span> and pick{' '}
        <span className="font-mono text-zinc-300">
          ~/Library/Application Support/PNE LC AI/extension
        </span>
        .
      </p>
    ),
  },
  {
    title: 'Connect Gemini',
    body: (
      <p className="text-xs leading-relaxed text-zinc-400">
        Click the <span className="font-medium text-zinc-200">PNE LC AI</span> icon in your
        toolbar, then <span className="font-medium text-zinc-200">Connect Gemini</span>. This
        panel closes on its own once you’re connected.
      </p>
    ),
  },
]

export function CookieSetupModal({ onSuccess }: CookieSetupModalProps) {
  const { token } = useAuth()
  const [status, setStatus] = useState<'waiting' | 'saving' | 'success' | 'error'>('waiting')
  const [errorMsg, setErrorMsg] = useState('')
  const [os, setOs] = useState<OS>('windows')

  useEffect(() => {
    setOs(detectOS())
  }, [])

  // Poll the backend every 2s while waiting — auto-closes when the extension sends cookies
  useEffect(() => {
    if (!token || status !== 'waiting') return
    const id = setInterval(async () => {
      try {
        const { connected } = await getCookiesStatus(token)
        if (connected) {
          clearInterval(id)
          setStatus('success')
          setTimeout(onSuccess, 1200)
        }
      } catch {
        // ignore transient poll errors
      }
    }, 2000)
    return () => clearInterval(id)
  }, [token, status, onSuccess])

  // Also handle the CustomEvent path (content script dispatch fallback)
  const handleCookies = useCallback(
    async (psid: string, psidts: string) => {
      if (!token || status !== 'waiting') return
      setStatus('saving')
      try {
        await saveCookies(token, psid, psidts)
        setStatus('success')
        setTimeout(onSuccess, 1200)
      } catch {
        setStatus('error')
        setErrorMsg('Failed to save cookies. Please try again.')
      }
    },
    [token, status, onSuccess],
  )
  useExtensionCookies(handleCookies)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
      <div className="relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] border border-white/10 bg-zinc-950 shadow-2xl shadow-black/60">
        {/* Ambient top glow */}
        <div className="pointer-events-none absolute inset-x-0 -top-24 h-48 bg-gradient-to-b from-orange-500/20 via-orange-500/[0.06] to-transparent blur-2xl" />
        {/* Gradient hairline */}
        <div className="h-px w-full bg-gradient-to-r from-transparent via-orange-500/60 to-transparent" />

        <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
          {/* Header */}
          <div className="flex items-start justify-between gap-6 px-8 pt-8">
            <div className="flex items-center gap-3.5">
              <span className="relative flex size-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-amber-600 shadow-lg shadow-orange-900/40">
                <Puzzle className="size-5 text-white" />
                <Sparkles className="absolute -right-1 -top-1 size-4 text-amber-300" />
              </span>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold tracking-tight text-zinc-50">
                  Connect Gemini
                </h2>
                <p className="text-xs text-zinc-500">One-time setup · takes ~1 minute</p>
              </div>
            </div>

            {/* OS segmented control */}
            <div className="flex shrink-0 gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
              {(['windows', 'mac'] as const).map((o) => (
                <button
                  key={o}
                  onClick={() => setOs(o)}
                  className={`flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium transition-all ${
                    os === o
                      ? 'bg-white/10 text-zinc-50 shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {o === 'windows' ? (
                    <Monitor className="size-3.5" />
                  ) : (
                    <Command className="size-3.5" />
                  )}
                  {o === 'windows' ? 'Windows' : 'macOS'}
                </button>
              ))}
            </div>
          </div>

          {/* Body */}
          <div className="px-8 pb-2 pt-6">
            <ol className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              {(os === 'windows' ? WINDOWS_STEPS : MAC_STEPS).map((step, i) => (
                <li
                  key={i}
                  className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-amber-600 text-xs font-bold text-white">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-zinc-100">{step.title}</p>
                    <div className="mt-1.5">{step.body}</div>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* Reassurance */}
          <div className="mx-8 mb-2 flex items-start gap-2 rounded-xl border border-emerald-400/15 bg-emerald-500/[0.05] px-3.5 py-2.5">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
            <p className="text-[11px] leading-relaxed text-emerald-200/70">
              Cookies go only to your PNE LC AI instance and stay on your machine. The
              extension keeps itself updated automatically.
            </p>
          </div>
        </div>

        {/* Sticky live status footer */}
        <div className="border-t border-white/10 bg-white/[0.02] px-8 py-4">
          {status === 'waiting' && (
            <div className="flex items-center gap-3">
              <span className="relative flex size-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
                <span className="relative inline-flex size-2.5 rounded-full bg-orange-500" />
              </span>
              <p className="text-sm text-zinc-400">Waiting for the extension to connect…</p>
            </div>
          )}

          {status === 'saving' && (
            <div className="flex items-center gap-3">
              <Loader2 className="size-4 animate-spin text-orange-400" />
              <p className="text-sm text-zinc-400">Saving your session…</p>
            </div>
          )}

          {status === 'success' && (
            <div className="flex items-center gap-3">
              <span className="flex size-5 items-center justify-center rounded-full bg-emerald-500/20">
                <Check className="size-3.5 text-emerald-400" />
              </span>
              <p className="text-sm font-medium text-emerald-300">
                Gemini connected! Opening chat…
              </p>
            </div>
          )}

          {status === 'error' && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-red-300">{errorMsg}</p>
              <button
                onClick={() => setStatus('waiting')}
                className="shrink-0 rounded-lg border border-red-400/30 px-2.5 py-1 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/10"
              >
                Try again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
