import styles from './A2ui.module.css'

interface InlineProduct {
  product_id: number
  name: string
  price?: number
  quantity?: number
  shop_name?: string
  tags?: string[]
  image_url?: string
  description_summary?: string
  [key: string]: unknown
}

interface Props {
  product_ids: number[]
  products: InlineProduct[]
  attributes: string[]
  sort_by?: string
}

function fmt(attr: string, value: unknown): string {
  if (value == null || value === '') return '—'
  if (attr === 'price' && typeof value === 'number') return `$${value.toFixed(2)}`
  if (attr === 'stock' || attr === 'quantity') {
    const n = Number(value)
    return n > 0 ? `${n} in stock` : 'Out of stock'
  }
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}

function valueFor(product: InlineProduct, attr: string): unknown {
  if (attr === 'stock') return product.quantity
  return product[attr]
}

export default function ComparisonTable({ product_ids, products, attributes }: Props) {
  // product_ids is the canonical column order. Look up each id in products.
  // Anything in product_ids without a matching product is skipped (validator
  // shouldn't let this happen, but be defensive). Products not referenced by
  // product_ids are ignored — the agent should keep the two arrays in sync.
  const productList = Array.isArray(products) ? products : []
  const idList = Array.isArray(product_ids) ? product_ids : []
  const attrList = Array.isArray(attributes) ? attributes : []
  const byId = new Map<number, InlineProduct>()
  for (const p of productList) byId.set(p.product_id, p)
  const ordered = idList
    .map(id => byId.get(id))
    .filter((p): p is InlineProduct => p != null)

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.compTable}>
        <thead>
          <tr>
            <th></th>
            {ordered.map(p => (
              <th key={p.product_id}>{p.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {attrList.map(attr => (
            <tr key={attr}>
              <td className={styles.compAttr}>{attr.replace(/_/g, ' ')}</td>
              {ordered.map(p => (
                <td key={p.product_id}>{fmt(attr, valueFor(p, attr))}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
