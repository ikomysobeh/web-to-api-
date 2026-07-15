import { useEffect, useState, type ReactNode } from 'react'
import {
  Check,
  ChevronDown,
  Command,
  Copy,
  Download,
  Loader2,
  Monitor,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'

// Where the extension files are hosted. The install scripts, the .crx and
// update.xml all live together in this folder (upload dist-package/* here).
const EXT_BASE = 'https://ai.lcportal.cloud/ext'

type OS = 'windows' | 'mac'

function detectOS(): OS {
  const ua =
    (navigator as unknown as { userAgentData?: { platform?: string } })
      .userAgentData?.platform || navigator.userAgent
  if (/mac/i.test(ua)) return 'mac'
  return 'windows'
}

/** A command line with a copy-to-clipboard button. */
function CommandBox({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard blocked — user can still select the text manually */
    }
  }
  return (
    <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5">
      <code className="flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs text-zinc-200">
        {command}
      </code>
      <button
        onClick={copy}
        aria-label="Copy command"
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
  const [showUninstall, setShowUninstall] = useState(false)

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

  const winInstall = `${EXT_BASE}/install-windows.ps1`
  const winUninstall = `${EXT_BASE}/uninstall-windows.ps1`
  const macInstall = `${EXT_BASE}/install-mac.command`
  const macUninstall = `${EXT_BASE}/uninstall-mac.command`

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
          Connects your Gemini account to PNE LC AI. Takes about a minute — pick your system
          below and follow the steps.
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
              <Step n={1} title="Download the installer script">
                <a
                  href={winInstall}
                  download
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-orange-600 to-amber-600 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:from-orange-500 hover:to-amber-500 active:scale-[0.99]"
                >
                  <Download className="size-4" /> Download install-windows.ps1
                </a>
              </Step>
              <Step n={2} title="Open PowerShell in your Downloads folder and run:">
                <CommandBox command="powershell -ExecutionPolicy Bypass -File .\install-windows.ps1" />
                <p className="mt-2 text-xs text-zinc-500">
                  No administrator rights needed. Tip: in the Downloads folder, type{' '}
                  <span className="font-mono text-zinc-400">powershell</span> in the address
                  bar and press Enter.
                </p>
              </Step>
              <Step n={3} title="Restart Chrome to finish">
                <p className="text-sm text-zinc-400">
                  Fully quit Chrome and reopen it (or paste{' '}
                  <span className="font-mono text-zinc-300">chrome://restart</span> into the
                  address bar). The extension installs itself within a minute.
                </p>
              </Step>
            </ol>
          ) : (
            <ol className="flex flex-col gap-6">
              <Step n={1} title="Download the installer">
                <a
                  href={macInstall}
                  download
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-orange-600 to-amber-600 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:from-orange-500 hover:to-amber-500 active:scale-[0.99]"
                >
                  <Download className="size-4" /> Download install-mac.command
                </a>
              </Step>
              <Step n={2} title="Open Terminal in your Downloads folder and run:">
                <CommandBox command="chmod +x install-mac.command && ./install-mac.command" />
                <p className="mt-2 text-xs text-zinc-500">
                  No administrator rights needed.
                </p>
              </Step>
              <Step n={3} title="Restart Chrome to finish">
                <p className="text-sm text-zinc-400">
                  Quit Chrome with <span className="font-mono text-zinc-300">Cmd+Q</span> and
                  reopen it. The extension installs itself within a minute.
                </p>
              </Step>
            </ol>
          )}
        </div>

        {/* Reassurance line */}
        <div className="mt-5 flex items-start gap-2.5 rounded-2xl border border-emerald-400/15 bg-emerald-500/[0.06] px-4 py-3">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-400" />
          <p className="text-xs leading-relaxed text-emerald-200/80">
            After it installs, the extension keeps itself up to date automatically — you
            never have to reinstall.
          </p>
        </div>

        {/* Uninstall (collapsible) */}
        <div className="mt-4 w-full">
          <button
            onClick={() => setShowUninstall((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
          >
            <ChevronDown
              className={`size-3.5 transition-transform ${showUninstall ? 'rotate-180' : ''}`}
            />
            Need to remove it?
          </button>
          {showUninstall && (
            <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
              <p className="mb-3 text-xs text-zinc-400">
                Because the extension is managed, it can’t be removed from Chrome’s menu —
                run the uninstaller instead, then restart Chrome.
              </p>
              {os === 'windows' ? (
                <>
                  <a
                    href={winUninstall}
                    download
                    className="mb-2 inline-flex items-center gap-2 text-xs font-medium text-orange-300 hover:text-orange-200"
                  >
                    <Download className="size-3.5" /> Download uninstall-windows.ps1
                  </a>
                  <CommandBox command="powershell -ExecutionPolicy Bypass -File .\uninstall-windows.ps1" />
                </>
              ) : (
                <>
                  <a
                    href={macUninstall}
                    download
                    className="mb-2 inline-flex items-center gap-2 text-xs font-medium text-orange-300 hover:text-orange-200"
                  >
                    <Download className="size-3.5" /> Download uninstall-mac.command
                  </a>
                  <CommandBox command="chmod +x uninstall-mac.command && ./uninstall-mac.command" />
                </>
              )}
            </div>
          )}
        </div>

        <p className="mt-8 flex items-center gap-1.5 text-xs text-zinc-600">
          <RefreshCw className="size-3" /> Chrome only — Windows &amp; macOS
        </p>
      </div>
    </div>
  )
}
