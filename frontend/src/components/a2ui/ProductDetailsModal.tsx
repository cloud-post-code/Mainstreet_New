import styles from './A2ui.module.css'

interface Props {
  product_id: number
  name: string
  price: number
  shop_name: string
  image_url?: string
  gallery?: string[]
  description_long?: string
  tags?: string[]
  _a2uiId?: string
}

export default function ProductDetailsModal(props: Props) {
  const mainImage = props.gallery?.[0] ?? props.image_url
  return (
    <div className={styles.modalCard}>
      <div className={styles.modalImage}>
        {mainImage
          ? <img src={mainImage} alt={props.name} />
          : <span style={{ fontSize: '3rem' }}>🛍️</span>
        }
      </div>
      <div className={styles.modalShop}>{props.shop_name}</div>
      <h2 className={styles.modalName}>{props.name}</h2>
      <div className={styles.modalPrice}>${Number(props.price).toFixed(2)}</div>
      {props.description_long && <p className={styles.modalDesc}>{props.description_long}</p>}
      {props.tags && props.tags.length > 0 && (
        <div className={styles.modalTags}>
          {props.tags.map(t => <span key={t} className={styles.modalTag}>{t}</span>)}
        </div>
      )}
    </div>
  )
}
