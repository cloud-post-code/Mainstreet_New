import { useEffect, useState, useRef, ChangeEvent, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { api, Shop, Product, ListingDraft, ListingStage, AdminStats, ScraperJobOut, ScraperVerificationReport, ScraperLogEntry, ScraperPreview } from '../api'
import { safeHref } from '../lib/safeHref'
import styles from './Admin.module.css'
import { formatCurrency } from '../lib/format'

interface ImportResult {
  rows_added: number
  rows_updated: number
  errors: Array<{ row: number; error: string }>
}

export default function Admin() {
  const { token } = useAuth()
  const navigate = useNavigate()
  const [shops, setShops] = useState<Shop[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [productsTotal, setProductsTotal] = useState(0)
  const [selectedShop, setSelectedShop] = useState<number | undefined>()
  const [productSearch, setProductSearch] = useState('')
  const [productSearchInput, setProductSearchInput] = useState('')
  const [productOffset, setProductOffset] = useState(0)
  const [productPageSize, setProductPageSize] = useState(100)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [shopImportResult, setShopImportResult] = useState<ImportResult | null>(null)
  const [importingShops, setImportingShops] = useState(false)
  const [shopImportError, setShopImportError] = useState<string | null>(null)
  const [downloadingProducts, setDownloadingProducts] = useState(false)
  const [downloadingShops, setDownloadingShops] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [showAddShop, setShowAddShop] = useState(false)
  const [newShopName, setNewShopName] = useState('')
  const [newShopLogoUrl, setNewShopLogoUrl] = useState<string | null>(null)
  const [newShopLogoPreview, setNewShopLogoPreview] = useState<string | null>(null)
  const [uploadingShopLogo, setUploadingShopLogo] = useState(false)
  const [shopLogoUploadError, setShopLogoUploadError] = useState<string | null>(null)
  const [newShopDescription, setNewShopDescription] = useState('')
  const [newShopWebsiteUrl, setNewShopWebsiteUrl] = useState('')
  const [addingShop, setAddingShop] = useState(false)
  const [addShopError, setAddShopError] = useState<string | null>(null)
  const [showAddProduct, setShowAddProduct] = useState(false)
  const [tab, setTab] = useState<'shops' | 'products' | 'stats' | 'scrapers'>('stats')
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [embeddingRunning, setEmbeddingRunning] = useState(false)
  const [embeddingProgress, setEmbeddingProgress] = useState<{ done: number; total: number; errors: number; elapsed_s: number; finished?: boolean } | null>(null)
  const [enrichRunning, setEnrichRunning] = useState(false)
  const [enrichProgress, setEnrichProgress] = useState<{ done: number; total: number; errors: number; finished?: boolean } | null>(null)

  useEffect(() => {
    if (!token) return
    api.adminShops(token).then(setShops)
  }, [token])

  useEffect(() => {
    if (!token) return
    setStatsLoading(true)
    api.adminStats(token).then(s => { setStats(s); setStatsLoading(false) }).catch(() => setStatsLoading(false))
  }, [token])

  const handleGenerateEmbeddings = async () => {
    if (!token || embeddingRunning) return
    setEmbeddingRunning(true)
    setEmbeddingProgress({ done: 0, total: 0, errors: 0, elapsed_s: 0 })
    const apiBase = (import.meta.env.VITE_API_URL ?? 'https://backend-production-c5f5.up.railway.app')
    try {
      const resp = await fetch(`${apiBase}/api/admin/generate-embeddings`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!resp.ok) {
        console.error('Embedding start failed:', resp.status, await resp.text())
        setEmbeddingRunning(false)
        return
      }
      // Poll for progress every 1.5s
      const poll = async () => {
        try {
          const r = await fetch(`${apiBase}/api/admin/generate-embeddings/status`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (!r.ok) return
          const payload = await r.json()
          setEmbeddingProgress({
            done: payload.done,
            total: payload.total,
            errors: payload.errors,
            elapsed_s: payload.elapsed_s ?? 0,
            finished: payload.finished,
          })
          if (payload.finished) {
            setEmbeddingRunning(false)
            api.adminStats(token!).then(setStats)
          } else {
            setTimeout(poll, 1500)
          }
        } catch {
          setTimeout(poll, 2000)
        }
      }
      setTimeout(poll, 800)
    } catch (e) {
      console.error('Embedding generation failed', e)
      setEmbeddingRunning(false)
    }
  }

  const handleEnrichProducts = async () => {
    if (!token || enrichRunning) return
    setEnrichRunning(true)
    setEnrichProgress({ done: 0, total: 0, errors: 0 })
    const apiBase = (import.meta.env.VITE_API_URL ?? 'https://backend-production-c5f5.up.railway.app')
    try {
      const resp = await fetch(`${apiBase}/api/admin/enrich-products`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!resp.ok) { setEnrichRunning(false); return }
      const poll = async () => {
        try {
          const r = await fetch(`${apiBase}/api/admin/enrich-products/status`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (!r.ok) return
          const p = await r.json()
          setEnrichProgress({ done: p.done, total: p.total, errors: p.errors, finished: p.finished })
          if (p.finished) { setEnrichRunning(false) } else { setTimeout(poll, 1500) }
        } catch { setTimeout(poll, 2000) }
      }
      setTimeout(poll, 800)
    } catch { setEnrichRunning(false) }
  }

  useEffect(() => {
    if (!token) return
    api
      .adminProducts(token, {
        shopId: selectedShop,
        limit: productPageSize,
        offset: productOffset,
        q: productSearch || undefined,
      })
      .then(page => {
        setProducts(page.items)
        setProductsTotal(page.total)
      })
  }, [token, selectedShop, productPageSize, productOffset, productSearch])

  // Reset to first page whenever filters change.
  useEffect(() => {
    setProductOffset(0)
  }, [selectedShop, productSearch, productPageSize])

  async function handleCsvUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !token) return
    setImporting(true)
    setImportResult(null)
    setImportError(null)
    try {
      const result = await api.importCsv(file, token)
      setImportResult(result)
      // Refresh
      api.adminShops(token).then(setShops)
      api
        .adminProducts(token, {
          shopId: selectedShop,
          limit: productPageSize,
          offset: productOffset,
          q: productSearch || undefined,
        })
        .then(page => {
          setProducts(page.items)
          setProductsTotal(page.total)
        })
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
      e.target.value = ''
    }
  }

  async function handleDeleteShop(id: number) {
    if (!token || !confirm('Delete this shop and all its products?')) return
    await api.deleteShop(id, token)
    setShops(prev => prev.filter(s => s.id !== id))
    setProducts(prev => prev.filter(p => p.shop_id !== id))
  }

  async function handleDeleteProduct(id: number) {
    if (!token || !confirm('Delete this product?')) return
    await api.deleteProduct(id, token)
    setProducts(prev => prev.filter(p => p.id !== id))
    setProductsTotal(t => Math.max(0, t - 1))
  }

  async function handleClearAllProducts() {
    if (!token) return
    if (!confirm('Are you sure you want to clear ALL products? This will permanently delete every product from the database and cannot be undone.')) return
    const result = await api.clearAllProducts(token)
    setProducts([])
    setProductsTotal(0)
    alert(`Cleared ${result.deleted} products.`)
    api.adminShops(token).then(setShops)
  }

  async function handleShopCsvUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !token) return
    setImportingShops(true)
    setShopImportResult(null)
    setShopImportError(null)
    try {
      const result = await api.importShopsCsv(file, token)
      setShopImportResult(result)
      api.adminShops(token).then(setShops)
    } catch (err) {
      setShopImportError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImportingShops(false)
      e.target.value = ''
    }
  }

  function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
  }

  async function handleDownloadProductsCsv() {
    if (!token) return
    setDownloadingProducts(true)
    setDownloadError(null)
    try {
      const { blob, filename } = await api.downloadProductsCsv(token)
      triggerDownload(blob, filename)
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Download failed')
    } finally {
      setDownloadingProducts(false)
    }
  }

  async function handleDownloadShopsCsv() {
    if (!token) return
    setDownloadingShops(true)
    setDownloadError(null)
    try {
      const { blob, filename } = await api.downloadShopsCsv(token)
      triggerDownload(blob, filename)
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Download failed')
    } finally {
      setDownloadingShops(false)
    }
  }

  function resetAddShopForm() {
    setNewShopName('')
    setNewShopLogoUrl(null)
    setNewShopLogoPreview(null)
    setShopLogoUploadError(null)
    setNewShopDescription('')
    setNewShopWebsiteUrl('')
    setAddShopError(null)
  }

  async function handleShopLogoUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !token) return
    setUploadingShopLogo(true)
    setShopLogoUploadError(null)
    try {
      const { image_url } = await api.uploadShopLogo(file, token)
      setNewShopLogoUrl(image_url)
      setNewShopLogoPreview(URL.createObjectURL(file))
    } catch (err) {
      setShopLogoUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploadingShopLogo(false)
      e.target.value = ''
    }
  }

  async function handleAddShop(e: FormEvent) {
    e.preventDefault()
    if (!token || !newShopName.trim()) return
    setAddingShop(true)
    setAddShopError(null)
    try {
      const shop = await api.createShop(
        {
          name: newShopName.trim(),
          logo_url: newShopLogoUrl ?? undefined,
          description: newShopDescription.trim() || undefined,
          website_url: newShopWebsiteUrl.trim() || undefined,
        },
        token,
      )
      setShops(prev => [...prev, shop].sort((a, b) => a.name.localeCompare(b.name)))
      resetAddShopForm()
      setShowAddShop(false)
    } catch (err) {
      setAddShopError(err instanceof Error ? err.message : 'Failed to add shop')
    } finally {
      setAddingShop(false)
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => navigate('/')}>← Back to chat</button>
        <h1 className={styles.title}>Admin Portal</h1>
      </header>

      {/* CSV Import — Products */}
      <section className={styles.importSection}>
        <h2 className={styles.sectionTitle}>Import Products via CSV</h2>
        <p className={styles.csvHint}>
          Required columns: <code>shop_name, product_name, price, quantity, image_url, description_json</code>
        </p>
        <div className={styles.csvActions}>
          <label className={styles.uploadLabel}>
            <input type="file" accept=".csv" onChange={handleCsvUpload} disabled={importing} hidden />
            <span className={`${styles.uploadBtn} ${importing ? styles.disabled : ''}`}>
              {importing ? 'Importing…' : 'Upload Products CSV'}
            </span>
          </label>
          <button
            type="button"
            className={styles.downloadBtn}
            onClick={handleDownloadProductsCsv}
            disabled={downloadingProducts}
          >
            {downloadingProducts ? 'Downloading…' : 'Download Products CSV'}
          </button>
          <button
            type="button"
            className={styles.deleteBtn}
            onClick={handleClearAllProducts}
          >
            Clear All Products
          </button>
        </div>
        {importError && (
          <div className={styles.importResult}>
            <span className={styles.errorText}>⚠️ {importError}</span>
          </div>
        )}
        {importResult && (
          <div className={styles.importResult}>
            <p>✅ {importResult.rows_added} added, {importResult.rows_updated} updated</p>
            {(importResult.errors?.length ?? 0) > 0 && (
              <div className={styles.errors}>
                <p>⚠️ {importResult.errors.length} errors:</p>
                <ul>
                  {importResult.errors.map((e, i) => (
                    <li key={i}>Row {e.row}: {e.error}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className={styles.addProductSection}>
          <button
            type="button"
            className={styles.seedBtn}
            onClick={() => setShowAddProduct(v => !v)}
          >
            {showAddProduct ? 'Cancel' : '+ Add Product'}
          </button>

          {showAddProduct && token && (
            <AddProductPanel
              shops={shops}
              token={token}
              onApproved={() => {
                api
                  .adminProducts(token, {
                    shopId: selectedShop,
                    limit: productPageSize,
                    offset: productOffset,
                    q: productSearch || undefined,
                  })
                  .then(page => {
                    setProducts(page.items)
                    setProductsTotal(page.total)
                  })
                setShowAddProduct(false)
                setTab('products')
              }}
            />
          )}
        </div>
      </section>

      {/* CSV Import — Shops */}
      <section className={styles.importSection}>
        <h2 className={styles.sectionTitle}>Import Shops via CSV</h2>
        <p className={styles.csvHint}>
          Required: <code>name</code> &nbsp;|&nbsp; Optional: <code>logo_url, description, website_url</code>
        </p>
        <div className={styles.csvActions}>
          <label className={styles.uploadLabel}>
            <input type="file" accept=".csv" onChange={handleShopCsvUpload} disabled={importingShops} hidden />
            <span className={`${styles.uploadBtn} ${importingShops ? styles.disabled : ''}`}>
              {importingShops ? 'Importing…' : 'Upload Shops CSV'}
            </span>
          </label>
          <button
            type="button"
            className={styles.downloadBtn}
            onClick={handleDownloadShopsCsv}
            disabled={downloadingShops}
          >
            {downloadingShops ? 'Downloading…' : 'Download Shops CSV'}
          </button>
        </div>
        {shopImportError && (
          <div className={styles.importResult}>
            <span className={styles.errorText}>⚠️ {shopImportError}</span>
          </div>
        )}
        {shopImportResult && (
          <div className={styles.importResult}>
            <p>✅ {shopImportResult.rows_added} added, {shopImportResult.rows_updated} updated</p>
            {(shopImportResult.errors?.length ?? 0) > 0 && (
              <div className={styles.errors}>
                <p>⚠️ {shopImportResult.errors.length} errors:</p>
                <ul>
                  {shopImportResult.errors.map((e, i) => (
                    <li key={i}>Row {e.row}: {e.error}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className={styles.addShopSection}>
          <button
            type="button"
            className={styles.seedBtn}
            onClick={() => {
              setShowAddShop(v => !v)
              if (showAddShop) resetAddShopForm()
            }}
          >
            {showAddShop ? 'Cancel' : '+ Add Shop'}
          </button>

          {showAddShop && (
            <form className={styles.addForm} onSubmit={handleAddShop}>
              <label className={styles.addLabel}>
                Shop name <span className={styles.required}>*</span>
                <input
                  className={styles.input}
                  value={newShopName}
                  onChange={e => setNewShopName(e.target.value)}
                  placeholder="e.g. Main Street Pottery"
                  required
                />
              </label>

              <label className={styles.addLabel}>
                Logo <span className={styles.optional}>(optional)</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleShopLogoUpload}
                  disabled={uploadingShopLogo}
                />
                {uploadingShopLogo && <span className={styles.csvHint}>Uploading…</span>}
                {shopLogoUploadError && <span className={styles.errorText}>{shopLogoUploadError}</span>}
                {newShopLogoPreview && (
                  <img src={newShopLogoPreview} alt="Logo preview" className={styles.previewImg} />
                )}
              </label>

              <label className={styles.addLabel}>
                Description <span className={styles.optional}>(optional)</span>
                <textarea
                  className={styles.textarea}
                  rows={3}
                  value={newShopDescription}
                  onChange={e => setNewShopDescription(e.target.value)}
                  placeholder="Short shop bio or tagline"
                />
              </label>

              <label className={styles.addLabel}>
                Website URL <span className={styles.optional}>(optional)</span>
                <input
                  className={styles.input}
                  type="url"
                  value={newShopWebsiteUrl}
                  onChange={e => setNewShopWebsiteUrl(e.target.value)}
                  placeholder="https://…"
                />
              </label>

              <button type="submit" className={styles.saveBtn} disabled={addingShop || uploadingShopLogo || !newShopName.trim()}>
                {addingShop ? 'Adding…' : 'Save Shop'}
              </button>
              {addShopError && <div className={styles.errorText}>{addShopError}</div>}
            </form>
          )}
        </div>
      </section>

      {downloadError && <div className={styles.errorText}>{downloadError}</div>}

      {/* Tabs */}
      <div className={styles.tabs}>
        <button className={`${styles.tab} ${tab === 'stats' ? styles.activeTab : ''}`} onClick={() => setTab('stats')}>
          Overview
        </button>
        <button className={`${styles.tab} ${tab === 'shops' ? styles.activeTab : ''}`} onClick={() => setTab('shops')}>
          Shops ({shops.length})
        </button>
        <button className={`${styles.tab} ${tab === 'products' ? styles.activeTab : ''}`} onClick={() => setTab('products')}>
          Products ({productsTotal})
        </button>
        <button className={`${styles.tab} ${tab === 'scrapers' ? styles.activeTab : ''}`} onClick={() => setTab('scrapers')}>
          Scrapers
        </button>
      </div>

      {tab === 'stats' && (
        <StatsPanel
          stats={stats}
          loading={statsLoading}
          embeddingRunning={embeddingRunning}
          embeddingProgress={embeddingProgress}
          onGenerateEmbeddings={handleGenerateEmbeddings}
          enrichRunning={enrichRunning}
          enrichProgress={enrichProgress}
          onEnrichProducts={handleEnrichProducts}
        />
      )}

      {tab === 'shops' && (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>ID</th><th>Name</th><th>Products</th><th>Website</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {shops.map(shop => (
                <tr key={shop.id}>
                  <td>{shop.id}</td>
                  <td>
                    {shop.logo_url && <img src={shop.logo_url} alt="" className={styles.shopLogo} />}
                    {shop.name}
                  </td>
                  <td>{shop.product_count ?? '—'}</td>
                  <td>{safeHref(shop.website_url) ? <a href={safeHref(shop.website_url)} target="_blank" rel="noopener noreferrer">Visit</a> : '—'}</td>
                  <td>
                    <button className={styles.deleteBtn} onClick={() => handleDeleteShop(shop.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'products' && (
        <>
          <div className={styles.filterBar}>
            <ShopSearchCombobox
              token={token!}
              value={selectedShop}
              onChange={(id) => { setSelectedShop(id); setProductOffset(0) }}
            />
            <form
              onSubmit={e => { e.preventDefault(); setProductSearch(productSearchInput.trim()) }}
              style={{ display: 'flex', gap: '0.5rem', flex: 1 }}
            >
              <input
                className={styles.input}
                value={productSearchInput}
                onChange={e => setProductSearchInput(e.target.value)}
                placeholder="Search products or shop name…"
                style={{ flex: 1 }}
              />
              {productSearch && (
                <button
                  type="button"
                  className={styles.deleteBtn}
                  onClick={() => { setProductSearchInput(''); setProductSearch('') }}
                >
                  Clear
                </button>
              )}
              <button type="submit" className={styles.uploadBtn}>Search</button>
            </form>
            <select
              className={styles.select}
              value={productPageSize}
              onChange={e => setProductPageSize(Number(e.target.value))}
            >
              <option value={50}>50 / page</option>
              <option value={100}>100 / page</option>
              <option value={250}>250 / page</option>
              <option value={1000}>1000 / page</option>
              <option value={100000}>All</option>
            </select>
          </div>
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>ID</th><th>Name</th><th>Shop</th><th>Price</th><th>Qty</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {products.map(p => {
                  const minPrice = p.price_range ? Number(p.price_range.min) : 0
                  const maxPrice = p.price_range ? Number(p.price_range.max) : 0
                  const totalQty = (p.variants ?? []).reduce((s, v) => s + (v.quantity ?? 0), 0)
                  return (
                    <tr key={p.id}>
                      <td>{p.id}</td>
                      <td className={styles.productNameCell}>
                        {p.image_url && <img src={p.image_url} alt="" className={styles.productThumb} />}
                        {p.name}
                        {(p.variants?.length ?? 0) > 1 && (
                          <span className={styles.tag} style={{ marginLeft: 8 }}>{p.variants.length} variants</span>
                        )}
                      </td>
                      <td>{p.shop_name}</td>
                      <td>
                        {minPrice === maxPrice
                          ? formatCurrency(minPrice)
                          : `${formatCurrency(minPrice)}–${formatCurrency(maxPrice)}`}
                      </td>
                      <td>{totalQty}</td>
                      <td>
                        <button className={styles.deleteBtn} onClick={() => handleDeleteProduct(p.id)}>Delete</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className={styles.filterBar} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem', opacity: 0.8 }}>
              {productsTotal === 0
                ? 'No products'
                : `Showing ${productOffset + 1}–${Math.min(productOffset + products.length, productsTotal)} of ${productsTotal}`}
            </span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                className={styles.uploadBtn}
                disabled={productOffset === 0}
                onClick={() => setProductOffset(o => Math.max(0, o - productPageSize))}
              >
                ← Prev
              </button>
              <button
                type="button"
                className={styles.uploadBtn}
                disabled={productOffset + products.length >= productsTotal}
                onClick={() => setProductOffset(o => o + productPageSize)}
              >
                Next →
              </button>
            </div>
          </div>
        </>
      )}

      {tab === 'scrapers' && token && (
        <ScrapersPanel token={token} shops={shops} />
      )}
    </div>
  )
}

// ── Scrapers Panel ────────────────────────────────────────────────────────

function ScrapersPanel({ token, shops: _shops }: { token: string; shops: Shop[] }) {
  const [url, setUrl] = useState('')
  const [shopNameOverride, setShopNameOverride] = useState('')
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [activeJob, setActiveJob] = useState<ScraperJobOut | null>(null)
  const [jobs, setJobs] = useState<ScraperJobOut[]>([])
  const [jobsLoading, setJobsLoading] = useState(true)
  const [rerunning, setRerunning] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)
  const [previewJobId, setPreviewJobId] = useState<number | null>(null)
  const [preview, setPreview] = useState<ScraperPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [deletingIngested, setDeletingIngested] = useState<number | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const logEndRef = useRef<HTMLDivElement | null>(null)

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeJob?.event_log])

  useEffect(() => {
    setJobsLoading(true)
    api.listScraperJobs(token).then(setJobs).catch(() => {}).finally(() => setJobsLoading(false))
  }, [token])

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  function startPolling(jobId: number) {
    stopPolling()
    pollRef.current = setInterval(async () => {
      try {
        const updated = await api.getScraperJob(jobId, token)
        setActiveJob(updated)
        // Update job in list too
        setJobs(prev => prev.map(j => j.id === jobId ? updated : j))
        if (updated.status !== 'pending' && updated.status !== 'running') {
          stopPolling()
          // Final refresh of job list
          api.listScraperJobs(token).then(setJobs).catch(() => {})
        }
      } catch { stopPolling() }
    }, 2000)
  }

  async function handleStart(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim()) return
    setStarting(true)
    setStartError(null)
    setActiveJob(null)
    try {
      const job = await api.startScraperJob(url.trim(), shopNameOverride.trim() || null, token)
      setActiveJob(job)
      setJobs(prev => [job, ...prev])
      startPolling(job.id)
      setUrl('')
      setShopNameOverride('')
    } catch (err: unknown) {
      setStartError(err instanceof Error ? err.message : 'Failed to start scraper')
    } finally {
      setStarting(false)
    }
  }

  async function handleRerun(jobId: number) {
    setRerunning(jobId)
    try {
      const job = await api.rerunScraperJob(jobId, token)
      setActiveJob(job)
      setJobs(prev => prev.map(j => j.id === jobId ? job : j))
      startPolling(jobId)
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Rerun failed')
    } finally {
      setRerunning(null)
    }
  }

  async function handlePreview(jobId: number) {
    if (previewJobId === jobId) { setPreviewJobId(null); setPreview(null); return }
    setPreviewJobId(jobId)
    setPreview(null)
    setPreviewLoading(true)
    try {
      const p = await api.previewScraperJob(jobId, token)
      setPreview(p)
    } catch { setPreview(null) }
    finally { setPreviewLoading(false) }
  }

  async function handleDeleteIngested(jobId: number) {
    const job = jobs.find(j => j.id === jobId)
    const summary = job?.result_summary
    const pCount = summary?.products_ingested ?? 0
    const sCount = summary?.shops_created ?? 0
    if (!confirm(`Delete ${pCount} products and ${sCount} shops ingested by job #${jobId}? This cannot be undone.`)) return
    setDeletingIngested(jobId)
    try {
      const result = await api.deleteIngestedByJob(jobId, token)
      alert(`Deleted ${result.products_deleted} products and ${result.shops_deleted} shops.`)
      setPreview(null)
      setPreviewJobId(null)
      // Refresh jobs list
      api.listScraperJobs(token).then(setJobs).catch(() => {})
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setDeletingIngested(null)
    }
  }

  async function handleDelete(jobId: number) {
    if (!confirm('Delete this scraper job and its saved script?')) return
    setDeleting(jobId)
    try {
      await api.deleteScraperJob(jobId, token)
      setJobs(prev => prev.filter(j => j.id !== jobId))
      if (activeJob?.id === jobId) { setActiveJob(null); stopPolling() }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setDeleting(null)
    }
  }

  const confidenceColor = (c: string) =>
    c === 'high' ? '#015237' : c === 'medium' ? '#be6e46' : '#c0392b'

  const statusIcon = (s: ScraperJobOut['status']) =>
    ({ pending: '⏳', running: '⟳', success: '✓', failed: '✗', cannot_scrape: '⚠' })[s] ?? '?'

  const logKindClass = (kind: ScraperLogEntry['kind']) =>
    ({ info: styles.scraperLog_info, success: styles.scraperLog_success, warn: styles.scraperLog_warn, error: styles.scraperLog_error, thinking: styles.scraperLog_thinking })[kind] ?? ''

  const report = activeJob?.result_summary ?? null
  const isRunning = activeJob?.status === 'running' || activeJob?.status === 'pending'

  return (
    <div className={styles.scrapersPanel}>
      {/* Start new scrape form */}
      <section className={styles.scraperFormSection}>
        <h2 className={styles.sectionTitle}>Build a New Scraper</h2>
        <form onSubmit={handleStart} className={styles.scraperForm}>
          <input
            className={styles.input}
            type="url"
            placeholder="https://shop.example.com/products"
            value={url}
            onChange={e => setUrl(e.target.value)}
            required
          />
          <input
            className={styles.input}
            type="text"
            placeholder="Shop name override (optional — auto-detected if blank)"
            value={shopNameOverride}
            onChange={e => setShopNameOverride(e.target.value)}
          />
          <button type="submit" className={styles.uploadBtn} disabled={starting || !url.trim()}>
            {starting ? 'Starting…' : 'Build Scraper'}
          </button>
        </form>
        {startError && <div className={styles.errorText}>{startError}</div>}
      </section>

      {/* Live progress panel */}
      {activeJob !== null && (
        <section className={styles.scraperProgressSection}>
          <div className={styles.scraperProgressHeader}>
            <h2 className={styles.sectionTitle} style={{ margin: 0 }}>
              Job #{activeJob.id} —{' '}
              {isRunning ? '⟳ Running…'
                : activeJob.status === 'success' ? '✓ Complete'
                : activeJob.status === 'cannot_scrape' ? '⚠ Cannot Scrape'
                : '✗ Failed'}
            </h2>
            {activeJob.seller_type && (
              <span className={styles.sellerTypeBadge}>{activeJob.seller_type} seller</span>
            )}
            {!isRunning && activeJob.script_id && (
              <button
                className={styles.rerunBtn}
                onClick={() => handleRerun(activeJob.id)}
                disabled={rerunning === activeJob.id}
              >
                {rerunning === activeJob.id ? '…' : '↺ Re-run Script'}
              </button>
            )}
          </div>

          {/* Live log */}
          <div className={styles.scraperLog}>
            {(activeJob.event_log ?? []).map((l, i) => (
              <div key={i} className={`${styles.scraperLogLine} ${logKindClass(l.kind)}`}>
                <span className={styles.scraperLogTime}>{l.ts}</span>
                {l.msg}
              </div>
            ))}
            {isRunning && (
              <div className={`${styles.scraperLogLine} ${styles.scraperLog_info}`}>
                <span className={styles.scraperLogTime}></span>
                <span className={styles.blinkDot}>●</span>
              </div>
            )}
            <div ref={logEndRef} />
          </div>

          {/* Cannot scrape */}
          {activeJob.status === 'cannot_scrape' && (
            <div className={styles.cannotScrapeBox}>
              <strong>I cannot build the correct scraping script to gather the necessary information from this site.</strong>
              {activeJob.failure_reason && (
                <p className={styles.cannotScrapeDetail}>{activeJob.failure_reason}</p>
              )}
            </div>
          )}

          {/* Verification report */}
          {report && activeJob.status === 'success' && (
            <div className={styles.verificationReport}>
              <div className={styles.reportHeader}>
                <span className={styles.confidenceBadge} style={{ background: confidenceColor(report.confidence) }}>
                  {report.confidence.toUpperCase()} confidence
                </span>
                {report.seller_type && <span className={styles.sellerTypeBadge}>{report.seller_type} seller</span>}
              </div>
              <div className={styles.reportStats}>
                <span><strong>{report.shops_created}</strong> shops created</span>
                {report.shops_updated > 0 && <span><strong>{report.shops_updated}</strong> shops updated</span>}
                <span><strong>{report.products_ingested}</strong> products</span>
                {report.products_updated > 0 && <span><strong>{report.products_updated}</strong> updated</span>}
                <span><strong>{report.variants_ingested}</strong> variants</span>
                <span>{report.attempts_used} attempt{report.attempts_used !== 1 ? 's' : ''}</span>
              </div>
              {report.fields_missing?.length > 0 && (
                <div className={styles.reportWarning}>Optional fields not found: {report.fields_missing.join(', ')}</div>
              )}
              {report.errors?.length > 0 && (
                <div className={styles.reportWarning}>{report.errors.length} row errors during ingest</div>
              )}
              {report.sample_products?.length > 0 && (
                <div className={styles.sampleProducts}>
                  <div className={styles.sampleTitle}>Sample products ingested</div>
                  <div className={styles.sampleGrid}>
                    {report.sample_products.map((p, i) => (
                      <div key={i} className={styles.sampleCard}>
                        {p.image_url && <img src={p.image_url} alt={p.name} className={styles.sampleImg} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />}
                        <div className={styles.sampleName}>{p.name}</div>
                        <div className={styles.sampleMeta}>{p.shop_name} · ${p.price}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* Jobs table */}
      <section className={styles.scraperJobsSection}>
        <h2 className={styles.sectionTitle}>Scraper Jobs</h2>
        {jobsLoading ? (
          <div className={styles.statsLoading}>Loading jobs…</div>
        ) : jobs.length === 0 ? (
          <div className={styles.statsLoading}>No scraper jobs yet. Start one above.</div>
        ) : (
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr><th>ID</th><th>URL</th><th>Seller</th><th>Status</th><th>Products</th><th>Started</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {jobs.map(job => (
                  <>
                  <tr key={job.id} style={{ cursor: 'pointer' }} onClick={() => setActiveJob(job)}>
                    <td>{job.id}</td>
                    <td className={styles.scraperUrlCell} title={job.url}>
                      {job.url.replace(/^https?:\/\//, '').substring(0, 50)}{job.url.replace(/^https?:\/\//, '').length > 50 ? '…' : ''}
                    </td>
                    <td>{job.seller_type || '—'}</td>
                    <td><span className={styles[`status_${job.status}`]}>{statusIcon(job.status)} {job.status.replace('_', ' ')}</span></td>
                    <td>{job.result_summary ? `${job.result_summary.products_ingested}p / ${job.result_summary.variants_ingested}v` : '—'}</td>
                    <td>{new Date(job.created_at).toLocaleDateString()}</td>
                    <td onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                        {job.status === 'success' && (
                          <button className={styles.previewBtn} onClick={() => handlePreview(job.id)}>
                            {previewJobId === job.id ? '▲ Hide' : '▼ Preview'}
                          </button>
                        )}
                        {job.script_id && (
                          <button className={styles.rerunBtn} onClick={() => handleRerun(job.id)} disabled={rerunning === job.id || job.status === 'running'}>
                            {rerunning === job.id ? '…' : '↺ Re-run'}
                          </button>
                        )}
                        {job.status === 'success' && (job.result_summary?.ingested_product_ids?.length ?? 0) > 0 && (
                          <button className={styles.deleteBtn} onClick={() => handleDeleteIngested(job.id)} disabled={deletingIngested === job.id} title="Delete all products/shops ingested by this job">
                            {deletingIngested === job.id ? '…' : '🗑 Rollback'}
                          </button>
                        )}
                        <button className={styles.deleteBtn} onClick={() => handleDelete(job.id)} disabled={deleting === job.id} title="Delete job record and saved script">
                          {deleting === job.id ? '…' : 'Delete'}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {previewJobId === job.id && (
                    <tr key={`preview-${job.id}`}>
                      <td colSpan={7} style={{ padding: 0 }}>
                        <div className={styles.previewPanel}>
                          {previewLoading ? (
                            <div className={styles.statsLoading}>Loading preview…</div>
                          ) : preview ? (
                            <>
                              <div className={styles.previewSummary}>
                                <strong>{preview.shop_count}</strong> shop{preview.shop_count !== 1 ? 's' : ''} ·{' '}
                                <strong>{preview.product_count}</strong> product{preview.product_count !== 1 ? 's' : ''}
                                {' '}ingested by this job
                              </div>
                              {preview.shops.length > 0 && (
                                <div className={styles.previewShops}>
                                  {preview.shops.map(s => (
                                    <span key={s.id} className={styles.previewShopChip}>
                                      {s.name} <span className={styles.shopSearchCount}>{s.product_count}p</span>
                                    </span>
                                  ))}
                                </div>
                              )}
                              {preview.products.length > 0 && (
                                <div className={styles.previewGrid}>
                                  {preview.products.map(p => (
                                    <div key={p.id} className={styles.sampleCard}>
                                      {p.image_url && <img src={p.image_url} alt={p.name} className={styles.sampleImg} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />}
                                      <div className={styles.sampleName}>{p.name}</div>
                                      <div className={styles.sampleMeta}>{p.shop_name} · ${p.price}{p.variant_count > 1 ? ` · ${p.variant_count}v` : ''}</div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </>
                          ) : <div className={styles.statsLoading}>No preview data available.</div>}
                        </div>
                      </td>
                    </tr>
                  )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

// ── Shop Search Combobox ──────────────────────────────────────────────────

function ShopSearchCombobox({
  token,
  value,
  onChange,
}: {
  token: string
  value: number | undefined
  onChange: (id: number | undefined, name: string) => void
}) {
  const [input, setInput] = useState('')
  const [suggestions, setSuggestions] = useState<Shop[]>([])
  const [open, setOpen] = useState(false)
  const [selectedName, setSelectedName] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Clear display name when value cleared externally
  useEffect(() => {
    if (value === undefined) { setInput(''); setSelectedName('') }
  }, [value])

  function handleInput(v: string) {
    setInput(v)
    setOpen(true)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await api.searchShops(v, token)
        setSuggestions(results)
      } catch { setSuggestions([]) }
    }, 180)
  }

  function handleSelect(shop: Shop) {
    setInput(shop.name)
    setSelectedName(shop.name)
    setSuggestions([])
    setOpen(false)
    onChange(shop.id, shop.name)
  }

  function handleClear() {
    setInput('')
    setSelectedName('')
    setSuggestions([])
    onChange(undefined, '')
  }

  return (
    <div ref={wrapRef} className={styles.shopSearchWrap}>
      <div className={styles.shopSearchInputWrap}>
        <input
          className={styles.input}
          placeholder="Search shops…"
          value={input}
          onChange={e => handleInput(e.target.value)}
          onFocus={() => { setOpen(true); handleInput(input) }}
          autoComplete="off"
        />
        {(input || value) && (
          <button type="button" className={styles.shopSearchClear} onClick={handleClear}>✕</button>
        )}
      </div>
      {open && suggestions.length > 0 && (
        <div className={styles.shopSearchDropdown}>
          {suggestions.map(s => (
            <div
              key={s.id}
              className={`${styles.shopSearchItem} ${s.id === value ? styles.shopSearchItemActive : ''}`}
              onMouseDown={() => handleSelect(s)}
            >
              <span className={styles.shopSearchName}>{s.name}</span>
              {s.product_count != null && (
                <span className={styles.shopSearchCount}>{s.product_count}p</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Stats Panel ───────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className={styles.statCard}>
      <div className={styles.statValue}>{value}</div>
      <div className={styles.statLabel}>{label}</div>
      {sub && <div className={styles.statSub}>{sub}</div>}
    </div>
  )
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className={styles.progressTrack}>
      <div className={styles.progressFill} style={{ width: `${Math.min(100, pct)}%`, background: color }} />
    </div>
  )
}

function EmbeddingProgressBar({ pct, running }: { pct: number; running: boolean }) {
  return (
    <div className={styles.progressTrack}>
      <div
        className={`${styles.progressFill} ${running ? styles.progressFillAnimated : ''}`}
        style={{
          width: `${Math.min(100, Math.max(0, pct))}%`,
          background: 'var(--ms-primary)',
          transition: running ? 'width 0.6s ease' : 'none',
        }}
      />
    </div>
  )
}

function StatsPanel({ stats, loading, embeddingRunning, embeddingProgress, onGenerateEmbeddings, enrichRunning, enrichProgress, onEnrichProducts }: {
  stats: AdminStats | null
  loading: boolean
  embeddingRunning: boolean
  embeddingProgress: { done: number; total: number; errors: number; elapsed_s: number; finished?: boolean } | null
  onGenerateEmbeddings: () => void
  enrichRunning: boolean
  enrichProgress: { done: number; total: number; errors: number; finished?: boolean } | null
  onEnrichProducts: () => void
}) {
  if (loading) return <div className={styles.statsLoading}>Loading statistics…</div>
  if (!stats) return <div className={styles.statsLoading}>No statistics available.</div>

  const maxShopCount = Math.max(...stats.top_shops.map(s => s.count), 1)
  const priceBuckets = [
    { label: 'Under $25', count: stats.price_buckets.under_25, color: '#7a9e7e' },
    { label: '$25–$50', count: stats.price_buckets['25_to_50'], color: '#015237' },
    { label: '$50–$100', count: stats.price_buckets['50_to_100'], color: '#be6e46' },
    { label: 'Over $100', count: stats.price_buckets.over_100, color: '#b8928a' },
  ]
  const totalPriceVariants = priceBuckets.reduce((s, b) => s + b.count, 0) || 1

  return (
    <div className={styles.statsPanel}>
      {/* Key metrics */}
      <section className={styles.statsSection}>
        <h2 className={styles.sectionTitle}>Database Overview</h2>
        <div className={styles.statGrid}>
          <StatCard label="Total Shops" value={stats.total_shops.toLocaleString()} />
          <StatCard label="Shops with Products" value={stats.shops_with_products.toLocaleString()} sub={`${stats.total_shops - stats.shops_with_products} empty`} />
          <StatCard label="Shops with Website" value={stats.shops_with_website.toLocaleString()} sub="external storefronts" />
          <StatCard label="Total Products" value={stats.total_products.toLocaleString()} />
          <StatCard label="Total Variants" value={stats.total_variants.toLocaleString()} sub={`avg ${stats.total_products ? (stats.total_variants / stats.total_products).toFixed(1) : 0} per product`} />
        </div>
      </section>

      {/* Health indicators */}
      <section className={styles.statsSection}>
        <h2 className={styles.sectionTitle}>Product Health</h2>
        <div className={styles.healthGrid}>
          <div className={styles.healthCard}>
            <div className={styles.healthHeader}>
              <span className={styles.healthLabel}>Embedding coverage</span>
              <span className={styles.healthPct}>
                {embeddingRunning && embeddingProgress && embeddingProgress.total > 0
                  ? `${Math.round(embeddingProgress.done / embeddingProgress.total * 100)}%`
                  : `${stats.pct_embedded}%`}
              </span>
            </div>
            <EmbeddingProgressBar
              pct={embeddingRunning && embeddingProgress && embeddingProgress.total > 0
                ? Math.round(embeddingProgress.done / embeddingProgress.total * 100)
                : stats.pct_embedded}
              running={embeddingRunning}
            />
            <div className={styles.healthSub}>
              {embeddingRunning && embeddingProgress
                ? (() => {
                    const { done, total, errors, elapsed_s } = embeddingProgress
                    const rate = elapsed_s > 0 ? done / elapsed_s : 0
                    const remaining = total - done
                    const etaSec = rate > 0 ? Math.ceil(remaining / rate) : null
                    const etaStr = etaSec === null ? '' : etaSec >= 60
                      ? ` · ~${Math.ceil(etaSec / 60)}m remaining`
                      : ` · ~${etaSec}s remaining`
                    return `${done} / ${total} embedded${errors > 0 ? ` · ${errors} errors` : ''}${etaStr}`
                  })()
                : embeddingProgress?.finished
                  ? embeddingProgress.done === 0 && embeddingProgress.errors > 0
                    ? `Failed — ${embeddingProgress.errors} errors. Check that OPENAI_API_KEY is set in backend .env and restart the server.`
                    : embeddingProgress.errors > 0
                      ? `Done — ${embeddingProgress.done} embedded, ${embeddingProgress.errors} failed`
                      : `Done — ${embeddingProgress.done} products embedded`
                  : `${stats.embedded_count.toLocaleString()} of ${stats.total_products.toLocaleString()} products have semantic embeddings`}
            </div>
            {embeddingProgress?.finished && embeddingProgress.done === 0 && embeddingProgress.errors > 0 && (
              <div className={styles.embedError}>
                OpenAI API key missing or invalid. Add <code>OPENAI_API_KEY=sk-...</code> to <code>backend/.env</code> and restart.
              </div>
            )}
            {!(embeddingProgress?.finished && embeddingProgress.done > 0) && (
              <button
                className={styles.embedBtn}
                onClick={onGenerateEmbeddings}
                disabled={embeddingRunning || stats.pct_embedded === 100}
              >
                {embeddingRunning
                  ? 'Running…'
                  : stats.pct_embedded === 100
                    ? 'All embedded ✓'
                    : `Generate embeddings (${(stats.total_products - stats.embedded_count).toLocaleString()} missing)`}
              </button>
            )}
          </div>
          <div className={styles.healthCard}>
            <div className={styles.healthHeader}>
              <span className={styles.healthLabel}>Product enrichment</span>
            </div>
            {enrichRunning && enrichProgress && enrichProgress.total > 0 && (
              <div className={styles.healthSub}>
                {enrichProgress.done} / {enrichProgress.total} enriched
                {enrichProgress.errors > 0 ? ` (${enrichProgress.errors} errors)` : ''}
              </div>
            )}
            <button
              className={styles.embedBtn}
              onClick={onEnrichProducts}
              disabled={enrichRunning}
              style={{ marginTop: 8 }}
            >
              {enrichRunning ? 'Enriching…' : 'Enrich Products (GPT-4o-mini)'}
            </button>
            {enrichProgress?.finished && (
              <div className={styles.healthSub} style={{ color: '#015237' }}>
                Done — {enrichProgress.done} enriched, {enrichProgress.errors} errors
              </div>
            )}
          </div>
          <div className={styles.healthCard}>
            <div className={styles.healthHeader}>
              <span className={styles.healthLabel}>In-stock rate</span>
              <span className={styles.healthPct}>{stats.pct_in_stock}%</span>
            </div>
            <ProgressBar pct={stats.pct_in_stock} color="#7a9e7e" />
            <div className={styles.healthSub}>{stats.in_stock_count.toLocaleString()} of {stats.total_products.toLocaleString()} products have stock available</div>
          </div>
        </div>
      </section>

      {/* Price distribution */}
      <section className={styles.statsSection}>
        <h2 className={styles.sectionTitle}>Price Distribution</h2>
        <div className={styles.priceGrid}>
          {priceBuckets.map(b => (
            <div key={b.label} className={styles.priceBucket}>
              <div className={styles.priceBucketBar}>
                <div
                  className={styles.priceBucketFill}
                  style={{ height: `${Math.round(b.count / totalPriceVariants * 100)}%`, background: b.color }}
                  title={`${b.count} variants`}
                />
              </div>
              <div className={styles.priceBucketLabel}>{b.label}</div>
              <div className={styles.priceBucketCount}>{b.count.toLocaleString()}</div>
              <div className={styles.priceBucketPct}>{Math.round(b.count / totalPriceVariants * 100)}%</div>
            </div>
          ))}
        </div>
      </section>

      {/* Top shops bar chart */}
      {stats.top_shops.length > 0 && (
        <section className={styles.statsSection}>
          <h2 className={styles.sectionTitle}>Top Shops by Product Count</h2>
          <div className={styles.shopBars}>
            {stats.top_shops.map(s => (
              <div key={s.name} className={styles.shopBarRow}>
                <div className={styles.shopBarName} title={s.name}>{s.name}</div>
                <div className={styles.shopBarTrack}>
                  <div
                    className={styles.shopBarFill}
                    style={{ width: `${Math.round(s.count / maxShopCount * 100)}%` }}
                  />
                </div>
                <div className={styles.shopBarCount}>{s.count}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Option types */}
      {stats.distinct_option_types.length > 0 && (
        <section className={styles.statsSection}>
          <h2 className={styles.sectionTitle}>Variant Option Types</h2>
          <div className={styles.optionChips}>
            {stats.distinct_option_types.map(opt => (
              <span key={opt} className={styles.optionChip}>{opt}</span>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ── AI Listing Agent panel ────────────────────────────────────────────────

type StageState = 'idle' | 'start' | 'done' | 'error'

interface StageInfo {
  status: StageState
  data?: Record<string, unknown>
  error?: string
}

const STAGE_LABELS: Record<ListingStage, string> = {
  vision: 'Vision extraction',
  market: 'Market research',
  writer: 'Description writer',
  verify: 'Verify & confirm',
  image_enhance: 'Photo enhancement',
}

function AddProductPanel({
  shops,
  token,
  onApproved,
}: {
  shops: Shop[]
  token: string
  onApproved: () => void
}) {
  const [sellerId, setSellerId] = useState<number | ''>('')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [qtyInput, setQtyInput] = useState('')
  const [priceInput, setPriceInput] = useState('')
  const [stages, setStages] = useState<Record<ListingStage, StageInfo>>({
    vision: { status: 'idle' },
    market: { status: 'idle' },
    writer: { status: 'idle' },
    verify: { status: 'idle' },
    image_enhance: { status: 'idle' },
  })
  const [thinkingByStage, setThinkingByStage] = useState<Partial<Record<ListingStage, string>>>({})
  const [livePreviewImages, setLivePreviewImages] = useState<{ enhanced?: string; in_use?: string }>({})
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [draft, setDraft] = useState<ListingDraft | null>(null)
  const [approving, setApproving] = useState(false)
  const [approveError, setApproveError] = useState<string | null>(null)

  const canSave = sellerId !== '' && !!imageUrl && !generating

  function resetForm() {
    setSellerId('')
    setImageUrl(null)
    setImagePreview(null)
    setUploadError(null)
    setNotes('')
    setQtyInput('')
    setPriceInput('')
    setGenError(null)
    setDraft(null)
    setStages({
      vision: { status: 'idle' },
      market: { status: 'idle' },
      writer: { status: 'idle' },
      verify: { status: 'idle' },
      image_enhance: { status: 'idle' },
    })
    setThinkingByStage({})
    setLivePreviewImages({})
    setApproveError(null)
  }

  async function handleImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadError(null)
    try {
      const { image_url } = await api.uploadListingImage(file, token)
      setImageUrl(image_url)
      setImagePreview(URL.createObjectURL(file))
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  async function runGeneration() {
    if (sellerId === '' || !imageUrl) return
    setGenerating(true)
    setGenError(null)
    setDraft(null)
    setStages({
      vision: { status: 'idle' },
      market: { status: 'idle' },
      writer: { status: 'idle' },
      verify: { status: 'idle' },
      image_enhance: { status: 'idle' },
    })
    setThinkingByStage({})
    setLivePreviewImages({})
    try {
      await api.streamListingDraft(
        {
          shop_id: Number(sellerId),
          image_url: imageUrl,
          user_text: notes.trim() || undefined,
          quantity: qtyInput.trim() ? Number(qtyInput) : undefined,
          price: priceInput.trim() ? Number(priceInput) : undefined,
        },
        token,
        evt => {
          if (evt.type === 'stage') {
            setStages(prev => ({
              ...prev,
              [evt.stage]: { status: evt.status, data: evt.data, error: evt.error },
            }))
          } else if (evt.type === 'thinking') {
            setThinkingByStage(prev => ({
              ...prev,
              [evt.stage]: (prev[evt.stage] ?? '') + evt.content,
            }))
          } else if (evt.type === 'image') {
            setLivePreviewImages(prev => ({ ...prev, [evt.kind]: evt.url }))
          } else if (evt.type === 'draft') {
            setDraft(evt.draft)
          } else if (evt.type === 'error') {
            setGenError(evt.error)
          }
        },
      )
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    await runGeneration()
  }

  async function handleApprove() {
    if (!draft || sellerId === '') return
    setApproving(true)
    setApproveError(null)
    try {
      await api.approveListing(
        {
          shop_id: Number(sellerId),
          name: draft.name,
          price: draft.price,
          quantity: draft.quantity,
          image_url: draft.image_url,
          description: {
            ...draft.description,
            images: draft.images ?? draft.description.images,
          } as Record<string, unknown>,
        },
        token,
      )
      resetForm()
      onApproved()
    } catch (err) {
      setApproveError(err instanceof Error ? err.message : 'Approve failed')
    } finally {
      setApproving(false)
    }
  }

  function updateDraft<K extends keyof ListingDraft>(key: K, value: ListingDraft[K]) {
    setDraft(prev => (prev ? { ...prev, [key]: value } : prev))
  }

  return (
    <>
      <form className={styles.addForm} onSubmit={handleSave}>
        <label className={styles.addLabel}>
          Seller profile <span className={styles.required}>*</span>
          <select
            className={styles.select}
            value={sellerId}
            onChange={e => setSellerId(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">— choose a seller —</option>
            {shops.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>

        <label className={styles.addLabel}>
          Product photo <span className={styles.required}>*</span>
          <input type="file" accept="image/*" onChange={handleImage} disabled={uploading} />
          {uploading && <span className={styles.csvHint}>Uploading…</span>}
          {uploadError && <span className={styles.errorText}>{uploadError}</span>}
          {imagePreview && (
            <img src={imagePreview} alt="preview" className={styles.previewImg} />
          )}
        </label>

        <label className={styles.addLabel}>
          Notes <span className={styles.optional}>(optional)</span>
          <textarea
            className={styles.textarea}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Anything the agent should know — brand, condition, materials…"
            rows={3}
          />
        </label>

        <label className={styles.addLabel}>
          Quantity <span className={styles.optional}>(optional, default 1)</span>
          <input
            type="number"
            min={1}
            className={styles.input}
            value={qtyInput}
            onChange={e => setQtyInput(e.target.value)}
            placeholder="1"
          />
        </label>

        <label className={styles.addLabel}>
          Price <span className={styles.optional}>(optional, agent decides if blank)</span>
          <input
            type="number"
            min={0}
            step="0.01"
            className={styles.input}
            value={priceInput}
            onChange={e => setPriceInput(e.target.value)}
            placeholder="agent decides if blank"
          />
        </label>

        <button type="submit" className={styles.saveBtn} disabled={!canSave}>
          {generating ? 'Saving…' : 'Save Product'}
        </button>
        {genError && <div className={styles.errorText}>{genError}</div>}
      </form>

      {/* Stage timeline + live thinking */}
      {(generating || draft) && (
        <>
          <div className={styles.stageTimeline}>
            {(Object.keys(STAGE_LABELS) as ListingStage[]).map(stage => {
              const s = stages[stage]
              const icon =
                s.status === 'done' ? '✓' :
                s.status === 'error' ? '!' :
                s.status === 'start' ? '…' : '·'
              return (
                <div key={stage} className={`${styles.stageCard} ${styles[`stage_${s.status}`] ?? ''}`}>
                  <div className={styles.stageIcon}>{icon}</div>
                  <div>
                    <div className={styles.stageLabel}>{STAGE_LABELS[stage]}</div>
                    {s.error && <div className={styles.errorText}>{s.error}</div>}
                  </div>
                </div>
              )
            })}
          </div>

          {Object.keys(thinkingByStage).length > 0 && (
            <details className={styles.thinkingPanel} open={generating}>
              <summary className={styles.thinkingSummary}>
                {generating ? 'Agent thinking…' : 'Agent thinking trace'}
              </summary>
              <div className={styles.thinkingBody}>
                {(Object.keys(STAGE_LABELS) as ListingStage[]).map(stage => {
                  const text = thinkingByStage[stage]
                  if (!text) return null
                  return (
                    <section key={stage} className={styles.thinkingStage}>
                      <h4 className={styles.thinkingStageTitle}>{STAGE_LABELS[stage]}</h4>
                      <pre className={styles.thinkingText}>{text}</pre>
                    </section>
                  )
                })}
              </div>
            </details>
          )}
        </>
      )}

      {/* Live image preview while the image stage runs */}
      {generating && (livePreviewImages.enhanced || livePreviewImages.in_use) && (
        <div className={styles.imageGallery}>
          {livePreviewImages.enhanced && (
            <figure className={styles.imageFigure}>
              <img src={livePreviewImages.enhanced} alt="enhanced" className={styles.draftImg} />
              <figcaption className={styles.imageCaption}>Enhanced photo</figcaption>
            </figure>
          )}
          {livePreviewImages.in_use && (
            <figure className={styles.imageFigure}>
              <img src={livePreviewImages.in_use} alt="in use" className={styles.draftImg} />
              <figcaption className={styles.imageCaption}>In use</figcaption>
            </figure>
          )}
        </div>
      )}

      {/* Editable draft card */}
      {draft && (
        <div className={styles.draftCard}>
          <h3 className={styles.sectionTitle}>Review listing</h3>
          {(draft.images?.enhanced_url || draft.images?.in_use_url || draft.image_url) && (
            <div className={styles.imageGallery}>
              {(draft.images?.enhanced_url ?? draft.image_url) && (
                <figure className={styles.imageFigure}>
                  <img
                    src={draft.images?.enhanced_url ?? draft.image_url ?? ''}
                    alt="enhanced product"
                    className={styles.draftImg}
                  />
                  <figcaption className={styles.imageCaption}>Enhanced photo</figcaption>
                </figure>
              )}
              {draft.images?.in_use_url && (
                <figure className={styles.imageFigure}>
                  <img src={draft.images.in_use_url} alt="in use" className={styles.draftImg} />
                  <figcaption className={styles.imageCaption}>In use</figcaption>
                </figure>
              )}
            </div>
          )}

          {draft.flags.length > 0 && (
            <ul className={styles.flagList}>
              {draft.flags.map((f, i) => (
                <li key={i}><strong>{f.field}:</strong> {f.issue}</li>
              ))}
            </ul>
          )}

          <label className={styles.addLabel}>
            Title
            <input
              className={styles.input}
              value={draft.name}
              onChange={e => updateDraft('name', e.target.value)}
            />
          </label>

          <div className={styles.addRow}>
            <label className={styles.addLabel}>
              Price ($)
              <input
                type="number"
                step="0.01"
                className={styles.input}
                value={draft.price}
                onChange={e => updateDraft('price', e.target.value)}
              />
            </label>
            <label className={styles.addLabel}>
              Quantity
              <input
                type="number"
                min={1}
                className={styles.input}
                value={draft.quantity}
                onChange={e => updateDraft('quantity', Number(e.target.value) || 1)}
              />
            </label>
          </div>

          <label className={styles.addLabel}>
            Summary
            <textarea
              className={styles.textarea}
              rows={2}
              value={draft.description.summary ?? ''}
              onChange={e => setDraft(prev => prev ? { ...prev, description: { ...prev.description, summary: e.target.value } } : prev)}
            />
          </label>

          <label className={styles.addLabel}>
            Description
            <textarea
              className={styles.textarea}
              rows={5}
              value={draft.description.long ?? ''}
              onChange={e => setDraft(prev => prev ? { ...prev, description: { ...prev.description, long: e.target.value } } : prev)}
            />
          </label>

          <label className={styles.addLabel}>
            Tags (comma-separated)
            <input
              className={styles.input}
              value={(draft.tags ?? []).join(', ')}
              onChange={e => updateDraft('tags', e.target.value.split(',').map(t => t.trim()).filter(Boolean))}
            />
          </label>

          {draft.description.market_comps && draft.description.market_comps.length > 0 && (
            <details className={styles.compsDetails}>
              <summary>Market comps ({draft.description.market_comps.length})</summary>
              <ul>
                {draft.description.market_comps.map((c, i) => (
                  <li key={i}>
                    {safeHref(c.url) ? <a href={safeHref(c.url)} target="_blank" rel="noopener noreferrer">{c.title ?? 'comp'}</a> : (c.title ?? 'comp')}
                    {typeof c.price === 'number' ? ` — $${c.price.toFixed(2)}` : ''}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className={styles.addRow}>
            <button type="button" className={styles.saveBtn} onClick={handleApprove} disabled={approving}>
              {approving ? 'Saving…' : 'Approve & publish'}
            </button>
            <button type="button" className={styles.reseedBtn} onClick={() => void runGeneration()} disabled={generating || !canSave}>
              Regenerate
            </button>
          </div>
          {approveError && <div className={styles.errorText}>{approveError}</div>}
        </div>
      )}
    </>
  )
}
