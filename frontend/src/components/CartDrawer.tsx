import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useCart } from '../cart/CartContext'
import styles from './CartDrawer.module.css'

export default function CartDrawer() {
  const { isOpen, close, items, total, setQuantity, removeItem, checkout } = useCart()
  const [busy, setBusy] = useState(false)
  const [pendingId, setPendingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, close])

  useEffect(() => { if (!isOpen) setError(null) }, [isOpen])

  if (!isOpen) return null

  const onPurchase = async () => {
    if (!items.length) return
    setBusy(true)
    try {
      const url = await checkout()
      if (url) window.open(url, '_blank', 'noopener,noreferrer')
      close()
    } finally {
      setBusy(false)
    }
  }

  const onSetQty = async (productId: number, qty: number) => {
    setError(null)
    setPendingId(productId)
    try {
      const res = await setQuantity(productId, qty)
      if (!res.ok && res.error) setError(res.error)
    } finally {
      setPendingId(null)
    }
  }

  const onRemove = async (productId: number) => {
    setError(null)
    setPendingId(productId)
    try {
      const res = await removeItem(productId)
      if (!res.ok && res.error) setError(res.error)
    } finally {
      setPendingId(null)
    }
  }

  return createPortal(
    <>
      <div className={styles.backdrop} onClick={close} aria-hidden="true" />
      <aside className={styles.panel} role="dialog" aria-label="Shopping cart">
        <div className={styles.header}>
          <h2 className={styles.title}>Your Cart</h2>
          <button className={styles.closeBtn} onClick={close} aria-label="Close cart">×</button>
        </div>
        <div className={styles.body}>
          {error && (
            <div className={styles.errorBanner} role="alert">{error}</div>
          )}
          {items.length === 0 ? (
            <div className={styles.empty}>Your cart is empty.</div>
          ) : items.map(it => {
            const rowBusy = busy || pendingId === it.product_id
            return (
            <div key={it.product_id} className={styles.item}>
              <div className={styles.thumb}>
                {it.image_url
                  ? <img src={it.image_url} alt={it.name} />
                  : <span className={styles.thumbPh}>🛍️</span>}
              </div>
              <div className={styles.itemBody}>
                <p className={styles.itemName}>{it.name}</p>
                {it.shop_name && <p className={styles.itemShop}>{it.shop_name}</p>}
                <div className={styles.qtyRow}>
                  <button
                    className={styles.qtyBtn}
                    onClick={() => onSetQty(it.product_id, it.quantity - 1)}
                    aria-label="Decrease quantity"
                    disabled={rowBusy}
                  >−</button>
                  <span className={styles.qty}>{it.quantity}</span>
                  <button
                    className={styles.qtyBtn}
                    onClick={() => onSetQty(it.product_id, it.quantity + 1)}
                    aria-label="Increase quantity"
                    disabled={rowBusy}
                  >+</button>
                </div>
              </div>
              <div className={styles.itemRight}>
                <span className={styles.itemPrice}>${it.subtotal.toFixed(2)}</span>
                <button
                  className={styles.removeBtn}
                  onClick={() => onRemove(it.product_id)}
                  disabled={rowBusy}
                >{pendingId === it.product_id ? 'Removing…' : 'Remove'}</button>
              </div>
            </div>
            )
          })}
        </div>
        <div className={styles.footer}>
          <div className={styles.totalRow}>
            <span className={styles.totalLabel}>Total</span>
            <span className={styles.totalValue}>${total.toFixed(2)}</span>
          </div>
          <button
            className={styles.purchaseBtn}
            onClick={onPurchase}
            disabled={busy || items.length === 0}
          >
            {busy ? 'Processing…' : 'Purchase'}
          </button>
        </div>
      </aside>
    </>,
    document.body,
  )
}
