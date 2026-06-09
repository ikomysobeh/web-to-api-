import { useCallback, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { saveCookies } from '@/services/api'
import { useExtensionCookies } from '@/hooks/useExtensionCookies'

interface CookieSetupModalProps {
  onSuccess: () => void
}

export function CookieSetupModal({ onSuccess }: CookieSetupModalProps) {
  const { token } = useAuth()
  const [status, setStatus] = useState<'waiting' | 'saving' | 'error'>('waiting')
  const [errorMsg, setErrorMsg] = useState('')

  const handleCookies = useCallback(
    async (psid: string, psidts: string) => {
      if (!token) return
      setStatus('saving')
      setErrorMsg('')
      try {
        await saveCookies(token, psid, psidts)
        onSuccess()
      } catch {
        setStatus('error')
        setErrorMsg('Failed to save cookies. Please try again.')
      }
    },
    [token, onSuccess],
  )

  useExtensionCookies(handleCookies)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-8 shadow-2xl">
        {/* Header */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-violet-600/20 ring-1 ring-violet-500/30">
            <svg viewBox="0 0 24 24" fill="none" className="size-7 text-violet-400" stroke="currentColor" strokeWidth="1.5">
              <path d="M13.5 10.5L21 3m0 0h-6m6 0v6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M10.5 13.5L3 21m0 0h6m-6 0v-6" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-zinc-50">Connect your Gemini account</h2>
          <p className="mt-1.5 text-sm text-zinc-400">
            Lumina AI needs your Gemini session to work. Follow the steps below.
          </p>
        </div>

        {/* Steps */}
        <ol className="mb-6 flex flex-col gap-3">
          {[
            {
              n: 1,
              text: 'Install the',
              highlight: 'Lumina Extension',
              after: 'in Chrome',
            },
            { n: 2, text: 'Go to', highlight: 'gemini.google.com', after: 'and sign in' },
            {
              n: 3,
              text: 'Click the',
              highlight: 'Lumina extension icon',
              after: 'in your Chrome toolbar',
            },
            { n: 4, text: 'Click', highlight: '"Capture & Send"', after: 'in the popup' },
          ].map((step) => (
            <li key={step.n} className="flex items-start gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-violet-600/20 text-xs font-bold text-violet-400 ring-1 ring-violet-500/30">
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
          <div className="flex items-center justify-center gap-2.5 rounded-xl border border-zinc-700 bg-zinc-800/50 px-4 py-3">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full bg-violet-500" />
            </span>
            <p className="text-sm text-zinc-400">Waiting for extension to send cookies…</p>
          </div>
        )}

        {status === 'saving' && (
          <div className="flex items-center justify-center gap-2.5 rounded-xl border border-zinc-700 bg-zinc-800/50 px-4 py-3">
            <svg className="size-4 animate-spin text-violet-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-sm text-zinc-400">Saving your session…</p>
          </div>
        )}

        {status === 'error' && (
          <div className="rounded-xl border border-red-900/50 bg-red-950/40 px-4 py-3">
            <p className="text-sm text-red-400">{errorMsg}</p>
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
