import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, Product } from '../api'
import ProductCard from '../components/ProductCard'
import ShopCard from '../components/ShopCard'
import ProductModal, { ProductModalData } from '../components/ProductModal'
import styles from './Discover.module.css'
import { useModalDismiss } from '../hooks/useModalDismiss'
import { useAuth } from '../hooks/useAuth'
import { useMasonMemory } from '../mason/useMasonMemory'
import { MemoryProvider } from '../mason/MemoryContext'

type ShopFull = {
  id: number
  name: string
  logo_url: string | null
  description: string | null
  website_url: string | null
  product_count: number
}

type BrowseMode = 'product' | 'shop'

const PAGE_SIZE = 24

// Total chips shown in the session-scoped filter set.
const TOTAL_FILTERS = 20

// Price buckets are always present in the filter set.
type PriceBucket = { id: string; label: string; min?: number; max?: number }
const PRICE_BUCKETS: PriceBucket[] = [
  { id: 'p1', label: 'Under $10', max: 10 },
  { id: 'p2', label: '$10 – $25', min: 10, max: 25 },
  { id: 'p3', label: '$25 – $50', min: 25, max: 50 },
  { id: 'p4', label: '$50+', min: 50 },
]

// Multiple shops (or repeated scrapes) can produce separate Product rows that
// share the same display name. The feed should show each name once.
function dedupeByName(items: Product[], seenNames?: Set<string>): Product[] {
  const seen = seenNames ?? new Set<string>()
  const out: Product[] = []
  for (const p of items) {
    const key = p.name.trim().toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
  }
  return out
}

function sampleN<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return [...arr]
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy.slice(0, n)
}

const descSummary = (d: Product['description']) =>
  typeof (d as Record<string, unknown> | null)?.summary === 'string' ? (d as Record<string, string>).summary : undefined
const descTags = (d: Product['description']) =>
  Array.isArray((d as Record<string, unknown> | null)?.tags)
    ? ((d as Record<string, unknown>).tags as unknown[]).filter((x): x is string => typeof x === 'string')
    : undefined

function productToModalData(p: Product): ProductModalData {
  return {
    product_id: p.id,
    name: p.name,
    price: Number(p.price_range?.min ?? 0),
    image_url: p.image_url,
    shop_id: p.shop_id,
    shop_name: p.shop_name ?? '',
    description_summary: descSummary(p.description),
    tags: descTags(p.description),
    variants: p.variants.map(v => ({
      variant_id: v.id,
      option_names: v.option_names,
      option_values: v.option_values,
      variant_label: v.variant_label,
      price: Number(v.price),
      quantity: Number.POSITIVE_INFINITY,
      image_url: v.image_url,
    })),
    default_variant_id: p.default_variant_id ?? undefined,
  }
}


