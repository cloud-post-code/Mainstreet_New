import { useCallback, useEffect, useRef, useState } from 'react'
import { api, MasonNote, MasonPrefs, MasonSavedProduct } from '../api'

const EMPTY_PREFS: MasonPrefs = { sizes: '', budget: '', likes: '', dislikes: '' }

export interface MasonMemory {
  notes: MasonNote[]
  prefs: MasonPrefs
  savedProducts: MasonSavedProduct[]
  loading: boolean
  addNote: (text: string) => Promise<void>
  removeNote: (key: string) => Promise<void>
  setPref: (field: keyof MasonPrefs, value: string) => void
  unsaveProduct: (productId: number) => Promise<void>
  refresh: () => Promise<void>
}

// One hook that owns the three Mason memory resources. Gated on token —
// signed-out users get empty data and a no-op refresh so the panel can
// fall back to a sign-in prompt without crashing.
export function useMasonMemory(token: string | null): MasonMemory {
  const [notes, setNotes] = useState<MasonNote[]>([])
  const [prefs, setPrefs] = useState<MasonPrefs>(EMPTY_PREFS)
  const [savedProducts, setSavedProducts] = useState<MasonSavedProduct[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!token) {
      setNotes([]); setPrefs(EMPTY_PREFS); setSavedProducts([])
      return
    }
    setLoading(true)
    try {
      const [n, p, s] = await Promise.all([
        api.getMasonNotes(token),
        api.getMasonPrefs(token),
        api.getMasonSavedProducts(token),
      ])
      setNotes(n); setPrefs(p); setSavedProducts(s)
    } catch (e) {
      // 401 is handled globally by api.request; swallow other errors so the
      // panel doesn't break the chat experience.
      console.error('[useMasonMemory] refresh failed', e)
    } finally {
      setLoading(false)
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

  // Pref edits are debounced per field so each keystroke doesn't hit the API.
  const pendingPrefRef = useRef<Partial<MasonPrefs>>({})
  const prefTimerRef = useRef<number | null>(null)
  const setPref = useCallback((field: keyof MasonPrefs, value: string) => {
    setPrefs(prev => ({ ...prev, [field]: value }))
    pendingPrefRef.current[field] = value
    if (prefTimerRef.current != null) window.clearTimeout(prefTimerRef.current)
    if (!token) return
    prefTimerRef.current = window.setTimeout(async () => {
      const patch = pendingPrefRef.current
      pendingPrefRef.current = {}
      prefTimerRef.current = null
      try {
        const next = await api.updateMasonPrefs(patch, token)
        setPrefs(next)
      } catch (e) {
        console.error('[useMasonMemory] prefs save failed', e)
      }
    }, 500)
  }, [token])

  useEffect(() => () => {
    if (prefTimerRef.current != null) window.clearTimeout(prefTimerRef.current)
  }, [])

  const unsaveProduct = useCallback(async (productId: number) => {
    if (!token) return
    await api.unsaveMasonProduct(productId, token)
    setSavedProducts(prev => prev.filter(p => p.product_id !== productId))
  }, [token])

  return { notes, prefs, savedProducts, loading, addNote, removeNote, setPref, unsaveProduct, refresh }
}
