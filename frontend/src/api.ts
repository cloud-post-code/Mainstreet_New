const BASE = import.meta.env.VITE_API_URL ?? 'https://backend-production-c5f5.up.railway.app'

export function clearStoredAuth() {
  localStorage.removeItem('token')
  localStorage.removeItem('user')
}

async function request<T>(path: string, options: RequestInit = {}, token?: string | null): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> ?? {}),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${BASE}${path}`, { ...options, headers })
  if (!res.ok) {
    if (res.status === 401) {
      clearStoredAuth()
      window.location.reload()
    }
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? 'Request failed')
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export interface User { id: number; email: string; display_name: string | null; is_admin: boolean }
export interface Token { access_token: string; user: User }
export interface Shop { id: number; name: string; logo_url: string | null; description: string | null; website_url: string | null; product_count: number | null }
export interface Product { id: number; shop_id: number; shop_name: string | null; name: string; price: string; quantity: number; image_url: string | null; description: Record<string, unknown> | null }
export interface Session { id: number; title: string; created_at: string; updated_at: string }
export interface InboxMessage { id: number; user_id: number; session_id: number | null; title: string; preview: string; body: string; read: boolean; created_at: string }
export interface PlanStep { step: number; description: string; done: boolean }
export interface Plan { id: number; session_id: number; steps: PlanStep[]; updated_at: string }

export const api = {
  register: (email: string, password: string, display_name?: string) =>
    request<Token>('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password, display_name }) }),

  login: (email: string, password: string) =>
    request<Token>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  getSessions: (token: string) =>
    request<Session[]>('/api/agent/sessions', {}, token),

  createSession: (token: string) =>
    request<Session>('/api/agent/sessions', { method: 'POST' }, token),

  createGuestSession: () =>
    request<Session>('/api/agent/guest-session', { method: 'POST' }),

  getPlan: (sessionId: number, token: string) =>
    request<Plan | null>(`/api/agent/sessions/${sessionId}/plan`, {}, token),

  importCsv: (file: File, token: string) => {
    const fd = new FormData()
    fd.append('file', file)
    return fetch(`${BASE}/api/admin/import`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    }).then(r => r.json())
  },

  getTurns: (
    sessionId: number,
    token: string,
    opts: { limit?: number; before?: string } = {},
  ) => {
    const params = new URLSearchParams()
    if (opts.limit) params.set('limit', String(opts.limit))
    if (opts.before) params.set('before', opts.before)
    const qs = params.toString()
    return request<{
      turns: Array<{ role: string; content: unknown; tool_calls: unknown; tool_results: unknown; created_at: string }>
      has_more: boolean
      next_cursor: string | null
    }>(`/api/agent/sessions/${sessionId}/turns${qs ? `?${qs}` : ''}`, {}, token)
  },

  deleteSession: (id: number, token: string) =>
    request<void>(`/api/agent/sessions/${id}`, { method: 'DELETE' }, token),

  importShopsCsv: (file: File, token: string) => {
    const fd = new FormData()
    fd.append('file', file)
    return fetch(`${BASE}/api/admin/import/shops`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    }).then(r => r.json())
  },

  seedDatabase: (token: string, force = false) =>
    request<{ status: string; message: string }>(`/api/admin/seed${force ? '?force=true' : ''}`, { method: 'POST' }, token),

  adminShops: (token: string) => request<Shop[]>('/api/admin/shops', {}, token),
  adminProducts: (token: string, shopId?: number, limit = 500) =>
    request<Product[]>(`/api/admin/products?limit=${limit}${shopId ? `&shop_id=${shopId}` : ''}`, {}, token),
  deleteShop: (id: number, token: string) =>
    request<void>(`/api/admin/shops/${id}`, { method: 'DELETE' }, token),
  deleteProduct: (id: number, token: string) =>
    request<void>(`/api/admin/products/${id}`, { method: 'DELETE' }, token),

  getInbox: (token: string) =>
    request<InboxMessage[]>('/api/inbox', {}, token),

  markRead: (id: number, token: string) =>
    request<InboxMessage>(`/api/inbox/${id}/read`, { method: 'PATCH' }, token),

  openInboxMessage: (id: number, token: string) =>
    request<{ session_id: number }>(`/api/inbox/${id}/open`, { method: 'POST' }, token),

  uploadListingImage: (file: File, token: string) => {
    const fd = new FormData()
    fd.append('file', file)
    return fetch(`${BASE}/api/admin/listing/upload-image`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    }).then(async r => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? 'Upload failed')
      return r.json() as Promise<{ image_url: string }>
    })
  },

  streamListingDraft: async (
    body: { shop_id: number; image_url: string; user_text?: string; quantity?: number; price?: number },
    token: string,
    onEvent: (evt: ListingEvent) => void,
  ) => {
    const res = await fetch(`${BASE}/api/admin/listing/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(err.detail ?? 'Draft failed')
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line) continue
        try { onEvent(JSON.parse(line) as ListingEvent) } catch { /* ignore */ }
      }
    }
    if (buffer.trim()) {
      try { onEvent(JSON.parse(buffer) as ListingEvent) } catch { /* ignore */ }
    }
  },

  approveListing: (body: {
    shop_id: number
    name: string
    price: number | string
    quantity: number
    image_url?: string | null
    description?: Record<string, unknown>
  }, token: string) =>
    request<Product>('/api/admin/listing/approve', { method: 'POST', body: JSON.stringify(body) }, token),
}

export type ListingStage = 'vision' | 'market' | 'writer' | 'verify'
export type ListingEvent =
  | { type: 'stage'; stage: ListingStage; status: 'start' | 'done' | 'error'; data?: Record<string, unknown>; error?: string }
  | { type: 'draft'; draft: ListingDraft }
  | { type: 'error'; error: string }

export interface ListingDraft {
  name: string
  price: string
  quantity: number
  image_url: string | null
  tags: string[]
  description: {
    summary?: string
    long?: string
    tags?: string[]
    vision_attributes?: Record<string, unknown>
    market_comps?: Array<{ title?: string; price?: number; url?: string; source?: string }>
    price_range?: { low?: number; mid?: number; high?: number }
    price_rationale?: string
  }
  flags: Array<{ field: string; issue: string; severity?: string }>
}
