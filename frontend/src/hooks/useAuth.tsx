import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'

interface User {
  id: number
  email: string
  display_name: string | null
  is_admin: boolean
}

interface AuthContextValue {
  token: string | null
  user: User | null
  login: (token: string, user: User) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'))
  const [user, setUser] = useState<User | null>(() => {
    const u = localStorage.getItem('user')
    if (!u) return null
    try {
      return JSON.parse(u) as User
    } catch {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      return null
    }
  })

  useEffect(() => {
    const onRefresh = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail
      if (typeof detail === 'string' && detail) setToken(detail)
    }
    window.addEventListener('auth:token-refreshed', onRefresh)
    return () => window.removeEventListener('auth:token-refreshed', onRefresh)
  }, [])

  const login = useCallback((t: string, u: User) => {
    setToken(t)
    setUser(u)
    localStorage.setItem('token', t)
    localStorage.setItem('user', JSON.stringify(u))
  }, [])

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
    localStorage.removeItem('token')
    localStorage.removeItem('user')
  }, [])

  return (
    <AuthContext.Provider value={{ token, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
