import { formatCurrency } from '../lib/format'

export interface SavedProduct {
  product_id: number
  name: string
  price: number
  image_url?: string | null
  shop_name?: string | null
}

interface Classes {
  item: string
  thumb: string
  body: string
  name: string
  sub: string
  remove: string
}

interface Props {
  product: SavedProduct
  classes: Classes
  onRemove: (productId: number) => void
}

export default function SavedProductItem({ product, classes, onRemove }: Props) {
  return (
    <li className={classes.item}>
      <div className={classes.thumb}>
        {product.image_url && <img src={product.image_url} alt="" />}
      </div>
      <div className={classes.body}>
        <p className={classes.name}>{product.name}</p>
        <div className={classes.sub}>
          {(product.shop_name ?? 'Unknown shop')} · {formatCurrency(product.price)}
        </div>
      </div>
      <button
        className={classes.remove}
        onClick={() => onRemove(product.product_id)}
        title="Remove from Saved"
        aria-label="Remove from Saved"
      >×</button>
    </li>
  )
}
