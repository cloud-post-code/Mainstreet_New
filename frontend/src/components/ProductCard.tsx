import styles from './Cards.module.css'

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
}

export default function ProductCard(props: Props) {
  const inStock = (props.quantity ?? 0) > 0
  return (
    <div className={styles.productCard}>
      <div className={styles.productImage}>
        {props.image_url
          ? <img src={props.image_url} alt={props.name} />
          : <div className={styles.imagePlaceholder}>🛍️</div>
        }
      </div>
      <div className={styles.productBody}>
        <div className={styles.shopBadge}>{props.shop_name}</div>
        <h3 className={styles.productName}>{props.name}</h3>
        {props.description_summary && (
          <p className={styles.productDesc}>{props.description_summary}</p>
        )}
        {props.tags && props.tags.length > 0 && (
          <div className={styles.tags}>
            {props.tags.map(t => <span key={t} className={styles.tag}>{t}</span>)}
          </div>
        )}
        <div className={styles.productFooter}>
          <span className={styles.price}>${Number(props.price).toFixed(2)}</span>
          <span className={`${styles.stock} ${inStock ? styles.inStock : styles.outOfStock}`}>
            {inStock ? `${props.quantity} in stock` : 'Out of stock'}
          </span>
        </div>
      </div>
    </div>
  )
}
