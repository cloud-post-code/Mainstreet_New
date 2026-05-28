import styles from './Cards.module.css'

interface Props {
  shop_id: number
  name: string
  logo_url?: string
  description?: string
  website_url?: string
  product_count?: number
}

export default function ShopCard(props: Props) {
  return (
    <div className={styles.shopCard}>
      <div className={styles.shopLogo}>
        {props.logo_url
          ? <img src={props.logo_url} alt={props.name} />
          : <span>{props.name[0]}</span>
        }
      </div>
      <div className={styles.shopBody}>
        <h3 className={styles.shopName}>{props.name}</h3>
        {props.description && <p className={styles.shopDesc}>{props.description}</p>}
        <div className={styles.shopMeta}>
          {props.product_count != null && (
            <span className={styles.productCount}>{props.product_count} products</span>
          )}
          {props.website_url && (
            <a href={props.website_url} target="_blank" rel="noreferrer" className={styles.shopLink}>
              Visit shop →
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
