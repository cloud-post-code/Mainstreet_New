import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useCart } from '../cart/CartContext'
import { useAuth } from '../hooks/useAuth'
import { api, ShippingAddress } from '../api'
import styles from './CartDrawer.module.css'
import { formatCurrency } from '../lib/format'
import { useModalDismiss } from '../hooks/useModalDismiss'

const EMPTY_SHIPPING: ShippingAddress = {
  name: '', line1: '', line2: '', city: '', state: '', postal_code: '', country: '', phone: '',
}

const hasShipping = (s: ShippingAddress) => !!(s.line1 || s.city || s.postal_code)

export default function CartDrawer() {
  const { isOpen, close, items, total, setQuantity, removeItem, checkout } = useCart()
  const { token } = useAuth()
  const [busy, setBusy] = useState(false)
  const [pendingId, setPendingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [shipping, setShipping] = useState<ShippingAddress>(EMPTY_SHIPPING)
  const [hasDefault, setHasDefault] = useState(false)
  const [addrOpen, setAddrOpen] = useState(false)

  useModalDismiss(isOpen, close)

  useEffect(() => { if (!isOpen) setError(null) }, [isOpen])

  useEffect(() => {
    if (!isOpen || !token) return
    let cancelled = false
    api.getMasonShipping(token)
      .then(s => {
        if (cancelled) return
        const merged = { ...EMPTY_SHIPPING, ...s }
        setShipping(merged)
        setHasDefault(hasShipping(merged))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [isOpen, token])

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

  const onSetQty = async (variantId: number, qty: number) => {
    setError(null)
    setPendingId(variantId)
    try {
      const res = await setQuantity(variantId, qty)
      if (!res.ok && res.error) setError(res.error)
    } finally {
      setPendingId(null)
    }
  }

  const onRemove = async (variantId: number) => {
    setError(null)
    setPendingId(variantId)
    try {
      const res = await removeItem(variantId)
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
          <ShippingSummary
            shipping={shipping}
            onEdit={() => setAddrOpen(true)}
          />
          {items.length === 0 ? (
            <div className={styles.empty}>Your cart is empty.</div>
          ) : items.map(it => {
            const rowBusy = busy || pendingId === it.variant_id
            const variantText = it.option_values && it.option_values.length > 0
              ? it.option_values.join(' / ')
              : null
            return (
            <div key={it.variant_id} className={styles.item}>
              <div className={styles.thumb}>
                {it.image_url
                  ? <img src={it.image_url} alt={it.name} />
                  : <span className={styles.thumbPh}>🛍️</span>}
              </div>
              <div className={styles.itemBody}>
                <p className={styles.itemName}>{it.name}</p>
                {variantText && <p className={styles.itemShop}>{variantText}</p>}
                {it.parent_store && <p className={styles.itemShop}>{it.parent_store}</p>}
                {it.shop_name && <p className={styles.itemShop}>{it.shop_name}</p>}
                <div className={styles.qtyRow}>
                  <button
                    className={styles.qtyBtn}
                    onClick={() => onSetQty(it.variant_id, it.quantity - 1)}
                    aria-label="Decrease quantity"
                    disabled={rowBusy}
                  >−</button>
                  <span className={styles.qty}>{it.quantity}</span>
                  <button
                    className={styles.qtyBtn}
                    onClick={() => onSetQty(it.variant_id, it.quantity + 1)}
                    aria-label="Increase quantity"
                    disabled={rowBusy}
                  >+</button>
                </div>
              </div>
              <div className={styles.itemRight}>
                <span className={styles.itemPrice}>{formatCurrency(it.subtotal)}</span>
                <button
                  className={styles.removeBtn}
                  onClick={() => onRemove(it.variant_id)}
                  disabled={rowBusy}
                >{pendingId === it.variant_id ? 'Removing…' : 'Remove'}</button>
              </div>
            </div>
            )
          })}
        </div>
        <div className={styles.footer}>
          <div className={styles.totalRow}>
            <span className={styles.totalLabel}>Total</span>
            <span className={styles.totalValue}>{formatCurrency(total)}</span>
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
      {addrOpen && (
        <AddressModal
          initial={shipping}
          persist={!hasDefault}
          onClose={() => setAddrOpen(false)}
          onSave={async (addr) => {
            setShipping(addr)
            if (!hasDefault && token) {
              try {
                const saved = await api.updateMasonShipping(addr, token)
                const merged = { ...EMPTY_SHIPPING, ...saved }
                setShipping(merged)
                setHasDefault(hasShipping(merged))
              } catch {
                // keep local state even if persist fails
              }
            }
            setAddrOpen(false)
          }}
        />
      )}
    </>,
    document.body,
  )
}

function AddressModal({
  initial,
  persist,
  onClose,
  onSave,
}: {
  initial: ShippingAddress
  persist: boolean
  onClose: () => void
  onSave: (addr: ShippingAddress) => void | Promise<void>
}) {
  const [addr, setAddr] = useState<ShippingAddress>(initial)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const set = (k: keyof ShippingAddress) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setAddr(prev => ({ ...prev, [k]: e.target.value }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try { await onSave(addr) } finally { setSaving(false) }
  }

  return (
    <>
      <div className={styles.modalBackdrop} onClick={onClose} aria-hidden="true" />
      <div className={styles.modal} role="dialog" aria-label="Shipping address">
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>
            {persist ? 'Add shipping address' : 'Edit shipping address'}
          </h3>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </div>
        <form className={styles.modalBody} onSubmit={submit}>
          <label className={styles.field}>
            <span>Full name</span>
            <input value={addr.name} onChange={set('name')} autoFocus />
          </label>
          <label className={styles.field}>
            <span>Address line 1</span>
            <input value={addr.line1} onChange={set('line1')} required />
          </label>
          <label className={styles.field}>
            <span>Address line 2</span>
            <input value={addr.line2} onChange={set('line2')} />
          </label>
          <div className={styles.fieldRow}>
            <label className={styles.field}>
              <span>City</span>
              <input value={addr.city} onChange={set('city')} required />
            </label>
            <label className={styles.field}>
              <span>State</span>
              <input value={addr.state} onChange={set('state')} />
            </label>
          </div>
          <div className={styles.fieldRow}>
            <label className={styles.field}>
              <span>Postal code</span>
              <input value={addr.postal_code} onChange={set('postal_code')} required />
            </label>
            <label className={styles.field}>
              <span>Country</span>
              <input value={addr.country} onChange={set('country')} />
            </label>
          </div>
          <label className={styles.field}>
            <span>Phone</span>
            <input value={addr.phone} onChange={set('phone')} />
          </label>
          {!persist && (
            <p className={styles.modalNote}>
              Updating for this order only — your saved default won't change.
            </p>
          )}
          <div className={styles.modalActions}>
            <button type="button" className={styles.btnSecondary} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={styles.btnPrimary} disabled={saving}>
              {saving ? 'Saving…' : persist ? 'Save as default' : 'Use for this order'}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}

function ShippingSummary({
  shipping,
  onEdit,
}: { shipping: ShippingAddress; onEdit: () => void }) {
  const hasAddress = !!(shipping.line1 || shipping.city || shipping.postal_code)
  const cityLine = [shipping.city, shipping.state, shipping.postal_code].filter(Boolean).join(', ')
  return (
    <div className={styles.shipBox}>
      <div className={styles.shipHead}>
        <span>Ship to</span>
        <button className={styles.shipEdit} onClick={onEdit}>
          {hasAddress ? 'Edit' : 'Add address'}
        </button>
      </div>
      {hasAddress ? (
        <>
          {shipping.name && <div className={styles.shipLine}>{shipping.name}</div>}
          <div className={styles.shipLine}>{shipping.line1}</div>
          {shipping.line2 && <div className={styles.shipLine}>{shipping.line2}</div>}
          {cityLine && <div className={styles.shipLine}>{cityLine}</div>}
          {shipping.country && <div className={styles.shipLine}>{shipping.country}</div>}
        </>
      ) : (
        <div className={styles.shipEmpty}>No shipping address saved.</div>
      )}
    </div>
  )
}
