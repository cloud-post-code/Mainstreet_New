import { useState } from 'react'
import { useAddToCart } from '../../hooks/useAddToCart'
import { formatCurrency } from '../../lib/format'
import { IntentHandler } from '../../a2ui/types'
import styles from './StyleQuestionCard.module.css'

interface StyleProduct {
  product_id: number
  name: string
  price: number
  image_url?: string
  shop_name: string
  shop_id?: number
  tags?: string[]
  variants?: Array<{
    variant_id: number
    option_names?: string[]
    option_values?: string[]
    variant_label?: string | null
    price: number
    quantity: number
    image_url?: string | null
  }>
  default_variant_id?: number
}

interface StyleTileProps {
  product: StyleProduct
  selected: boolean
  dimmed: boolean
  onSelect: () => void
}

function StyleTile({ product, selected, dimmed, onSelect }: StyleTileProps) {
  const { add, busy, added } = useAddToCart({ successMs: 1200 })

  const handleATC = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (product.default_variant_id != null) {
      await add({ variantId: product.default_variant_id })
    } else {
      await add({ productId: product.product_id })
    }
  }

  const tileClass = [
    styles.tile,
    selected ? styles.tileSelected : '',
    dimmed ? styles.tileDimmed : '',
  ].filter(Boolean).join(' ')

  return (
    <div className={tileClass}>
      <div className={styles.imageWrap}>
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            className={styles.image}
          />
        ) : (
          <div className={styles.imagePlaceholder}>🛍️</div>
        )}
        <button
          className={`${styles.atcBtn} ${added ? styles.atcBtnAdded : ''}`}
          onClick={handleATC}
          disabled={busy}
          aria-label={`Add ${product.name} to cart`}
        >
          {added ? 'Added ✓' : busy ? '...' : 'Add to Cart'}
        </button>
      </div>
      <div className={styles.tileBody}>
        <div className={styles.shopBadge}>{product.shop_name}</div>
        <div className={styles.productName}>{product.name}</div>
        <div className={styles.price}>{formatCurrency(product.price)}</div>
        <button
          className={`${styles.selectBtn} ${selected ? styles.selectBtnSelected : ''}`}
          onClick={onSelect}
          disabled={dimmed || selected}
          aria-pressed={selected}
        >
          {selected ? 'Selected ✓' : 'Select'}
        </button>
      </div>
    </div>
  )
}

interface Props {
  question_id: string
  question?: string
  hint?: string
  products: StyleProduct[]
  onIntent?: IntentHandler
}

export default function StyleQuestionCard({
  question_id,
  question = "Which of these looks most like what you're looking for?",
  hint,
  products,
  onIntent,
}: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const safeProducts = Array.isArray(products) ? products.slice(0, 6) : []

  function handleSelect(p: StyleProduct) {
    if (selectedId !== null) return
    setSelectedId(p.product_id)
    const tagStr = p.tags && p.tags.length > 0
      ? ` (${p.tags.slice(0, 4).join(', ')})`
      : ''
    onIntent?.('answer_choice', {
      question_id,
      choice: `I selected "${p.name}" by ${p.shop_name}${tagStr} — please find 6 similar items.`,
    })
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <img src="/mason/mason-1.png" alt="Mason" className={styles.avatar} />
        <div className={styles.headerText}>
          <div className={styles.question}>{question}</div>
          {hint && <div className={styles.hint}>{hint}</div>}
        </div>
      </div>

      <div className={styles.grid}>
        {safeProducts.map(p => (
          <StyleTile
            key={p.product_id}
            product={p}
            selected={selectedId === p.product_id}
            dimmed={selectedId !== null && selectedId !== p.product_id}
            onSelect={() => handleSelect(p)}
          />
        ))}
      </div>
    </div>
  )
}
