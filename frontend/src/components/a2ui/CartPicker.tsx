import { useState } from 'react'
import { useAddToCart } from '../../hooks/useAddToCart'
import { IntentHandler } from '../../a2ui/types'
import { formatCurrency } from '../../lib/format'
import styles from './CartPicker.module.css'

interface CartPickerProduct {
  product_id: number
  name: string
  price: number
  image_url?: string
  shop_name: string
  variant_id?: number
}

interface Props {
  question_id: string
  question?: string
  products: CartPickerProduct[]
  onIntent?: IntentHandler
}

export default function CartPicker({
  question_id,
  question = 'Which would you like to add to your cart?',
  products,
  onIntent,
}: Props) {
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [adding, setAdding] = useState(false)
  const [done, setDone] = useState(false)
  const { add } = useAddToCart()

  const safeProducts = Array.isArray(products) ? products : []

  function toggle(productId: number) {
    if (done) return
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(productId)) next.delete(productId)
      else next.add(productId)
      return next
    })
  }

  async function addSelected() {
    if (done || selected.size === 0 || adding) return
    setAdding(true)
    try {
      for (const p of safeProducts) {
        if (!selected.has(p.product_id)) continue
        await add(
          p.variant_id != null
            ? { variantId: p.variant_id }
            : { productId: p.product_id }
        )
      }
      setDone(true)
      const names = safeProducts
        .filter(p => selected.has(p.product_id))
        .map(p => p.name)
        .join(', ')
      onIntent?.('answer_choice', {
        question_id,
        choice: `Added to cart: ${names}`,
      })
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <img src="/mason/mason-1.png" alt="Mason" className={styles.avatar} />
        <div className={styles.question}>{question}</div>
      </div>

      <div className={styles.list}>
        {safeProducts.map(p => {
          const checked = selected.has(p.product_id)
          return (
            <label
              key={p.product_id}
              className={`${styles.row} ${checked ? styles.rowChecked : ''} ${done ? styles.rowDone : ''}`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(p.product_id)}
                disabled={done}
                className={styles.checkbox}
              />
              {p.image_url ? (
                <img
                  src={p.image_url}
                  alt={p.name}
                  className={styles.thumb}
                />
              ) : (
                <div className={styles.thumbPlaceholder}>🛍️</div>
              )}
              <div className={styles.info}>
                <span className={styles.name}>{p.name}</span>
                <span className={styles.shop}>{p.shop_name}</span>
              </div>
              <span className={styles.price}>{formatCurrency(p.price)}</span>
            </label>
          )
        })}
      </div>

      {!done && (
        <button
          className={styles.addBtn}
          onClick={addSelected}
          disabled={selected.size === 0 || adding}
        >
          {adding ? 'Adding…' : `Add ${selected.size > 0 ? selected.size : ''} to cart`}
        </button>
      )}
      {done && (
        <div className={styles.doneMsg}>Added to your cart ✓</div>
      )}
    </div>
  )
}
