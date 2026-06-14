import { useEffect, useRef, useState } from 'react'
import { useVariantSelector } from '../hooks/useVariantSelector'
import { useAddToCart } from '../hooks/useAddToCart'
import { useModalDismiss } from '../hooks/useModalDismiss'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { MasonMemory } from '../mason/useMasonMemory'
import { normalizeTags } from '../lib/normalizeTags'
import styles from './ProductModal.module.css'
import cardStyles from './Cards.module.css'
import { formatCurrency } from '../lib/format'

// Axis names that indicate a clothing/shoe size selection
const SIZE_AXIS_NAMES = new Set(['size', 'Size', 'sizes', 'Sizes', 'shoe size', 'Shoe Size'])

// Map a size axis name + selected value to the right MasonSizes field
function sizeAxisToField(axisName: string, value: string): { field: keyof import('../api').MasonSizes; value: string } | null {
  const lower = axisName.toLowerCase()
  if (lower.includes('shoe')) return { field: 'shoe', value }
  if (lower.includes('waist')) return { field: 'waist', value }
  if (lower.includes('inseam')) return { field: 'inseam', value }
  if (lower.includes('dress') || lower.includes('suit')) return { field: 'dress', value }
  if (lower === 'size' || lower === 'sizes') return { field: 'shirt', value }
  return null
}

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
  const { token } = useAuth()
  const navigate = useNavigate()
  const { add: addToCart, busy, added, error: addError } = useAddToCart()
  const [toast, setToast] = useState<string | null>(null)
  const [likeBusy, setLikeBusy] = useState(false)
  // Sizing capture: shown once after add-to-cart when a size option was selected
  const [sizeSavePrompt, setSizeSavePrompt] = useState<{ field: keyof import('../api').MasonSizes; value: string; label: string } | null>(null)
  const [fitNote, setFitNote] = useState('')
  const sizeSaveShown = useRef(false)

  const variants = product.variants ?? []
  const hasVariants = variants.length > 1
  const initialVariantId =
    product.default_variant_id ?? variants[0]?.variant_id
  const {
    selectedVariantId,
    selectedVariant,
    optionAxes,
    selectedValues,
    pickValue,
  } = useVariantSelector(variants, initialVariantId)

  const displayPrice = selectedVariant ? selectedVariant.price : product.price
  const displayImage = selectedVariant?.image_url ?? product.image_url
  const displayQty = selectedVariant ? selectedVariant.quantity : product.quantity
  const qty = displayQty == null ? null : Number(displayQty)
  const inStock = qty === null || !Number.isFinite(qty) ? true : qty > 0
  const isLiked = memory.savedProducts.some(p => p.product_id === product.product_id)
  const description = product.description_long ?? product.description_summary ?? ''

  useModalDismiss(true, onClose)

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 1800)
    return () => clearTimeout(t)
  }, [toast])

  const onAdd = async () => {
    await addToCart(
      selectedVariantId != null
        ? { variantId: selectedVariantId }
        : { productId: product.product_id },
    )
    // After adding, check if a size axis was selected and we don't have it saved
    if (!sizeSaveShown.current && optionAxes.length > 0) {
      for (const axis of optionAxes) {
        if (SIZE_AXIS_NAMES.has(axis.name)) {
          const chosen = selectedValues[axis.name]
          if (chosen) {
            const mapped = sizeAxisToField(axis.name, chosen)
            if (mapped && !memory.prefs.sizes[mapped.field]) {
              setSizeSavePrompt({ ...mapped, label: axis.name })
              sizeSaveShown.current = true
              break
            }
          }
        }
      }
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
              <span className={styles.price}>{formatCurrency(displayPrice)}</span>
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
            {(() => {
              const tagList = normalizeTags(product.tags);
              if (tagList.length === 0) return null;
              return (
                <div className={styles.tags}>
                  {tagList.map(t => <span key={t} className={styles.tag}>{t}</span>)}
                </div>
              );
            })()}
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Reviews</h3>
              <p className={styles.descEmpty}>No reviews yet.</p>
            </section>
            {sizeSavePrompt && (
              <div className={styles.sizeSaveBox}>
                <p className={styles.sizeSaveTitle}>
                  Save your {sizeSavePrompt.label.toLowerCase()} ({sizeSavePrompt.value}) to your profile?
                </p>
                <input
                  className={styles.sizeSaveInput}
                  placeholder="How do you like things to fit? (e.g. relaxed, true to size, size up) — optional"
                  value={fitNote}
                  onChange={e => setFitNote(e.target.value)}
                />
                <div className={styles.sizeSaveBtns}>
                  <button
                    type="button"
                    className={styles.sizeSaveYes}
                    onClick={() => {
                      const patch: import('../api').MasonPrefsPatch = {
                        sizes: { [sizeSavePrompt.field]: sizeSavePrompt.value } as import('../api').MasonSizes,
                      }
                      if (fitNote.trim()) {
                        patch.sizes = { ...patch.sizes, freeform: fitNote.trim() } as import('../api').MasonSizes
                      }
                      memory.patchPrefs(patch)
                      setSizeSavePrompt(null)
                      setToast('Size saved to your profile ✓')
                    }}
                  >
                    Save size
                  </button>
                  <button
                    type="button"
                    className={styles.sizeSaveNo}
                    onClick={() => setSizeSavePrompt(null)}
                  >
                    Skip
                  </button>
                </div>
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
