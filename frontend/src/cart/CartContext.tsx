import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react'
import { api, CartView } from '../api'
import { useAuth } from '../hooks/useAuth'

interface CartContextValue {
  items: CartView['items']
  itemCount: number
  total: number
  isOpen: boolean
  open: () => void
  close: () => void
  toggle: () => void
  refresh: () => Promise<void>
  addItem: (productId: number, quantity?: number) => Promise<{ ok: boolean; reason?: string; error?: string }>
  setQuantity: (productId: number, quantity: number) => Promise<{ ok: boolean; error?: string }>
  removeItem: (productId: number) => Promise<{ ok: boolean; error?: string }>
  checkout: () => Promise<string | null>
}

const EMPTY: CartView = { items: [], item_count: 0, total: 0 }

const CartContext = createContext<CartContextValue | null>(null)

export function CartProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth()
  const [cart, setCart] = useState<CartView>(EMPTY)
  const [isOpen, setIsOpen] = useState(false)

  const refresh = useCallback(async () => {
    if (!token) {
      setCart(EMPTY)
      return
    }
    try {
      const c = await api.getCart(token)
      setCart(c)
    } catch {
      // Stale token / network — keep last known good.
    }
  }, [token])

  useEffect(() => {
    refresh()
  }, [refresh])

  const addItem = useCallback(async (productId: number, quantity = 1) => {
    if (!token) return { ok: false, reason: 'not_logged_in' as const }
    try {
      const res = await api.addCartItem(productId, quantity, token)
      setCart(res.cart)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Failed to add to cart.' }
    }
  }, [token])

  const setQuantity = useCallback(async (productId: number, quantity: number) => {
    if (!token) return { ok: false, error: 'Not signed in.' }
    try {
      const res = await api.setCartItemQuantity(productId, quantity, token)
      setCart(res.cart)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Failed to update cart.' }
    }
  }, [token])

  const removeItem = useCallback(async (productId: number) => {
    if (!token) return { ok: false, error: 'Not signed in.' }
    try {
      const res = await api.removeCartItem(productId, token)
      setCart(res.cart)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Failed to remove item.' }
    }
  }, [token])

  const checkout = useCallback(async () => {
    if (!token) return null
    const res = await api.checkoutCart(token)
    setCart(EMPTY)
    return res.checkout_url
  }, [token])

  const value = useMemo<CartContextValue>(() => ({
    items: cart.items,
    itemCount: cart.item_count,
    total: cart.total,
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    toggle: () => setIsOpen(o => !o),
    refresh,
    addItem,
    setQuantity,
    removeItem,
    checkout,
  }), [cart, isOpen, refresh, addItem, setQuantity, removeItem, checkout])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used within CartProvider')
  return ctx
}
