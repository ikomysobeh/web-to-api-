import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import AppShell from '@/app/AppShell'
import LoginPage from '@/pages/LoginPage'
import RegisterPage from '@/pages/RegisterPage'
import type { ReactNode } from 'react'

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { token, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-zinc-950">
        <div className="size-6 animate-spin rounded-full border-2 border-zinc-700 border-t-violet-500" />
      </div>
    )
  }

  if (!token) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route
            path="/chat"
            element={
              <ProtectedRoute>
                <AppShell />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

