import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import AppShell from '@/app/AppShell'
import AdminShell from '@/app/AdminShell'
import { AdminDashboard } from '@/components/admin/AdminDashboard'
import { AgentsPage } from '@/components/admin/AgentsPage'
import { AgentDetailPage } from '@/components/admin/AgentDetailPage'
import { EmbedPage } from '@/components/admin/EmbedPage'
import { UsersPage } from '@/components/admin/UsersPage'
import LoginPage from '@/pages/LoginPage'
import WidgetPage from '@/pages/WidgetPage'
import type { ReactNode } from 'react'

function Spinner() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-zinc-950">
      <div className="size-6 animate-spin rounded-full border-2 border-zinc-700 border-t-violet-500" />
    </div>
  )
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { token, isLoading } = useAuth()
  if (isLoading) return <Spinner />
  if (!token) return <Navigate to="/login" replace />
  return <>{children}</>
}

function AdminRoute({ children }: { children: ReactNode }) {
  const { token, isAdmin, isLoading } = useAuth()
  if (isLoading || isAdmin === null) return <Spinner />
  if (!token) return <Navigate to="/login" replace />
  if (!isAdmin) return <Navigate to="/chat" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/widget" element={<WidgetPage />} />
          <Route
            path="/chat"
            element={
              <ProtectedRoute>
                <AppShell />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <AdminRoute>
                <AdminShell />
              </AdminRoute>
            }
          >
            <Route index element={<AdminDashboard />} />
            <Route path="agents" element={<AgentsPage />} />
            <Route path="agents/:agentId" element={<AgentDetailPage />} />
            <Route path="embed" element={<EmbedPage />} />
            <Route path="users" element={<UsersPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
