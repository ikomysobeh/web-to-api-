import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { getMe } from '@/services/api'

interface User {
  email: string
}

interface AuthContextValue {
  user: User | null
  token: string | null
  isLoading: boolean
  login: (token: string, email: string) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const storedToken = localStorage.getItem('auth_token')
    const storedEmail = localStorage.getItem('auth_email')
    if (!storedToken) {
      setIsLoading(false)
      return
    }
    getMe(storedToken)
      .then(() => {
        setToken(storedToken)
        setUser({ email: storedEmail ?? '' })
      })
      .catch(() => {
        localStorage.removeItem('auth_token')
        localStorage.removeItem('auth_email')
      })
      .finally(() => setIsLoading(false))
  }, [])

  function login(newToken: string, email: string) {
    localStorage.setItem('auth_token', newToken)
    localStorage.setItem('auth_email', email)
    setToken(newToken)
    setUser({ email })
  }

  function logout() {
    localStorage.removeItem('auth_token')
    localStorage.removeItem('auth_email')
    setToken(null)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
