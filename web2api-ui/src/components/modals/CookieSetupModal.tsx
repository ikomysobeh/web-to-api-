import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { getCookiesStatus, saveCookies } from '@/services/api'
import { useExtensionCookies } from '@/hooks/useExtensionCookies'

interface CookieSetupModalProps {
  onSuccess: () => void
}

export function CookieSetupModal({ onSuccess }: CookieSetupModalProps) {
  const { token } = useAuth()
  const [status, setStatus] = useState<'waiting' | 'saving' | 'success' | 'error'>('waiting')
  const [errorMsg, setErrorMsg] = useState('')

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="glass-strong w-full max-w-md rounded-2xl p-8">
        {/* Header */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/25 to-fuchsia-500/25 ring-1 ring-inset ring-white/10">
            <svg viewBox="0 0 24 24" fill="none" className="size-7 text-violet-300" stroke="currentColor" strokeWidth="1.5">
              <path d="M13.5 10.5L21 3m0 0h-6m6 0v6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M10.5 13.5L3 21m0 0h6m-6 0v-6" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold tracking-tight text-zinc-50">Connect your Gemini account</h2>
          <p className="mt-1.5 text-sm text-zinc-400">
            One click in the Lumina extension connects your Gemini session automatically.
          </p>
        </div>

        {/* Steps */}
        <ol className="mb-6 flex flex-col gap-3">
          {[
            { n: 1, text: 'Install the', highlight: 'Lumina Extension', after: 'in Chrome' },
            { n: 2, text: 'Sign in to', highlight: 'Lumina AI', after: 'on this page' },
            { n: 3, text: 'Click the', highlight: 'Lumina icon', after: 'in your Chrome toolbar' },
            { n: 4, text: 'Click', highlight: '"Connect Gemini Automatically"', after: '— done!' },
          ].map((step) => (
            <li key={step.n} className="flex items-start gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500/25 to-fuchsia-500/25 text-xs font-bold text-violet-300 ring-1 ring-inset ring-white/10">
                {step.n}
              </span>
              <p className="text-sm text-zinc-300">
                {step.text}{' '}
                <span className="font-semibold text-zinc-100">{step.highlight}</span>{' '}
                {step.after}
              </p>
            </li>
          ))}
        </ol>

        {/* Status */}
        {status === 'waiting' && (
          <div className="flex items-center justify-center gap-2.5 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full bg-violet-500" />
            </span>
            <p className="text-sm text-zinc-400">Waiting for extension to connect Gemini…</p>
          </div>
        )}

        {status === 'saving' && (
          <div className="flex items-center justify-center gap-2.5 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
            <svg className="size-4 animate-spin text-violet-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-sm text-zinc-400">Saving your session…</p>
          </div>
        )}

        {status === 'success' && (
          <div className="flex items-center justify-center gap-2.5 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3">
            <svg viewBox="0 0 24 24" fill="none" className="size-4 text-emerald-400" stroke="currentColor" strokeWidth="2">
              <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="text-sm text-emerald-300">Gemini connected! Opening chat…</p>
          </div>
        )}

        {status === 'error' && (
          <div className="rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3">
            <p className="text-sm text-red-300">{errorMsg}</p>
            <button
              onClick={() => setStatus('waiting')}
              className="mt-2 text-xs text-red-300 underline hover:text-red-200"
            >
              Try again
            </button>
          </div>
        )}

        <p className="mt-4 text-center text-xs text-zinc-600">
          Your cookies are sent only to your local Lumina AI instance and stored securely.
        </p>
      </div>
    </div>
  )
}
