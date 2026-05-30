import { useState } from 'react'
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
  // Always closed by default. The modal only appears when the user clicks
  // the placeholder pill — never auto-pops, even on the agent's first render.
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        type="button"
        className={styles.modalPlaceholder}
        onClick={() => setOpen(true)}
      >
        <span className={styles.modalPlaceholderIcon}>🛍️</span>
        <span className={styles.modalPlaceholderText}>
          View details for <strong>{props.name}</strong>
        </span>
      </button>
    )
  }

  const mainImage = props.gallery?.[0] ?? props.image_url
  return (
    <div className={styles.modalOverlay} onClick={() => setOpen(false)}>
      <div className={styles.modalCard} onClick={e => e.stopPropagation()}>
        <button className={styles.modalClose} onClick={() => setOpen(false)}>×</button>
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
    </div>
  )
}
