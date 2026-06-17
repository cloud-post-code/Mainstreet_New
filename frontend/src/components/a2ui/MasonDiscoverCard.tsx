import { useState } from 'react'
import styles from './MasonDiscoverCard.module.css'
import ProductCard from '../ProductCard'
import { IntentHandler } from '../../a2ui/types'

interface DiscoverProduct {
  product_id: number
  name: string
  price: number
  image_url?: string
  shop_name: string
  shop_id?: number
  description_summary?: string
  tags?: string[]
  quantity?: number
  variants?: Array<{
    variant_id: number
    option_names?: string[]
    option_values?: string[]
    variant_label?: string
    price: number
    quantity: number
    image_url?: string
  }>
  default_variant_id?: number
}

interface Props {
  products: DiscoverProduct[]
  title?: string
  subtitle?: string
  page_size?: number
  max_pages?: number
  onIntent: IntentHandler
}

export default function MasonDiscoverCard({
  products,
  title = "I found some options — take a look",
  subtitle = "Not sure which? Tap one to learn more.",
  page_size = 15,
  max_pages = 3,
  onIntent,
}: Props) {
  const [page, setPage] = useState(0)

  const capped = products.slice(0, page_size * max_pages)
  const totalPages = Math.min(max_pages, Math.ceil(capped.length / page_size))
  const pageProducts = capped.slice(page * page_size, (page + 1) * page_size)

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <img
          src="/mason/mason-1.png"
          alt="Mason"
          className={styles.avatar}
        />
        <div className={styles.headerText}>
          <div className={styles.title}>{title}</div>
          {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
        </div>
      </div>

      <div className={styles.grid}>
        {pageProducts.map(p => (
          <div key={p.product_id} className={styles.cardWrapper}>
            <ProductCard
              product_id={p.product_id}
              name={p.name}
              price={p.price}
              image_url={p.image_url}
              shop_name={p.shop_name}
              shop_id={p.shop_id}
              description_summary={p.description_summary}
              tags={p.tags}
              quantity={p.quantity}
              variants={p.variants}
              default_variant_id={p.default_variant_id}
              layout="grid"
              showAddToCart
              display_mode="parent"
              onIntent={onIntent}
            />
          </div>
        ))}
      </div>

      {totalPages > 1 && (
        <div className={styles.pagination}>
          <button
            className={styles.pageBtn}
            onClick={() => setPage(p => p - 1)}
            disabled={page === 0}
            aria-label="Previous page"
          >
            ← Previous
          </button>
          <span className={styles.pageIndicator}>
            {page + 1} / {totalPages}
          </span>
          <button
            className={styles.pageBtn}
            onClick={() => setPage(p => p + 1)}
            disabled={page >= totalPages - 1}
            aria-label="Next page"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}
