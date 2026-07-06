import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Loader2, Lock, Mail } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { login as apiLogin } from '@/services/api'
import { getErrorMessage } from '@/lib/errors'

export default function LoginPage() {
  const { login, token, isLoading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await apiLogin(email, password)
      // Embed popup mode: hand the token back to the widget that opened us, then close.
      const isEmbedPopup =
        new URLSearchParams(window.location.search).get('embed') === '1'
      if (isEmbedPopup && window.opener) {
        window.opener.postMessage(
          { type: 'lumina-auth', token: data.token, email: data.email },
          window.location.origin,
        )
        window.close()
        return
      }
      login(data.token, data.email)
      navigate('/chat')
    } catch (err: unknown) {
      setError(await getErrorMessage(err, 'Invalid email or password.'))
    } finally {
      setLoading(false)
    }
  }

  const isEmbedPopup =
    new URLSearchParams(window.location.search).get('embed') === '1'

  // Already signed in: send the user to chat instead of showing the login form.
  // (Skip the redirect in embed-popup mode — that flow closes itself after login.)
  if (token && !isEmbedPopup) {
    return <Navigate to="/chat" replace />
  }

  // Avoid flashing the form while we're still checking the stored session.
  if (authLoading) {
    return (
      <div className="app-bg flex h-screen w-screen items-center justify-center">
        <div className="size-6 animate-spin rounded-full border-2 border-zinc-700 border-t-orange-500" />
      </div>
    )
  }

  return (
    <div className="app-bg relative flex h-screen w-screen items-center justify-center overflow-hidden p-4">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute left-1/2 top-0 size-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-orange-600/20 to-amber-600/10 blur-3xl" />

      <div className="relative w-full max-w-sm rounded-3xl border border-white/10 bg-white/[0.03] p-8 backdrop-blur-xl">
        {/* Brand */}
        <div className="mb-7 flex flex-col items-center text-center">
          <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-amber-500">
            <svg viewBox="0 0 24 24" fill="none" className="size-6 text-white" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z" strokeLinejoin="round" />
              <path d="M2 17l10 5 10-5" strokeLinejoin="round" />
              <path d="M2 12l10 5 10-5" strokeLinejoin="round" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">Welcome back</h1>
          <p className="mt-1 text-sm text-zinc-400">Sign in to your PNE LC AI account</p>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Email */}
          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-zinc-300">
              Email
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pl-10 pr-3 text-sm text-zinc-100 placeholder:text-zinc-500 transition-colors focus:border-orange-400/40 focus:outline-none focus:ring-1 focus:ring-orange-400/40"
                placeholder="you@example.com"
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-zinc-300">
              Password
            </label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pl-10 pr-10 text-sm text-zinc-100 placeholder:text-zinc-500 transition-colors focus:border-orange-400/40 focus:outline-none focus:ring-1 focus:ring-orange-400/40"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                tabIndex={-1}
                className="absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-300"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-orange-600 to-amber-600 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:from-orange-500 hover:to-amber-500 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading && <Loader2 className="size-4 animate-spin" />}
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
