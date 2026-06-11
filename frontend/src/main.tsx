import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { CartProvider } from './cart/CartContext'
import { MasonProvider } from './mason/MasonContext'
import AppLayout from './components/AppLayout'
import Login from './pages/Login'
import Register from './pages/Register'
import Chat from './pages/Chat'
import Admin from './pages/Admin'
import Discover from './pages/Discover'
import Mason from './pages/Mason'
import { initPostHog, identify, reset } from './analytics/posthog'

initPostHog()

function PostHogIdentity() {
  const { user } = useAuth()
  React.useEffect(() => {
    if (user?.id) {
      identify(user.id, { email: user.email, is_admin: user.is_admin })
    } else {
      reset()
    }
  }, [user?.id])
  return null
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { token } = useAuth()
  return token ? <>{children}</> : <Navigate to="/login" replace />
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { token, user } = useAuth()
  if (!token) return <Navigate to="/login" replace />
  if (!user?.is_admin) return <Navigate to="/" replace />
  return <>{children}</>
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <PostHogIdentity />
      <BrowserRouter>
        <CartProvider>
          <MasonProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route element={<AppLayout />}>
              <Route path="/" element={<Chat />} />
              <Route path="/discover" element={<Discover />} />
              <Route path="/mason" element={<Mason />} />
              <Route path="/inbox" element={<Navigate to="/mason" replace />} />
              <Route path="/admin" element={<AdminRoute><Admin /></AdminRoute>} />
            </Route>
          </Routes>
          </MasonProvider>
        </CartProvider>
      </BrowserRouter>
    </AuthProvider>
  </React.StrictMode>,
)
