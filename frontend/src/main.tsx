import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { CartProvider } from './cart/CartContext'
import AppLayout from './components/AppLayout'
import Login from './pages/Login'
import Register from './pages/Register'
import Chat from './pages/Chat'
import Admin from './pages/Admin'
import Discover from './pages/Discover'
import Inbox from './pages/Inbox'

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
      <BrowserRouter>
        <CartProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route element={<AppLayout />}>
              <Route path="/" element={<Chat />} />
              <Route path="/discover" element={<Discover />} />
              <Route path="/inbox" element={<Inbox />} />
              <Route path="/admin" element={<AdminRoute><Admin /></AdminRoute>} />
            </Route>
          </Routes>
        </CartProvider>
      </BrowserRouter>
    </AuthProvider>
  </React.StrictMode>,
)
