import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useCart } from '../cart/CartContext'
import { useAuth } from '../hooks/useAuth'
import { MasonMemory } from '../mason/useMasonMemory'
import styles from './ProductModal.module.css'
import cardStyles from './Cards.module.css'

export interface ProductModalVariant {
  variant_id: number
  option_names?: string[]
  option_values?: string[]
  variant_label?: string | null
  price: number
  quantity: number
  image_url?: string | null
}

export interface ProductModalData {
  product_id: number
  name: string
  price: number
  quantity?: number
  image_url?: string | null
  shop_id?: number
  shop_name: string
  description_summary?: string
  description_long?: string
  tags?: string[]
  variants?: ProductModalVariant[]
  default_variant_id?: number
}

interface Props {
  product: ProductModalData
  memory: MasonMemory
  onClose: () => void
  onChatAbout: (name: string) => void
}

export default function ProductModal({ product, memory, onClose, onChatAbout }: Props) {
  const cart = useCart()
  const { token } = useAuth()
  const navigate = useNavigate()
  const [addStatus, setAddStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [addError, setAddError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [likeBusy, setLikeBusy] = useState(false)

  const variants = product.variants ?? []
  const hasVariants = variants.length > 1
  const initialVariantId =
    product.default_variant_id ?? variants[0]?.variant_id
  const [selectedVariantId, setSelectedVariantId] = useState<number | undefined>(initialVariantId)
  const selectedVariant = variants.find(v => v.variant_id === selectedVariantId)

  const displayPrice = selectedVariant ? selectedVariant.price : product.price
  const displayImage = selectedVariant?.image_url ?? product.image_url
  const displayQty = selectedVariant ? selectedVariant.quantity : product.quantity
  const qty = displayQty == null ? null : Number(displayQty)
  const inStock = qty === null || !Number.isFinite(qty) ? true : qty > 0
  const isLiked = memory.savedProducts.some(p => p.product_id === product.product_id)
  const description = product.description_long ?? product.description_summary ?? ''

  const optionAxes = useMemo(() => {
    const axes: { name: string; values: string[] }[] = []
    const seen = new Map<string, Set<string>>()
    for (const v of variants) {
      const names = v.option_names ?? []
      const values = v.option_values ?? []
      for (let i = 0; i < names.length; i++) {
        const n = names[i]; const val = values[i]
        if (!n || val == null) continue
        if (!seen.has(n)) { seen.set(n, new Set()); axes.push({ name: n, values: [] }) }
        const set = seen.get(n)!
        if (!set.has(val)) { set.add(val); axes.find(a => a.name === n)!.values.push(val) }
      }
    }
    return axes
  }, [variants])

  const selectedValues: Record<string, string | undefined> = {}
  if (selectedVariant) {
    const names = selectedVariant.option_names ?? []
    const values = selectedVariant.option_values ?? []
    for (let i = 0; i < names.length; i++) selectedValues[names[i]] = values[i]
  }
  const pickValue = (axisName: string, value: string) => {
    const target = { ...selectedValues, [axisName]: value }
    let match = variants.find(v => {
      const names = v.option_names ?? []; const values = v.option_values ?? []
      return Object.entries(target).every(([n, val]) => {
        const idx = names.indexOf(n)
        return idx >= 0 && values[idx] === val
      })
    })
    if (!match) {
      match = variants.find(v => {
        const names = v.option_names ?? []; const values = v.option_values ?? []
        const idx = names.indexOf(axisName)
        return idx >= 0 && values[idx] === value
      })
    }
    if (match) setSelectedVariantId(match.variant_id)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 1800)
    return () => clearTimeout(t)
  }, [toast])

  const onAdd = async () => {
    if (!token) { navigate('/login'); return }
    setAddStatus('loading')
    setAddError(null)
    const res = await cart.addItem(
      selectedVariantId != null
        ? { variantId: selectedVariantId, quantity: 1 }
        : { productId: product.product_id, quantity: 1 },
    )
    if (res.ok) {
      setAddStatus('success')
      setTimeout(() => setAddStatus('idle'), 1500)
    } else {
      setAddStatus('error')
      setAddError(res.error ?? 'Could not add to cart')
      setTimeout(() => { setAddStatus('idle'); setAddError(null) }, 3500)
    }
  }

  const onLike = async () => {
    if (!token) { navigate('/login'); return }
    if (likeBusy) return
    setLikeBusy(true)
    try {
      if (isLiked) {
        await memory.unsaveProduct(product.product_id)
        setToast('Removed from saved')
      } else {
        await memory.saveProduct({
          product_id: product.product_id,
          name: product.name,
          price: product.price,
          image_url: product.image_url ?? null,
          shop_id: product.shop_id ?? 0,
          shop_name: product.shop_name ?? null,
          quantity: qty ?? 0,
        })
        setToast('Saved to your likes')
      }
    } catch {
      setToast('Could not update')
    } finally {
      setLikeBusy(false)
    }
  }

  const onShare = async () => {
    const url = `${window.location.origin}/products/${product.product_id}`
    const shareData = { title: product.name, text: `${product.name} — ${product.shop_name}`, url }
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share(shareData)
        return
      } catch {
        // user dismissed or failed — fall through to copy
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      setToast('Link copied')
    } catch {
      setToast('Could not share')
    }
  }

  const onChat = () => {
    onChatAbout(product.name)
    onClose()
  }

  const added = addStatus === 'success'
  const busy = addStatus === 'loading'

  return createPortal(
    <div className={styles.backdrop} onClick={onClose} role="presentation">
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={product.name}
        onClick={e => e.stopPropagation()}
      >
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
        <div className={styles.body}>
          <div className={styles.imageWrap}>
            {displayImage
              ? <img src={displayImage} alt={product.name} />
              : <span className={styles.imagePh}>🛍️</span>}
          </div>
          <div className={styles.info}>
            <div className={styles.shop}>{product.shop_name}</div>
            <h2 className={styles.name}>{product.name}</h2>
            <div className={styles.priceRow}>
              <span className={styles.price}>${Number(displayPrice).toFixed(2)}</span>
              {qty !== null && Number.isFinite(qty) && (
                <span className={`${styles.stock} ${inStock ? styles.inStock : styles.outOfStock}`}>
                  {inStock ? `${qty} in stock` : 'Out of stock'}
                </span>
              )}
            </div>
            {hasVariants && optionAxes.length > 0 && (
              <section className={styles.section}>
                <h3 className={styles.sectionTitle}>Options</h3>
                <div className={cardStyles.optionsBlock}>
                  {optionAxes.map(axis => (
                    <div key={axis.name} className={cardStyles.optionGroup}>
                      <span className={cardStyles.optionGroupLabel}>{axis.name}</span>
                      <div className={cardStyles.optionChips}>
                        {axis.values.map(val => {
                          const active = selectedValues[axis.name] === val
                          return (
                            <button
                              key={val}
                              type="button"
                              className={`${cardStyles.optionChip} ${active ? cardStyles.optionChipActive : ''}`}
                              onClick={() => pickValue(axis.name, val)}
                              aria-pressed={active}
                            >
                              {val}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Description</h3>
              {description
                ? <p className={styles.desc}>{description}</p>
                : <p className={styles.descEmpty}>No description provided yet.</p>}
            </section>
            {product.tags && product.tags.length > 0 && (
              <div className={styles.tags}>
                {product.tags.map(t => <span key={t} className={styles.tag}>{t}</span>)}
              </div>
            )}
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Reviews</h3>
              <p className={styles.descEmpty}>No reviews yet.</p>
            </section>
            <div className={styles.actionRow}>
              <button
                type="button"
                className={styles.addBtn}
                onClick={onAdd}
                disabled={!inStock || busy}
              >
                {added ? 'Added ✓' : inStock ? 'Add to cart' : 'Out of stock'}
              </button>
              <button
                type="button"
                className={`${styles.iconBtn} ${isLiked ? styles.liked : ''}`}
                onClick={onLike}
                aria-label={isLiked ? 'Unlike' : 'Like'}
                aria-pressed={isLiked}
                disabled={likeBusy}
              >
                {isLiked ? '♥' : '♡'}
              </button>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={onShare}
                aria-label="Share"
              >
                ↗
              </button>
            </div>
            {addError && <p className={styles.errorMsg} role="alert">{addError}</p>}
            <button type="button" className={styles.chatBtn} onClick={onChat}>
              Chat about it
            </button>
          </div>
        </div>
        {toast && <div className={styles.toast}>{toast}</div>}
      </div>
    </div>,
    document.body,
  )
}
