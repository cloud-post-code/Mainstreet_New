import { useEffect, useState, ChangeEvent, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { api, Shop, Product, ListingDraft, ListingStage } from '../api'
import { safeHref } from '../lib/safeHref'
import styles from './Admin.module.css'

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
  const [shopImportResult, setShopImportResult] = useState<ImportResult | null>(null)
  const [importingShops, setImportingShops] = useState(false)
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
  const [tab, setTab] = useState<'shops' | 'products'>('shops')

  useEffect(() => {
    if (!token) return
    api.adminShops(token).then(setShops)
  }, [token])

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

  async function handleShopCsvUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !token) return
    setImportingShops(true)
    setShopImportResult(null)
    try {
      const result = await api.importShopsCsv(file, token)
      setShopImportResult(result)
      api.adminShops(token).then(setShops)
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
        </div>
        {importResult && (
          <div className={styles.importResult}>
            <p>✅ {importResult.rows_added} added, {importResult.rows_updated} updated</p>
            {importResult.errors.length > 0 && (
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
        {shopImportResult && (
          <div className={styles.importResult}>
            <p>✅ {shopImportResult.rows_added} added, {shopImportResult.rows_updated} updated</p>
            {shopImportResult.errors.length > 0 && (
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
        <button className={`${styles.tab} ${tab === 'shops' ? styles.activeTab : ''}`} onClick={() => setTab('shops')}>
          Shops ({shops.length})
        </button>
        <button className={`${styles.tab} ${tab === 'products' ? styles.activeTab : ''}`} onClick={() => setTab('products')}>
          Products ({productsTotal})
        </button>
      </div>

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
            <select className={styles.select} value={selectedShop ?? ''} onChange={e => setSelectedShop(e.target.value ? Number(e.target.value) : undefined)}>
              <option value="">All shops</option>
              {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
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
                          ? `$${minPrice.toFixed(2)}`
                          : `$${minPrice.toFixed(2)}–$${maxPrice.toFixed(2)}`}
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
