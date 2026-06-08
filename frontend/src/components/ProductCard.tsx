import { useMemo } from 'react'
import styles from './Cards.module.css'
import { IntentHandler } from '../a2ui/types'
import { formatCurrency } from '../lib/format'
import { useVariantSelector } from '../hooks/useVariantSelector'
import { useAddToCart } from '../hooks/useAddToCart'

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
}

export default function ProductCard(props: Props) {
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
        {props.tags && props.tags.length > 0 && (
          <div className={styles.tags}>
            {props.tags.slice(0, 4).map(t => <span key={t} className={styles.tag}>{t}</span>)}
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
