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
  const qty =
    props.quantity === undefined || props.quantity === null
      ? null
      : Number(props.quantity)
  const inStock = qty === null || !Number.isFinite(qty) ? true : qty > 0
  const showAddToCart = props.showAddToCart ?? false
  const clickable = Boolean(props.onIntent)
  const cart = useCart()
  const { token } = useAuth()
  const navigate = useNavigate()
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const isGrid = props.variant === 'grid'
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
    const res = await cart.addItem(props.product_id, 1)
    if (res.ok) {
      setStatus('success')
      setTimeout(() => setStatus('idle'), 1200)
    } else {
      setStatus('error')
      setErrorMsg(res.error ?? null)
      setTimeout(() => { setStatus('idle'); setErrorMsg(null) }, 3500)
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
