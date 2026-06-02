import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styles from './Cards.module.css'
import { IntentHandler } from '../a2ui/types'
import { useCart } from '../cart/CartContext'
import { useAuth } from '../hooks/useAuth'

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
  variant?: 'default' | 'grid'
  showAddToCart?: boolean
}

export default function ProductCard(props: Props) {
  const inStock = (props.quantity ?? 0) > 0
  const clickable = Boolean(props.onIntent)
  const cart = useCart()
  const { token } = useAuth()
  const navigate = useNavigate()
  const [added, setAdded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isGrid = props.variant === 'grid'

  const onAdd = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!token) {
      navigate('/login')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await cart.addItem(props.product_id, 1)
      if (res.ok) {
        setAdded(true)
        setTimeout(() => setAdded(false), 1200)
      } else if (res.error) {
        setError(res.error)
        setTimeout(() => setError(null), 3500)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={`${styles.productCard} ${isGrid ? styles.productCardGrid : ''}`}
      style={clickable ? { cursor: 'pointer' } : undefined}
      onClick={clickable ? () => props.onIntent?.('open_details', { product_id: props.product_id, name: props.name }) : undefined}
    >
      <div className={`${styles.productImage} ${isGrid ? styles.productImageGrid : ''}`}>
        {props.image_url
          ? <img src={props.image_url} alt={props.name} />
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
        <div className={styles.productFooter}>
          <span className={`${styles.price} ${isGrid ? styles.priceGrid : ''}`}>${Number(props.price).toFixed(2)}</span>
          <span className={`${styles.stock} ${inStock ? styles.inStock : styles.outOfStock}`}>
            {inStock ? `${props.quantity} in stock` : 'Out of stock'}
          </span>
        </div>
        {props.showAddToCart && (
          <>
            <button
              type="button"
              className={styles.addBtn}
              onClick={onAdd}
              disabled={!inStock || busy}
            >
              {added ? 'Added ✓' : inStock ? 'Add to cart' : 'Out of stock'}
            </button>
            {error && <p className={styles.addError} role="alert">{error}</p>}
          </>
        )}
      </div>
    </div>
  )
}
