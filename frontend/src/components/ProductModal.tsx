import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useCart } from '../cart/CartContext'
import { useAuth } from '../hooks/useAuth'
import { MasonMemory } from '../mason/useMasonMemory'
import styles from './ProductModal.module.css'

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

  const qty = product.quantity == null ? null : Number(product.quantity)
  const inStock = qty === null || !Number.isFinite(qty) ? true : qty > 0
  const isLiked = memory.savedProducts.some(p => p.product_id === product.product_id)
  const description = product.description_long ?? product.description_summary ?? ''

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
    const res = await cart.addItem(product.product_id, 1)
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
            {product.image_url
              ? <img src={product.image_url} alt={product.name} />
              : <span className={styles.imagePh}>🛍️</span>}
          </div>
          <div className={styles.info}>
            <div className={styles.shop}>{product.shop_name}</div>
            <h2 className={styles.name}>{product.name}</h2>
            <div className={styles.priceRow}>
              <span className={styles.price}>${Number(product.price).toFixed(2)}</span>
              {qty !== null && Number.isFinite(qty) && (
                <span className={`${styles.stock} ${inStock ? styles.inStock : styles.outOfStock}`}>
                  {inStock ? `${qty} in stock` : 'Out of stock'}
                </span>
              )}
            </div>
            {description && <p className={styles.desc}>{description}</p>}
            {product.tags && product.tags.length > 0 && (
              <div className={styles.tags}>
                {product.tags.map(t => <span key={t} className={styles.tag}>{t}</span>)}
              </div>
            )}
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
