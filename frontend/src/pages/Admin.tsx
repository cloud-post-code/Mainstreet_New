import { useEffect, useState, ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { api, Shop, Product } from '../api'
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
  const [tab, setTab] = useState<'shops' | 'products'>('shops')

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

  async function handleSeed() {
    if (!token || !confirm('Seed the database with 10 shops and 500 products?')) return
    setSeeding(true)
    setSeedResult(null)
    try {
      const result = await api.seedDatabase(token)
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
            <p className={styles.csvHint}>Populate with 10 shops and 500 sample products. Only runs if no shops exist.</p>
          </div>
          <button className={styles.seedBtn} onClick={handleSeed} disabled={seeding}>
            {seeding ? 'Seeding…' : 'Seed Database'}
          </button>
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
