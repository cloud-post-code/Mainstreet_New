import { useEffect, useState, ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { api, Shop, Product, ListingDraft, ListingStage } from '../api'
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
  const [selectedShop, setSelectedShop] = useState<number | undefined>()
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [importing, setImporting] = useState(false)
  const [shopImportResult, setShopImportResult] = useState<ImportResult | null>(null)
  const [importingShops, setImportingShops] = useState(false)
  const [seedResult, setSeedResult] = useState<string | null>(null)
  const [seeding, setSeeding] = useState(false)
  const [tab, setTab] = useState<'shops' | 'products' | 'add'>('shops')

  useEffect(() => {
    if (!token) return
    api.adminShops(token).then(setShops)
  }, [token])

  useEffect(() => {
    if (!token) return
    api.adminProducts(token, selectedShop).then(setProducts)
  }, [token, selectedShop])

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
      api.adminProducts(token, selectedShop).then(setProducts)
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

  async function handleSeed(force = false) {
    const msg = force
      ? 'Re-seed will delete the 10 default shops and re-create them with 500 products. Continue?'
      : 'Seed the database with 10 shops and 500 sample products?'
    if (!token || !confirm(msg)) return
    setSeeding(true)
    setSeedResult(null)
    try {
      const result = await api.seedDatabase(token, force)
      setSeedResult(result.message)
      api.adminShops(token).then(setShops)
      api.adminProducts(token, selectedShop).then(setProducts)
    } catch (err: unknown) {
      setSeedResult(err instanceof Error ? err.message : 'Seed failed')
    } finally {
      setSeeding(false)
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => navigate('/')}>← Back to chat</button>
        <h1 className={styles.title}>Admin Portal</h1>
      </header>

      {/* Seed Database */}
      <section className={styles.importSection}>
        <div className={styles.seedHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Seed Database</h2>
            <p className={styles.csvHint}>Populate with 10 shops and 500 sample products.</p>
          </div>
          <div className={styles.seedActions}>
            <button className={styles.seedBtn} onClick={() => handleSeed(false)} disabled={seeding}>
              {seeding ? 'Seeding…' : 'Seed Database'}
            </button>
            {shops.length > 0 && (
              <button className={styles.reseedBtn} onClick={() => handleSeed(true)} disabled={seeding} title="Delete default shops and re-create from scratch">
                Re-seed
              </button>
            )}
          </div>
        </div>
        {seedResult && <div className={styles.importResult}><p>{seedResult}</p></div>}
      </section>

      {/* CSV Import — Products */}
      <section className={styles.importSection}>
        <h2 className={styles.sectionTitle}>Import Products via CSV</h2>
        <p className={styles.csvHint}>
          Required columns: <code>shop_name, product_name, price, quantity, image_url, description_json</code>
        </p>
        <label className={styles.uploadLabel}>
          <input type="file" accept=".csv" onChange={handleCsvUpload} disabled={importing} hidden />
          <span className={`${styles.uploadBtn} ${importing ? styles.disabled : ''}`}>
            {importing ? 'Importing…' : 'Upload Products CSV'}
          </span>
        </label>
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
      </section>

      {/* CSV Import — Shops */}
      <section className={styles.importSection}>
        <h2 className={styles.sectionTitle}>Import Shops via CSV</h2>
        <p className={styles.csvHint}>
          Required: <code>name</code> &nbsp;|&nbsp; Optional: <code>logo_url, description, website_url</code>
        </p>
        <label className={styles.uploadLabel}>
          <input type="file" accept=".csv" onChange={handleShopCsvUpload} disabled={importingShops} hidden />
          <span className={`${styles.uploadBtn} ${importingShops ? styles.disabled : ''}`}>
            {importingShops ? 'Importing…' : 'Upload Shops CSV'}
          </span>
        </label>
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
      </section>

      {/* Tabs */}
      <div className={styles.tabs}>
        <button className={`${styles.tab} ${tab === 'shops' ? styles.activeTab : ''}`} onClick={() => setTab('shops')}>
          Shops ({shops.length})
        </button>
        <button className={`${styles.tab} ${tab === 'products' ? styles.activeTab : ''}`} onClick={() => setTab('products')}>
          Products ({products.length})
        </button>
        <button className={`${styles.tab} ${tab === 'add' ? styles.activeTab : ''}`} onClick={() => setTab('add')}>
          + Add Product
        </button>
      </div>

      {tab === 'add' && token && (
        <AddProductPanel
          shops={shops}
          token={token}
          onApproved={() => {
            api.adminProducts(token, selectedShop).then(setProducts)
            setTab('products')
          }}
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
                  <td>{shop.website_url ? <a href={shop.website_url} target="_blank" rel="noreferrer">Visit</a> : '—'}</td>
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
          </div>
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>ID</th><th>Name</th><th>Shop</th><th>Price</th><th>Qty</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {products.map(p => (
                  <tr key={p.id}>
                    <td>{p.id}</td>
                    <td className={styles.productNameCell}>
                      {p.image_url && <img src={p.image_url} alt="" className={styles.productThumb} />}
                      {p.name}
                    </td>
                    <td>{p.shop_name}</td>
                    <td>${Number(p.price).toFixed(2)}</td>
                    <td>{p.quantity}</td>
                    <td>
                      <button className={styles.deleteBtn} onClick={() => handleDeleteProduct(p.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
  })
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [draft, setDraft] = useState<ListingDraft | null>(null)
  const [approving, setApproving] = useState(false)
  const [approveError, setApproveError] = useState<string | null>(null)

  const canGenerate = sellerId !== '' && !!imageUrl && !generating

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

  async function handleGenerate() {
    if (sellerId === '' || !imageUrl) return
    setGenerating(true)
    setGenError(null)
    setDraft(null)
    setStages({
      vision: { status: 'idle' },
      market: { status: 'idle' },
      writer: { status: 'idle' },
      verify: { status: 'idle' },
    })
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
          description: draft.description as Record<string, unknown>,
        },
        token,
      )
      // Reset for next listing
      setDraft(null)
      setImageUrl(null)
      setImagePreview(null)
      setNotes('')
      setQtyInput('')
      setPriceInput('')
      setStages({
        vision: { status: 'idle' },
        market: { status: 'idle' },
        writer: { status: 'idle' },
        verify: { status: 'idle' },
      })
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
    <section className={styles.importSection}>
      <h2 className={styles.sectionTitle}>AI-Assisted Product Listing</h2>
      <p className={styles.csvHint}>
        Select a seller, upload a photo, optionally add notes. The agent will draft a listing for review.
      </p>

      <div className={styles.addForm}>
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

        <fieldset className={styles.addFieldset} disabled={sellerId === ''}>
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

          <div className={styles.addRow}>
            <label className={styles.addLabel}>
              Quantity <span className={styles.optional}>(default 1)</span>
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
              Price <span className={styles.optional}>(agent decides if blank)</span>
              <input
                type="number"
                min={0}
                step="0.01"
                className={styles.input}
                value={priceInput}
                onChange={e => setPriceInput(e.target.value)}
                placeholder="agent decides"
              />
            </label>
          </div>

          <button
            className={styles.seedBtn}
            onClick={handleGenerate}
            disabled={!canGenerate}
          >
            {generating ? 'Generating…' : 'Generate Listing'}
          </button>
          {genError && <div className={styles.errorText}>{genError}</div>}
        </fieldset>
      </div>

      {/* Stage timeline */}
      {(generating || draft) && (
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
      )}

      {/* Editable draft card */}
      {draft && (
        <div className={styles.draftCard}>
          <h3 className={styles.sectionTitle}>Review listing</h3>
          {draft.image_url && (
            <img src={draft.image_url} alt="" className={styles.draftImg} />
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
                    {c.url ? <a href={c.url} target="_blank" rel="noreferrer">{c.title ?? 'comp'}</a> : (c.title ?? 'comp')}
                    {typeof c.price === 'number' ? ` — $${c.price.toFixed(2)}` : ''}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className={styles.addRow}>
            <button className={styles.seedBtn} onClick={handleApprove} disabled={approving}>
              {approving ? 'Saving…' : 'Approve & publish'}
            </button>
            <button className={styles.reseedBtn} onClick={handleGenerate} disabled={generating}>
              Regenerate
            </button>
          </div>
          {approveError && <div className={styles.errorText}>{approveError}</div>}
        </div>
      )}
    </section>
  )
}
