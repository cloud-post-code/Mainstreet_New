import { useEffect, useMemo, useRef, useState } from 'react'
import { api, Product } from '../api'
import ProductCard from '../components/ProductCard'
import TopNav from '../components/TopNav'
import styles from './Discover.module.css'

const PAGE_SIZE = 20

function shuffle<T>(arr: T[]): T[] {
  const out = arr.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function descriptionSummary(d: Product['description']): string | undefined {
  if (!d || typeof d !== 'object') return undefined
  const s = (d as Record<string, unknown>).summary
  return typeof s === 'string' ? s : undefined
}

function descriptionTags(d: Product['description']): string[] | undefined {
  if (!d || typeof d !== 'object') return undefined
  const t = (d as Record<string, unknown>).tags
  return Array.isArray(t) ? t.filter((x): x is string => typeof x === 'string') : undefined
}

export default function Discover() {
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [inStockOnly, setInStockOnly] = useState(false)
  const [page, setPage] = useState(0)
  const [products, setProducts] = useState<Product[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const debounceRef = useRef<number | null>(null)
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      setSearch(searchInput)
      setPage(0)
    }, 300)
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current)
    }
  }, [searchInput])

  useEffect(() => {
    setPage(0)
  }, [inStockOnly])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const opts = {
      q: search || undefined,
      in_stock_only: inStockOnly || undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }
    Promise.all([
      api.getDiscoverProducts(opts),
      api.getDiscoverCount({ q: opts.q, in_stock_only: opts.in_stock_only }),
    ])
      .then(([items, countRes]) => {
        if (cancelled) return
        setProducts(shuffle(items))
        setTotal(countRes.total)
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load products')
        setProducts([])
        setTotal(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [search, inStockOnly, page])

  const rangeLabel = useMemo(() => {
    if (total == null) return ''
    if (total === 0) return '0 results'
    const start = page * PAGE_SIZE + 1
    const end = Math.min(total, page * PAGE_SIZE + products.length)
    return `Showing ${start}–${end} of ${total}`
  }, [page, products.length, total])

  const hasNext = total != null && (page + 1) * PAGE_SIZE < total
  const hasPrev = page > 0

  return (
    <div className={styles.page}>
      <TopNav />
      <header className={styles.header}>
        <h1 className={styles.title}>Discover</h1>
        <p className={styles.tagline}>A fresh look at every shop on Main Street.</p>
      </header>

      <div className={styles.filterBar}>
        <input
          className={styles.search}
          type="search"
          placeholder="Search products…"
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          aria-label="Search products"
        />
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={inStockOnly}
            onChange={e => setInStockOnly(e.target.checked)}
          />
          In stock only
        </label>
        <span className={styles.count}>{rangeLabel}</span>
      </div>

      <main className={styles.content}>
        {error && <div className={styles.error}>{error}</div>}

        {loading ? (
          <div className={styles.grid}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className={styles.skeleton} />
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className={styles.empty}>No products match your filters.</div>
        ) : (
          <div className={styles.grid}>
            {products.map(p => (
              <ProductCard
                key={p.id}
                product_id={p.id}
                name={p.name}
                price={Number(p.price)}
                quantity={p.quantity}
                image_url={p.image_url ?? undefined}
                shop_name={p.shop_name ?? ''}
                shop_id={p.shop_id}
                description_summary={descriptionSummary(p.description)}
                tags={descriptionTags(p.description)}
              />
            ))}
          </div>
        )}

        <div className={styles.pagination}>
          <button
            type="button"
            className={styles.pageButton}
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={!hasPrev || loading}
          >
            ← Previous
          </button>
          <span className={styles.pageIndicator}>
            Page {page + 1}
            {total != null ? ` of ${Math.max(1, Math.ceil(total / PAGE_SIZE))}` : ''}
          </span>
          <button
            type="button"
            className={styles.pageButton}
            onClick={() => setPage(p => p + 1)}
            disabled={!hasNext || loading}
          >
            Next →
          </button>
        </div>
      </main>
    </div>
  )
}
