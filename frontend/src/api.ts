const BASE = import.meta.env.VITE_API_URL
if (!BASE) {
  throw new Error(
    'VITE_API_URL is not set. Configure it in your .env file (see frontend/.env.example).',
  )
}

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
    const detail = err.detail
    const message = typeof detail === 'string'
      ? detail
      : (detail && typeof detail === 'object' && typeof detail.message === 'string')
        ? detail.message
        : 'Request failed'
    throw new Error(message)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export interface User { id: number; email: string; display_name: string | null; is_admin: boolean }
export interface Token { access_token: string; user: User }
export interface Shop { id: number; name: string; logo_url: string | null; description: string | null; website_url: string | null; product_count: number | null }
export interface Product { id: number; shop_id: number; shop_name: string | null; name: string; price: string; quantity: number; image_url: string | null; description: Record<string, unknown> | null }
export interface AdminProductsPage { items: Product[]; total: number; limit: number; offset: number }
export interface Session { id: number; title: string; session_type?: string; created_at: string; updated_at: string }
export interface InboxMessage { id: number; user_id: number; session_id: number | null; title: string; preview: string; body: string; read: boolean; created_at: string }
export interface PlanStep { step: number; description: string; done: boolean }
export interface Plan { id: number; session_id: number; steps: PlanStep[]; updated_at: string }

export interface MasonNote { key: string; text: string; created_at: string | null }
export interface MasonPrefs { sizes: string; budget: string; likes: string; dislikes: string }
export interface MasonSavedProduct {
  product_id: number
  name: string
  price: number
  quantity: number
  image_url: string | null
  shop_id: number
  shop_name: string | null
  saved_at: string | null
}

export interface CartItem {
  product_id: number
  name: string
  shop_name: string | null
  image_url: string | null
  price: number
  quantity: number
  subtotal: number
}
export interface CartView { items: CartItem[]; item_count: number; total: number }

export interface DiscoverOpts {
  q?: string
  shop_id?: number
  shop_ids?: number[]
  tags?: string[]
  min_price?: number
  max_price?: number
  in_stock_only?: boolean
  limit?: number
  offset?: number
}

function buildDiscoverQuery(opts: DiscoverOpts, includePaging: boolean): string {
  const params = new URLSearchParams()
  if (opts.q) params.set('q', opts.q)
  if (opts.shop_id != null) params.set('shop_id', String(opts.shop_id))
  if (opts.shop_ids && opts.shop_ids.length) params.set('shop_ids', opts.shop_ids.join(','))
  if (opts.tags && opts.tags.length) params.set('tags', opts.tags.join(','))
  if (opts.min_price != null) params.set('min_price', String(opts.min_price))
  if (opts.max_price != null) params.set('max_price', String(opts.max_price))
  if (opts.in_stock_only) params.set('in_stock_only', 'true')
  if (includePaging) {
    if (opts.limit != null) params.set('limit', String(opts.limit))
    if (opts.offset != null) params.set('offset', String(opts.offset))
  }
  return params.toString()
}

