import { useEffect, useMemo, useRef, useState } from 'react'
import styles from './Cards.module.css'
import { IntentHandler } from '../a2ui/types'
import { formatCurrency } from '../lib/format'
import { normalizeTags } from '../lib/normalizeTags'
import { useVariantSelector } from '../hooks/useVariantSelector'
import { useAddToCart } from '../hooks/useAddToCart'
import { useMemory } from '../mason/MemoryContext'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

interface VariantOption {
  variant_id: number
  option_names?: string[]
  option_values?: string[]
  variant_label?: string | null
  price: number
  quantity: number
  image_url?: string | null
}

export interface ShuffleSimilarProduct {
  product_id: number
  name: string
  price: number
  image_url?: string | null
  shop_name: string
}

interface Props {
  product_id: number
  name: string
  price: number
  quantity?: number
  image_url?: string
  shop_name: string
  shop_id?: number
  description_summary?: string
  tags?: string[]
  onIntent?: IntentHandler
  layout?: 'default' | 'grid' | 'hero' | 'compact' | 'options'
  showAddToCart?: boolean
  // Variant support — when the agent returns a parent product, it passes
  // the full variant list plus a display mode. variant mode preselects one
  // variant; parent mode leaves the default selected.
  variants?: VariantOption[]
  display_mode?: 'parent' | 'variant'
  preselected_variant_id?: number
  default_variant_id?: number
  // When true, hide the option chips and lock the displayed variant.
  lockVariant?: boolean
  // Shuffle callback — returns 6 similar products to display
  onShuffle?: () => ShuffleSimilarProduct[]
}

