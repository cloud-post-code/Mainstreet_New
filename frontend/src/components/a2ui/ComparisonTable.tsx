import styles from './A2ui.module.css'

interface InlineProduct {
  product_id: number
  name: string
  price?: number
  pros?: string[]
  cons?: string[]
  shop_name?: string
  image_url?: string
  [key: string]: unknown
}

interface Props {
  products: InlineProduct[]
  product_ids?: number[]
  attributes?: string[]
  sort_by?: string
}

function formatPrice(price: unknown): string {
  if (typeof price === 'number') return `$${price.toFixed(2)}`
  if (typeof price === 'string' && price !== '') return price
  return '—'
}

function PointsList({ items, tone }: { items: unknown; tone: 'pro' | 'con' }) {
  const list = Array.isArray(items) ? items.filter(Boolean).map(String) : []
  if (list.length === 0) return <span className={styles.compEmpty}>—</span>
  return (
    <ul className={styles.compPoints}>
      {list.map((point, i) => (
        <li key={i} className={tone === 'pro' ? styles.compPro : styles.compCon}>
          <span className={styles.compPointMark} aria-hidden>{tone === 'pro' ? '+' : '−'}</span>
          <span>{point}</span>
        </li>
      ))}
    </ul>
  )
}

export default function ComparisonTable({ products, product_ids }: Props) {
  const productList = Array.isArray(products) ? products : []
  const ordered = Array.isArray(product_ids) && product_ids.length > 0
    ? product_ids
        .map(id => productList.find(p => p.product_id === id))
        .filter((p): p is InlineProduct => p != null)
    : productList

  if (ordered.length === 0) {
    return (
      <div className={styles.tableWrapper}>
        <div className={styles.compEmptyState}>No products to compare.</div>
      </div>
    )
  }

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.compTable}>
        <thead>
          <tr>
            <th className={styles.compColProduct}>Product</th>
            <th className={styles.compColPrice}>Price</th>
            <th className={styles.compColPros}>Pros</th>
            <th className={styles.compColCons}>Cons</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map(p => (
            <tr key={p.product_id}>
              <td className={styles.compProductCell}>
                <div className={styles.compProductName}>{p.name}</div>
                {p.shop_name && <div className={styles.compProductShop}>{p.shop_name}</div>}
              </td>
              <td className={styles.compPriceCell}>{formatPrice(p.price)}</td>
              <td><PointsList items={p.pros} tone="pro" /></td>
              <td><PointsList items={p.cons} tone="con" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
