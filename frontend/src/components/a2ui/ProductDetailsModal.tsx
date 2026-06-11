import styles from './A2ui.module.css'
import { normalizeTags } from '../../lib/normalizeTags'

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
      {(() => {
        const tagList = normalizeTags(props.tags);
        if (tagList.length === 0) return null;
        return (
          <div className={styles.modalTags}>
            {tagList.map(t => <span key={t} className={styles.modalTag}>{t}</span>)}
          </div>
        );
      })()}
    </div>
  )
}
