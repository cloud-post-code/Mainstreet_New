import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import styles from './Cards.module.css'
import { IntentHandler } from '../a2ui/types'
import { useCart } from '../cart/CartContext'
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
  layout?: 'default' | 'grid' | 'hero' | 'compact'
  showAddToCart?: boolean
  // Variant support — when the agent returns a parent product, it passes
  // the full variant list plus a display mode. variant mode pins one
  // variant card; parent mode renders a dropdown.
  variants?: VariantOption[]
  display_mode?: 'parent' | 'variant'
  preselected_variant_id?: number
  default_variant_id?: number
}

export default function ProductCard(props: Props) {
  const variants = props.variants ?? []
  const hasVariants = variants.length > 1
  const initialVariantId = useMemo(() => {
    if (props.preselected_variant_id != null) return props.preselected_variant_id
    if (props.default_variant_id != null) return props.default_variant_id
    return variants[0]?.variant_id
  }, [props.preselected_variant_id, props.default_variant_id, variants])

  const [selectedId, setSelectedId] = useState<number | undefined>(initialVariantId)
  const selected = variants.find(v => v.variant_id === selectedId)

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
  const cart = useCart()
  const { token } = useAuth()
  const navigate = useNavigate()
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // display_mode='variant' = single pinned variant; suppress the dropdown
  // even if multiple variants exist.
  const showVariantPicker = hasVariants && props.display_mode !== 'variant'

  const isHero = props.layout === 'hero'
  const isCompact = props.layout === 'compact'
  const isGrid = props.layout === 'grid' || isHero
  const busy = status === 'loading'
  const added = status === 'success'

  const onAdd = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!token) {
      navigate('/login')
      return
    }
    setStatus('loading')
    setErrorMsg(null)
    const res = await cart.addItem(
      selectedId != null
        ? { variantId: selectedId, quantity: 1 }
        : { productId: props.product_id, quantity: 1 },
    )
    if (res.ok) {
      setStatus('success')
      setTimeout(() => setStatus('idle'), 1200)
    } else {
      setStatus('error')
      setErrorMsg(res.error ?? null)
      setTimeout(() => { setStatus('idle'); setErrorMsg(null) }, 3500)
    }
  }

  const variantLabel = (v: VariantOption): string =>
    (v.option_values && v.option_values.length > 0)
      ? v.option_values.join(' / ')
      : (v.variant_label ?? `Variant ${v.variant_id}`)

  const optionLabel = (selected?.option_names && selected.option_names.length > 0)
    ? selected.option_names.join(' / ')
    : (variants[0]?.option_names?.join(' / ') ?? 'Options')

  return (
    <div
      className={`${styles.productCard} ${isGrid ? styles.productCardGrid : ''} ${isHero ? styles.productCardHero : ''} ${isCompact ? styles.productCardCompact : ''}`}
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
        {props.tags && props.tags.length > 0 && (
          <div className={styles.tags}>
            {props.tags.slice(0, 4).map(t => <span key={t} className={styles.tag}>{t}</span>)}
          </div>
        )}
        {showVariantPicker && (
          <label className={styles.variantPicker} onClick={(e) => e.stopPropagation()}>
            <span className={styles.variantLabel}>{optionLabel}</span>
            <select
              value={selectedId ?? ''}
              onChange={(e) => setSelectedId(Number(e.target.value))}
              className={styles.variantSelect}
            >
              {variants.map(v => (
                <option key={v.variant_id} value={v.variant_id}>
                  {variantLabel(v)}{v.quantity > 0 ? '' : ' — out of stock'}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className={styles.productFooter}>
          <span className={`${styles.price} ${isGrid ? styles.priceGrid : ''}`}>${Number(displayPrice).toFixed(2)}</span>
          {qty !== null && Number.isFinite(qty) && (
            <span className={`${styles.stock} ${inStock ? styles.inStock : styles.outOfStock}`}>
              {inStock ? `${qty} in stock` : 'Out of stock'}
            </span>
          )}
        </div>
        {showAddToCart && (
          <>
            <button
              type="button"
              className={styles.addBtn}
              onClick={onAdd}
              disabled={!inStock || busy}
            >
              {added ? 'Added ✓' : inStock ? 'Add to cart' : 'Out of stock'}
            </button>
            {errorMsg && <p className={styles.addError} role="alert">{errorMsg}</p>}
          </>
        )}
      </div>
    </div>
  )
}