export default function Discover() {
  const { token } = useAuth()
  const memory = useMasonMemory(token)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [shopIds, setShopIds] = useState<number[]>([])
  const [selectedTags, setSelectedTags] = useState<string[]>([])

  const [products, setProducts] = useState<Product[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionShops, setSessionShops] = useState<Array<{ id: number; name: string }>>([])
  const [sessionTags, setSessionTags] = useState<string[]>([])
  const [selectedPriceId, setSelectedPriceId] = useState<string | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [browseMode, setBrowseMode] = useState<BrowseMode>('product')
  const [allShops, setAllShops] = useState<ShopFull[]>([])
  const [shopsLoading, setShopsLoading] = useState(false)
  const [shopsError, setShopsError] = useState<string | null>(null)
  const [modalProduct, setModalProduct] = useState<ProductModalData | null>(null)

  const sentinelRef = useRef<HTMLDivElement | null>(null)

  useModalDismiss(!!modalProduct, () => setModalProduct(null))

  // Debounce search input.
  const debounceRef = useRef<number | null>(null)
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => setSearch(searchInput), 300)
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current) }
  }, [searchInput])

  // On session join (page mount), pull available shops + tags and randomly
  // sample a fixed total of TOTAL_FILTERS chips. Price chips are always
  // included, and the remaining slots are split between shops and tags.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      api.getPublicShops().catch(() => [] as Array<{ id: number; name: string }>),
      api.getProductTags().catch(() => [] as string[]),
    ]).then(([shops, tags]) => {
      if (cancelled) return
      const remaining = Math.max(0, TOTAL_FILTERS - PRICE_BUCKETS.length)
      // Split the remaining slots roughly evenly between shops and tags,
      // then top up from the other pool if one runs out.
      const shopTarget = Math.min(shops.length, Math.ceil(remaining / 2))
      const tagTarget = Math.min(tags.length, remaining - shopTarget)
      const shopShort = Math.ceil(remaining / 2) - shopTarget
      const finalTagTarget = Math.min(tags.length, tagTarget + shopShort)
      const finalShopTarget = Math.min(
        shops.length,
        shopTarget + Math.max(0, remaining - shopTarget - finalTagTarget),
      )
      setSessionShops(sampleN(shops, finalShopTarget))
      setSessionTags(sampleN(tags, finalTagTarget))
    })
    return () => { cancelled = true }
  }, [])

  // Lazily fetch full shop list the first time the user switches to "Shop by shop".
  useEffect(() => {
    if (browseMode !== 'shop' || allShops.length > 0 || shopsLoading) return
    let cancelled = false
    setShopsLoading(true)
    setShopsError(null)
    api.getPublicShopsFull()
      .then(rows => { if (!cancelled) setAllShops(rows) })
      .catch(err => {
        if (cancelled) return
        setShopsError(err instanceof Error ? err.message : 'Failed to load shops')
      })
      .finally(() => { if (!cancelled) setShopsLoading(false) })
    return () => { cancelled = true }
  }, [browseMode, allShops.length, shopsLoading])

  const filteredShops = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return allShops
    return allShops.filter(s =>
      s.name.toLowerCase().includes(q)
      || (s.description ?? '').toLowerCase().includes(q),
    )
  }, [allShops, search])

  const selectedPrice = useMemo(
    () => PRICE_BUCKETS.find(p => p.id === selectedPriceId) ?? null,
    [selectedPriceId],
  )

  const filterKey = useMemo(
    () => JSON.stringify({ search, shopIds, selectedTags, selectedPriceId }),
    [search, shopIds, selectedTags, selectedPriceId],
  )

  const buildFilters = useCallback((offset: number) => ({
    q: search || undefined,
    shop_ids: shopIds.length ? shopIds : undefined,
    tags: selectedTags.length ? selectedTags : undefined,
    min_price: selectedPrice?.min,
    max_price: selectedPrice?.max,
    limit: PAGE_SIZE,
    offset,
  }), [search, shopIds, selectedTags, selectedPrice])

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
        shop_ids: opts.shop_ids,
        tags: opts.tags,
        min_price: opts.min_price,
        max_price: opts.max_price,
      }),
    ])
      .then(([items, countRes]) => {
        if (cancelled) return
        setProducts(dedupeByName(items))
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
      setProducts(prev => {
        const seenNames = new Set(prev.map(p => p.name.trim().toLowerCase()))
        return [...prev, ...dedupeByName(more, seenNames)]
      })
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
  const activeFilterCount =
    (shopIds.length ? 1 : 0)
    + (selectedTags.length ? 1 : 0)
    + (selectedPriceId ? 1 : 0)

  const toggleShop = (id: number) => {
    setShopIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }
  const toggleTag = (t: string) => {
    setSelectedTags(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])
  }
  const clearFilters = () => {
    setShopIds([])
    setSelectedTags([])
    setSelectedPriceId(null)
  }
  const togglePrice = (id: string) => {
    setSelectedPriceId(prev => (prev === id ? null : id))
  }

  return (
    <MemoryProvider memory={memory}>
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Window Display</h1>
        <p className={styles.tagline}>A fresh look at every shop on Main Street.</p>
        <div className={styles.modeToggle} role="tablist" aria-label="Browse mode">
          <button
            type="button"
            role="tab"
            aria-selected={browseMode === 'product'}
            className={`${styles.modeBtn} ${browseMode === 'product' ? styles.modeBtnActive : ''}`}
            onClick={() => setBrowseMode('product')}
          >
            Shop by product
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={browseMode === 'shop'}
            className={`${styles.modeBtn} ${browseMode === 'shop' ? styles.modeBtnActive : ''}`}
            onClick={() => setBrowseMode('shop')}
          >
            Shop by shop
          </button>
        </div>
      </header>

      <div className={styles.filterBar}>
        <input
          className={styles.search}
          type="search"
          placeholder={browseMode === 'shop'
            ? 'Search shops by name or description…'
            : 'Search by product, shop, or description…'}
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          aria-label={browseMode === 'shop' ? 'Search shops' : 'Search products'}
        />
        {browseMode === 'product' && (
          <button
            type="button"
            className={styles.filterToggle}
            onClick={() => setShowFilters(s => !s)}
          >
            Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </button>
        )}
        <span className={styles.count}>
          {browseMode === 'product'
            ? (total != null ? `${total} result${total === 1 ? '' : 's'}` : '')
            : (allShops.length > 0
              ? `${filteredShops.length} shop${filteredShops.length === 1 ? '' : 's'}`
              : '')}
        </span>
      </div>

      {browseMode === 'product' && showFilters && (
        <div className={styles.filtersPanel}>
          <div className={styles.filterGroup}>
            <div className={styles.filterLabel}>Price</div>
            <div className={styles.chipRow}>
              {PRICE_BUCKETS.map(p => (
                <button
                  key={p.id}
                  type="button"
                  className={`${styles.chip} ${selectedPriceId === p.id ? styles.chipActive : ''}`}
                  onClick={() => togglePrice(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          {sessionShops.length > 0 && (
            <div className={styles.filterGroup}>
              <div className={styles.filterLabel}>Shops</div>
              <div className={styles.chipRow}>
                {sessionShops.map(s => (
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
          )}
          {sessionTags.length > 0 && (
            <div className={styles.filterGroup}>
              <div className={styles.filterLabel}>Tags</div>
              <div className={styles.chipRow}>
                {sessionTags.map(t => (
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
          )}
          {activeFilterCount > 0 && (
            <div className={styles.filterGroup}>
              <button type="button" className={styles.clearBtn} onClick={clearFilters}>
                Clear filters
              </button>
            </div>
          )}
        </div>
      )}

      <main className={styles.content}>
        {browseMode === 'product' ? (
          <>
            {error && <div className={styles.error}>{error}</div>}

            {(() => {
              const customizable = products.filter(p => (p.variants?.length ?? 0) > 1).slice(0, 3)
              if (customizable.length === 0) return null
              return (
                <section className={styles.customizeRail}>
                  <h2 className={styles.customizeTitle}>Customize it</h2>
                  <p className={styles.customizeSubtitle}>Pick the size, color, and style that fits you.</p>
                  <div className={styles.customizeGrid}>
                    {customizable.map(p => (
                      <div
                        key={`opts-${p.id}`}
                        className={styles.cardClickable}
                        onClick={() => setModalProduct(productToModalData(p))}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setModalProduct(productToModalData(p)) } }}
                      >
                        <ProductCard
                          product_id={p.id}
                          name={p.name}
                          price={Number(p.price_range?.min ?? 0)}
                          image_url={p.image_url ?? undefined}
                          shop_name={p.shop_name ?? ''}
                          shop_id={p.shop_id}
                          description_summary={descSummary(p.description)}
                          layout="options"
                          showAddToCart
                          variants={p.variants.map(v => ({
                            variant_id: v.id,
                            option_names: v.option_names,
                            option_values: v.option_values,
                            variant_label: v.variant_label,
                            price: Number(v.price),
                            quantity: Number.POSITIVE_INFINITY,
                            image_url: v.image_url,
                          }))}
                          default_variant_id={p.default_variant_id ?? undefined}
                          display_mode="parent"
                        />
                      </div>
                    ))}
                  </div>
                </section>
              )
            })()}

            {products.length === 0 && !loading ? (
              <div className={styles.empty}>No products match your filters.</div>
            ) : (
              <div className={styles.grid}>
                {products.map(p => (
                  <div key={p.id} className={styles.cardClickable}>
                    <ProductCard
                      product_id={p.id}
                      name={p.name}
                      price={Number(p.price_range?.min ?? 0)}
                      image_url={p.image_url ?? undefined}
                      shop_name={p.shop_name ?? ''}
                      shop_id={p.shop_id}
                      description_summary={descSummary(p.description)}
                      layout="options"
                      showAddToCart
                      variants={p.variants.map(v => ({
                        variant_id: v.id,
                        option_names: v.option_names,
                        option_values: v.option_values,
                        variant_label: v.variant_label,
                        price: Number(v.price),
                        quantity: Number.POSITIVE_INFINITY,
                        image_url: v.image_url,
                      }))}
                      default_variant_id={p.default_variant_id ?? undefined}
                      display_mode="parent"
                    />
                  </div>
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
          </>
        ) : (
          <>
            {shopsError && <div className={styles.error}>{shopsError}</div>}

            {shopsLoading && allShops.length === 0 ? (
              <div className={styles.grid}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={`sk-shop-${i}`} className={styles.skeleton} />
                ))}
              </div>
            ) : filteredShops.length === 0 ? (
              <div className={styles.empty}>No shops match your search.</div>
            ) : (
              <div className={styles.grid}>
                {filteredShops.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    className={styles.shopTile}
                    onClick={() => {
                      setShopIds([s.id])
                      setBrowseMode('product')
                    }}
                    aria-label={`Browse products from ${s.name}`}
                  >
                    <ShopCard
                      shop_id={s.id}
                      name={s.name}
                      logo_url={s.logo_url ?? undefined}
                      description={s.description ?? undefined}
                      website_url={s.website_url ?? undefined}
                      product_count={s.product_count}
                    />
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {modalProduct && (
        <ProductModal
          product={modalProduct}
          memory={memory}
          onClose={() => setModalProduct(null)}
        />
      )}
    </div>
    </MemoryProvider>
  )
}

