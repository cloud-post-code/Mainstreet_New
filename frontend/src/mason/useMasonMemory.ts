import { useCallback, useEffect, useRef, useState } from 'react'
import { api, InboxMessage, MasonNote, MasonPrefs, MasonPrefsPatch, MasonSavedProduct } from '../api'

const EMPTY_PREFS: MasonPrefs = {
  sizes: {},
  style_tags: [],
  quality_price: null,
  bulk_individual: null,
  discover_known: null,
  gift_budget: {},
  personal_budget: null,
  lifestyle: {},
  likes: [],
  dislikes: [],
}

export interface MasonMemory {
  notes: MasonNote[]
  prefs: MasonPrefs
  savedProducts: MasonSavedProduct[]
  inbox: InboxMessage[]
  loading: boolean
  addNote: (text: string) => Promise<void>
  removeNote: (key: string) => Promise<void>
  patchPrefs: (patch: MasonPrefsPatch) => void
  saveProduct: (product: MasonSavedProduct | { product_id: number; name: string; price: number; image_url: string | null; shop_id: number; shop_name: string | null; quantity: number }) => Promise<void>
  unsaveProduct: (productId: number) => Promise<void>
  refresh: () => Promise<void>
  refreshInbox: () => Promise<void>
}

const JSONB_KEYS: Array<keyof MasonPrefs> = ['sizes', 'gift_budget', 'lifestyle']

// One hook that owns the three Mason memory resources. Gated on token —
// signed-out users get empty data and a no-op refresh so the panel can
// fall back to a sign-in prompt without crashing.
export function useMasonMemory(token: string | null): MasonMemory {
  const [notes, setNotes] = useState<MasonNote[]>([])
  const [prefs, setPrefs] = useState<MasonPrefs>(EMPTY_PREFS)
  const [savedProducts, setSavedProducts] = useState<MasonSavedProduct[]>([])
  const [inbox, setInbox] = useState<InboxMessage[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!token) {
      setNotes([]); setPrefs(EMPTY_PREFS); setSavedProducts([]); setInbox([])
      return
    }
    setLoading(true)
    try {
      const [n, p, s, i] = await Promise.all([
        api.getMasonNotes(token),
        api.getMasonPrefs(token),
        api.getMasonSavedProducts(token),
        api.getInbox(token).catch(() => [] as InboxMessage[]),
      ])
      setNotes(n); setPrefs({ ...EMPTY_PREFS, ...p }); setSavedProducts(s); setInbox(i)
    } catch (e) {
      console.error('[useMasonMemory] refresh failed', e)
    } finally {
      setLoading(false)
    }
  }, [token])

  const refreshInbox = useCallback(async () => {
    if (!token) { setInbox([]); return }
    try {
      const i = await api.getInbox(token)
      setInbox(i)
    } catch (e) {
      console.error('[useMasonMemory] inbox refresh failed', e)
    }
  }, [token])

  useEffect(() => { refresh() }, [refresh])

  const addNote = useCallback(async (text: string) => {
    if (!token) return
    const t = text.trim()
    if (!t) return
    const note = await api.addMasonNote(t, token)
    setNotes(prev => [note, ...prev.filter(n => n.key !== note.key)])
  }, [token])

  const removeNote = useCallback(async (key: string) => {
    if (!token) return
    await api.deleteMasonNote(key, token)
    setNotes(prev => prev.filter(n => n.key !== key))
  }, [token])

  // Pref edits are debounced so rapid slider drags / chip adds don't hit the
  // API on every event. Patches accumulate; JSONB keys are shallow-merged so
  // sub-fields like sizes.shirt don't clobber sizes.shoe.
  const pendingPatchRef = useRef<MasonPrefsPatch>({})
  const prefTimerRef = useRef<number | null>(null)
  const patchPrefs = useCallback((patch: MasonPrefsPatch) => {
    // Optimistic local update with the same shallow-merge rule we use server-side.
    setPrefs(prev => {
      const next = { ...prev } as MasonPrefs
      for (const k of Object.keys(patch) as Array<keyof MasonPrefs>) {
        const v = patch[k]
        if (JSONB_KEYS.includes(k) && v && typeof v === 'object' && !Array.isArray(v)) {
          ;(next as unknown as Record<string, unknown>)[k] = { ...(prev[k] as object), ...(v as object) }
        } else {
          ;(next as unknown as Record<string, unknown>)[k] = v as unknown
        }
      }
      return next
    })
    // Merge into pending payload (same shallow-merge for JSONB fields).
    for (const k of Object.keys(patch) as Array<keyof MasonPrefs>) {
      const v = patch[k]
      if (JSONB_KEYS.includes(k) && v && typeof v === 'object' && !Array.isArray(v)) {
        const prev = (pendingPatchRef.current[k] as object | undefined) ?? {}
        ;(pendingPatchRef.current as unknown as Record<string, unknown>)[k] = { ...prev, ...(v as object) }
      } else {
        ;(pendingPatchRef.current as unknown as Record<string, unknown>)[k] = v as unknown
      }
    }
    if (prefTimerRef.current != null) window.clearTimeout(prefTimerRef.current)
    if (!token) return
    prefTimerRef.current = window.setTimeout(async () => {
      const payload = pendingPatchRef.current
      pendingPatchRef.current = {}
      prefTimerRef.current = null
      try {
        const next = await api.updateMasonPrefs(payload, token)
        setPrefs({ ...EMPTY_PREFS, ...next })
      } catch (e) {
        console.error('[useMasonMemory] prefs save failed', e)
      }
    }, 500)
  }, [token])

  useEffect(() => () => {
    if (prefTimerRef.current != null) window.clearTimeout(prefTimerRef.current)
  }, [])

  const saveProduct = useCallback(async (product: { product_id: number; name: string; price: number; image_url: string | null; shop_id: number; shop_name: string | null; quantity: number }) => {
    if (!token) return
    await api.saveMasonProduct(product.product_id, token)
    setSavedProducts(prev => {
      if (prev.some(p => p.product_id === product.product_id)) return prev
      return [{
        product_id: product.product_id,
        name: product.name,
        price: product.price,
        quantity: product.quantity,
        image_url: product.image_url,
        shop_id: product.shop_id,
        shop_name: product.shop_name,
        saved_at: new Date().toISOString(),
      }, ...prev]
    })
  }, [token])

  const unsaveProduct = useCallback(async (productId: number) => {
    if (!token) return
    await api.unsaveMasonProduct(productId, token)
    setSavedProducts(prev => prev.filter(p => p.product_id !== productId))
  }, [token])

  return { notes, prefs, savedProducts, inbox, loading, addNote, removeNote, patchPrefs, saveProduct, unsaveProduct, refresh, refreshInbox }
}