export default function ProductCard(props: Props) {
  const memory = useMemory()
  const { token } = useAuth()
  const navigate = useNavigate()
  const [boardPickerOpen, setBoardPickerOpen] = useState(false)
  const [saveBusy, setSaveBusy] = useState(false)
  const saveWrapRef = useRef<HTMLDivElement>(null)

  const isLiked = memory?.savedProducts.some(p => p.product_id === props.product_id) ?? false
  const boards = memory?.boards ?? []

  useEffect(() => {
    if (!boardPickerOpen) return
    const handler = (e: MouseEvent) => {
      if (saveWrapRef.current && !saveWrapRef.current.contains(e.target as Node)) {
        setBoardPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [boardPickerOpen])

  const variants = props.variants ?? []
  const hasVariants = variants.length > 1
  const initialVariantId = useMemo(() => {
    if (props.preselected_variant_id != null) return props.preselected_variant_id
    if (props.default_variant_id != null) return props.default_variant_id
    return variants[0]?.variant_id
  }, [props.preselected_variant_id, props.default_variant_id, variants])

  const variantSelector = useVariantSelector(variants, initialVariantId)
  const {
    selectedVariantId: selectedId,
    selectedVariant: selected,
    optionAxes,
    selectedValues,
    pickValue,
    setSelectedVariantId: setSelectedId,
    isReachable,
  } = variantSelector

  // The displayed price/qty/image come from the selected variant when one
  // is set; otherwise we fall back to the parent-level props that the
  // agent or admin list passed in.
  const displayPrice = selected ? selected.price : props.price
  const displayQty = selected ? selected.quantity : props.quantity
  const displayImage = selected?.image_url ?? props.image_url

  const qty =
    displayQty === undefined || displayQty === null
      ? null
      : Number(displayQty)
  const inStock = qty === null || !Number.isFinite(qty) ? true : qty > 0
  const showAddToCart = props.showAddToCart ?? false
  const clickable = Boolean(props.onIntent)
  const { add, busy, added, error: errorMsg } = useAddToCart({ successMs: 1200 })
  const [shuffleProducts, setShuffleProducts] = useState<ShuffleSimilarProduct[] | null>(null)

  const showOptions = hasVariants && !props.lockVariant

  const isHero = props.layout === 'hero'
  const isCompact = props.layout === 'compact'
  const isOptions = props.layout === 'options'
  const isGrid = props.layout === 'grid' || isHero || isOptions

  const onAdd = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await add(
      selectedId != null
        ? { variantId: selectedId }
        : { productId: props.product_id },
    )
  }

  const onSaveClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!token) { navigate('/login'); return }
    if (!boardPickerOpen && boards.length === 0) {
      await memory?.refresh()
    }
    setBoardPickerOpen(v => !v)
  }

  const onSaveToBoard = async (boardId: number) => {
    if (saveBusy) return
    setBoardPickerOpen(false)
    setSaveBusy(true)
    try {
      const qty = typeof props.quantity === 'number' ? props.quantity : 0
      await memory?.addProductToBoard(boardId, {
        product_id: props.product_id,
        name: props.name,
        price: props.price,
        image_url: props.image_url ?? null,
        shop_id: props.shop_id ?? 0,
        shop_name: props.shop_name ?? null,
        quantity: qty,
      })
    } finally {
      setSaveBusy(false)
    }
  }

  const onShuffleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (shuffleProducts) { setShuffleProducts(null); return }
    if (props.onShuffle) setShuffleProducts(props.onShuffle())
  }

  const variantLabel = (v: VariantOption): string =>
    (v.option_values && v.option_values.length > 0)
      ? v.option_values.join(' / ')
      : (v.variant_label ?? `Variant ${v.variant_id}`)

  return (
    <div
      className={`${styles.productCard} ${isGrid ? styles.productCardGrid : ''} ${isHero ? styles.productCardHero : ''} ${isCompact ? styles.productCardCompact : ''} ${isOptions ? styles.productCardOptions : ''}`}
      style={clickable ? { cursor: 'pointer' } : undefined}
      onClick={clickable ? () => props.onIntent?.('open_details', { product_id: props.product_id, name: props.name }) : undefined}
    >
      <div className={`${styles.productImage} ${isGrid ? styles.productImageGrid : ''}`}>
        {displayImage
          ? <img src={displayImage} alt={props.name} />
          : <div className={styles.imagePlaceholder}>🛍️</div>
        }
      </div>
      <div className={styles.productBody}>
        <div className={styles.shopBadge}>{props.shop_name}</div>
        <h3 className={`${styles.productName} ${isGrid ? styles.productNameGrid : ''}`}>{props.name}</h3>
        {props.description_summary && (
          <p className={styles.productDesc}>{props.description_summary}</p>
        )}
        {normalizeTags(props.tags).length > 0 && (
          <div className={styles.tags}>
            {normalizeTags(props.tags).slice(0, 4).map(t => <span key={t} className={styles.tag}>{t}</span>)}
          </div>
        )}
        {showOptions && optionAxes.length > 0 && (
          <div className={styles.optionsBlock} onClick={(e) => e.stopPropagation()}>
            {optionAxes.map(axis => (
              <div key={axis.name} className={styles.optionGroup}>
                <label className={styles.optionGroupLabel} htmlFor={`opt-${props.product_id}-${axis.name}`}>
                  {axis.name}
                </label>
                <select
                  id={`opt-${props.product_id}-${axis.name}`}
                  className={styles.optionSelect}
                  value={selectedValues[axis.name] ?? ''}
                  onChange={(e) => pickValue(axis.name, e.target.value)}
                >
                  {axis.values.map(val => {
                    const reachable = isReachable(axis.name, val)
                    return (
                      <option key={val} value={val}>
                        {reachable ? val : `${val} (unavailable)`}
                      </option>
                    )
                  })}
                </select>
              </div>
            ))}
          </div>
        )}
        {showOptions && optionAxes.length === 0 && (
          <div className={styles.optionsBlock} onClick={(e) => e.stopPropagation()}>
            <div className={styles.optionGroup}>
              <label className={styles.optionGroupLabel} htmlFor={`opt-${props.product_id}-variant`}>
                Variant
              </label>
              <select
                id={`opt-${props.product_id}-variant`}
                className={styles.optionSelect}
                value={selectedId ?? ''}
                onChange={(e) => setSelectedId(Number(e.target.value))}
              >
                {variants.map(v => (
                  <option key={v.variant_id} value={v.variant_id}>
                    {variantLabel(v)}{v.quantity <= 0 ? ' (out of stock)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
        <div className={styles.productFooter}>
          <span className={`${styles.price} ${isGrid ? styles.priceGrid : ''}`}>{formatCurrency(displayPrice)}</span>
          {qty !== null && Number.isFinite(qty) && (
            <span className={`${styles.stock} ${inStock ? styles.inStock : styles.outOfStock}`}>
              {inStock ? `${qty} in stock` : 'Out of stock'}
            </span>
          )}
        </div>
        {showAddToCart && (
          <>
            <div className={styles.cardActions}>
              <button
                type="button"
                className={styles.addBtn}
                onClick={onAdd}
                disabled={!inStock || busy}
              >
                {added ? 'Added ✓' : inStock ? 'Add to cart' : 'Out of stock'}
              </button>
              <div className={styles.saveWrap} ref={saveWrapRef}>
                <button
                  type="button"
                  className={`${styles.iconBtn} ${isLiked ? styles.liked : ''}`}
                  onClick={onSaveClick}
                  aria-label="Save to board"
                  aria-pressed={isLiked}
                  disabled={saveBusy}
                >
                  {isLiked ? '♥' : '♡'}
                </button>
                {boardPickerOpen && (
                  <div className={styles.boardPicker}>
                    <div className={styles.boardPickerTitle}>Save to board</div>
                    {memory?.loading ? (
                      <p className={styles.boardPickerEmpty}>Loading…</p>
                    ) : boards.length === 0 ? (
                      <p className={styles.boardPickerEmpty}>No boards yet</p>
                    ) : (
                      boards.map(b => (
                        <button
                          key={b.id}
                          type="button"
                          className={styles.boardPickerItem}
                          onClick={(e) => { e.stopPropagation(); onSaveToBoard(b.id) }}
                        >
                          {b.name}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
              {props.onShuffle && (
                <button
                  type="button"
                  className={`${styles.shuffleBtn} ${shuffleProducts ? styles.shuffleActive : ''}`}
                  onClick={onShuffleClick}
                  aria-label="Show similar"
                  title="Show 6 similar items"
                >
                  ⇄
                </button>
              )}
            </div>
            {errorMsg && <p className={styles.addError} role="alert">{errorMsg}</p>}
            {shuffleProducts && shuffleProducts.length > 0 && (
              <div className={styles.shufflePanel} onClick={e => e.stopPropagation()}>
                <div className={styles.shufflePanelTitle}>Similar items</div>
                <div className={styles.shuffleGrid}>
                  {shuffleProducts.map(p => (
                    <div key={p.product_id} className={styles.shuffleItem}>
                      <div className={styles.shuffleImg}>
                        {p.image_url
                          ? <img src={p.image_url} alt={p.name} />
                          : <span>🛍️</span>}
                      </div>
                      <div className={styles.shuffleInfo}>
                        <div className={styles.shuffleName}>{p.name}</div>
                        <div className={styles.shufflePrice}>{formatCurrency(p.price)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
