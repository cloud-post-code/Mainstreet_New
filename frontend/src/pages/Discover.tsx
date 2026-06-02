import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, Product } from '../api'
import ProductCard from '../components/ProductCard'
import styles from './Discover.module.css'

const PAGE_SIZE = 24

const descSummary = (d: Product['description']) =>
  typeof (d as Record<string, unknown> | null)?.summary === 'string' ? (d as Record<string, string>).summary : undefined
const descTags = (d: Product['description']) =>
  Array.isArray((d as Record<string, unknown> | null)?.tags)
    ? ((d as Record<string, unknown>).tags as unknown[]).filter((x): x is string => typeof x === 'string')
    : undefined

export default function Discover() {
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [inStockOnly, setInStockOnly] = useState(false)
  const [shopIds, setShopIds] = useState<number[]>([])
  const [selectedTags, setSelectedTags] = useState<string[]>([])

  const [products, setProducts] = useState<Product[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shops, setShops] = useState<Array<{ id: number; name: string }>>([])
  const [tagOptions, setTagOptions] = useState<string[]>([])
  const [showFilters, setShowFilters] = useState(false)

  const sentinelRef = useRef<HTMLDivElement | null>(null)

  // Debounce search input.
  const debounceRef = useRef<number | null>(null)
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => setSearch(searchInput), 300)
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current) }
  }, [searchInput])

  // Load filter option lists once.
  useEffect(() => {
    api.getPublicShops().then(setShops).catch(() => {})
    api.getProductTags().then(setTagOptions).catch(() => {})
  }, [])

  const filterKey = useMemo(
    () => JSON.stringify({ search, inStockOnly, shopIds, selectedTags }),
    [search, inStockOnly, shopIds, selectedTags],
  )

  const buildFilters = useCallback((offset: number) => ({
    q: search || undefined,
    in_stock_only: inStockOnly || undefined,
    shop_ids: shopIds.length ? shopIds : undefined,
    tags: selectedTags.length ? selectedTags : undefined,
    limit: PAGE_SIZE,
    offset,
  }), [search, inStockOnly, shopIds, selectedTags])

  // Fetch first page whenever filters change.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const opts = buildFilters(0)
    Promise.all([
      api.getDiscoverProducts(opts),
      api.getDiscoverCount({
        q: opts.q,
        in_stock_only: opts.in_stock_only,
        shop_ids: opts.shop_ids,
        tags: opts.tags,
      }),
    ])
      .then(([items, countRes]) => {
        if (cancelled) return
        setProducts(items)
        setTotal(countRes.total)
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load products')
        setProducts([])
        setTotal(null)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [filterKey])

  const loadMore = useCallback(async () => {
    if (loading) return
    if (total != null && products.length >= total) return
    setLoading(true)
    try {
      const more = await api.getDiscoverProducts(buildFilters(products.length))
      setProducts(prev => [...prev, ...more])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more')
    } finally {
      setLoading(false)
    }
  }, [loading, total, products.length, buildFilters])

  // Infinite scroll via IntersectionObserver.
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) loadMore()
    }, { rootMargin: '600px 0px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [loadMore])

  const exhausted = total != null && products.length >= total
  const activeFilterCount = (shopIds.length ? 1 : 0) + (selectedTags.length ? 1 : 0) + (inStockOnly ? 1 : 0)

  const toggleShop = (id: number) => {
    setShopIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }
  const toggleTag = (t: string) => {
    setSelectedTags(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])
  }
  const clearFilters = () => {
    setShopIds([])
    setSelectedTags([])
    setInStockOnly(false)
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Discover</h1>
        <p className={styles.tagline}>A fresh look at every shop on Main Street.</p>
      </header>

      <div className={styles.filterBar}>
        <input
          className={styles.search}
          type="search"
          placeholder="Search by product, shop, or description…"
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          aria-label="Search products"
        />
        <button
          type="button"
          className={styles.filterToggle}
          onClick={() => setShowFilters(s => !s)}
        >
          Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
        </button>
        <span className={styles.count}>
          {total != null ? `${total} result${total === 1 ? '' : 's'}` : ''}
        </span>
      </div>

      {showFilters && (
        <div className={styles.filtersPanel}>
          <div className={styles.filterGroup}>
            <div className={styles.filterLabel}>Shops</div>
            <div className={styles.chipRow}>
              {shops.map(s => (
                <button
                  key={s.id}
                  type="button"
                  className={`${styles.chip} ${shopIds.includes(s.id) ? styles.chipActive : ''}`}
                  onClick={() => toggleShop(s.id)}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.filterGroup}>
            <div className={styles.filterLabel}>Tags</div>
            <div className={styles.chipRow}>
              {tagOptions.map(t => (
                <button
                  key={t}
                  type="button"
                  className={`${styles.chip} ${selectedTags.includes(t) ? styles.chipActive : ''}`}
                  onClick={() => toggleTag(t)}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.filterGroup}>
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={inStockOnly}
                onChange={e => setInStockOnly(e.target.checked)}
              />
              In stock only
            </label>
            {activeFilterCount > 0 && (
              <button type="button" className={styles.clearBtn} onClick={clearFilters}>
                Clear filters
              </button>
            )}
          </div>
        </div>
      )}

      <main className={styles.content}>
        {error && <div className={styles.error}>{error}</div>}

        {products.length === 0 && !loading ? (
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
                description_summary={descSummary(p.description)}
                tags={descTags(p.description)}
                variant="grid"
                showAddToCart
              />
            ))}
            {loading && Array.from({ length: 3 }).map((_, i) => (
              <div key={`sk-${i}`} className={styles.skeleton} />
            ))}
          </div>
        )}

        <div ref={sentinelRef} className={styles.sentinel} aria-hidden="true" />

        {exhausted && products.length > 0 && (
          <div className={styles.endOfList}>No more results.</div>
        )}
      </main>
    </div>
  )
}