export const api = {
  register: (email: string, password: string, display_name?: string) =>
    request<Token>('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password, display_name }) }),

  login: (email: string, password: string) =>
    request<Token>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  getSessions: (token: string, sessionType?: 'shop' | 'mason') => {
    const qs = sessionType ? `?session_type=${sessionType}` : ''
    return request<Session[]>(`/api/agent/sessions${qs}`, {}, token)
  },

  getSuggestions: (token: string) =>
    request<{ suggestions: string[] }>('/api/agent/suggestions', {}, token),

  createSession: (token: string, sessionType?: 'shop' | 'mason') =>
    request<Session>('/api/agent/sessions', {
      method: 'POST',
      body: JSON.stringify({ session_type: sessionType ?? 'shop' }),
    }, token),

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

  downloadProductsCsv: async (token: string, shopId?: number) => {
    const qs = shopId ? `?shop_id=${shopId}` : ''
    const res = await fetch(`${BASE}/api/admin/export/products${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(err.detail ?? 'Download failed')
    }
    return { blob: await res.blob(), filename: 'products.csv' }
  },

  downloadShopsCsv: async (token: string) => {
    const res = await fetch(`${BASE}/api/admin/export/shops`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(err.detail ?? 'Download failed')
    }
    return { blob: await res.blob(), filename: 'shops.csv' }
  },

  getDiscoverProducts: (opts: DiscoverOpts = {}) => {
    const qs = buildDiscoverQuery(opts, true)
    return request<Product[]>(`/api/products/discover${qs ? `?${qs}` : ''}`)
  },

  getDiscoverCount: (opts: DiscoverOpts = {}) => {
    const qs = buildDiscoverQuery(opts, false)
    return request<{ total: number }>(`/api/products/discover/count${qs ? `?${qs}` : ''}`)
  },

  getPublicShops: () =>
    request<Array<{ id: number; name: string }>>('/api/shops/public'),

  getPublicShopsFull: () =>
    request<Array<{
      id: number
      name: string
      logo_url: string | null
      description: string | null
      website_url: string | null
      product_count: number
    }>>('/api/shops/public/full'),

  getProductTags: () => request<string[]>('/api/products/tags'),

  getCart: (token: string) => request<CartView>('/api/cart', {}, token),
  addCartItem: (product_id: number, quantity: number, token: string) =>
    request<{ result: unknown; cart: CartView }>('/api/cart/items', {
      method: 'POST',
      body: JSON.stringify({ product_id, quantity }),
    }, token),
  setCartItemQuantity: (product_id: number, quantity: number, token: string) =>
    request<{ result: unknown; cart: CartView }>(`/api/cart/items/${product_id}`, {
      method: 'PATCH',
      body: JSON.stringify({ quantity }),
    }, token),
  removeCartItem: (product_id: number, token: string) =>
    request<{ result: unknown; cart: CartView }>(`/api/cart/items/${product_id}`, {
      method: 'DELETE',
    }, token),
  checkoutCart: (token: string) =>
    request<{ checkout_url: string | null; items_count: number; total: number; reason?: string }>(
      '/api/cart/checkout',
      { method: 'POST' },
      token,
    ),

  adminShops: (token: string) => request<Shop[]>('/api/admin/shops', {}, token),
  createShop: (
    body: { name: string; logo_url?: string; description?: string; website_url?: string },
    token: string,
  ) => request<Shop>('/api/admin/shops', { method: 'POST', body: JSON.stringify(body) }, token),
  adminProducts: (
    token: string,
    opts: { shopId?: number; limit?: number; offset?: number; q?: string } = {},
  ) => {
    const params = new URLSearchParams()
    params.set('limit', String(opts.limit ?? 100))
    params.set('offset', String(opts.offset ?? 0))
    if (opts.shopId != null) params.set('shop_id', String(opts.shopId))
    if (opts.q && opts.q.trim()) params.set('q', opts.q.trim())
    return request<AdminProductsPage>(`/api/admin/products?${params.toString()}`, {}, token)
  },
  deleteShop: (id: number, token: string) =>
    request<void>(`/api/admin/shops/${id}`, { method: 'DELETE' }, token),
  deleteProduct: (id: number, token: string) =>
    request<void>(`/api/admin/products/${id}`, { method: 'DELETE' }, token),

  getMasonNotes: (token: string) =>
    request<MasonNote[]>('/api/mason/notes', {}, token),
  addMasonNote: (text: string, token: string) =>
    request<MasonNote>('/api/mason/notes', { method: 'POST', body: JSON.stringify({ text }) }, token),
  deleteMasonNote: (key: string, token: string) =>
    request<void>(`/api/mason/notes/${encodeURIComponent(key)}`, { method: 'DELETE' }, token),

  getMasonPrefs: (token: string) =>
    request<MasonPrefs>('/api/mason/prefs', {}, token),
  updateMasonPrefs: (patch: Partial<MasonPrefs>, token: string) =>
    request<MasonPrefs>('/api/mason/prefs', { method: 'PATCH', body: JSON.stringify(patch) }, token),

  getMasonSavedProducts: (token: string) =>
    request<MasonSavedProduct[]>('/api/mason/saved-products', {}, token),
  saveMasonProduct: (product_id: number, token: string) =>
    request<{ product_id: number; newly_saved: boolean }>(
      '/api/mason/saved-products',
      { method: 'POST', body: JSON.stringify({ product_id }) },
      token,
    ),
  unsaveMasonProduct: (product_id: number, token: string) =>
    request<void>(`/api/mason/saved-products/${product_id}`, { method: 'DELETE' }, token),

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

  uploadShopLogo: (file: File, token: string) => {
    const fd = new FormData()
    fd.append('file', file)
    return fetch(`${BASE}/api/admin/shops/upload-logo`, {
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

export type ListingStage = 'vision' | 'market' | 'writer' | 'verify' | 'image_enhance'
export type ListingEvent =
  | { type: 'stage'; stage: ListingStage; status: 'start' | 'done' | 'error'; data?: Record<string, unknown>; error?: string }
  | { type: 'thinking'; stage: ListingStage; content: string }
  | { type: 'image'; stage: 'image_enhance'; kind: 'enhanced' | 'in_use'; url: string }
  | { type: 'draft'; draft: ListingDraft }
  | { type: 'error'; error: string }

export interface ListingImages {
  original_url: string
  enhanced_url: string
  in_use_url: string | null
}

export interface ListingDraft {
  name: string
  price: string
  quantity: number
  image_url: string | null
  tags: string[]
  images?: ListingImages
  description: {
    summary?: string
    long?: string
    tags?: string[]
    vision_attributes?: Record<string, unknown>
    market_comps?: Array<{ title?: string; price?: number; url?: string; source?: string }>
    price_range?: { low?: number; mid?: number; high?: number }
    price_rationale?: string
    images?: ListingImages
  }
  flags: Array<{ field: string; issue: string; severity?: string }>
}
