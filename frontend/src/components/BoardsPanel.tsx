import { useEffect, useState } from 'react'
import { api, BoardNote, BoardVibe, MasonSavedProduct } from '../api'
import { useBoardsState } from '../mason/useBoardsState'
import { MasonMemory } from '../mason/useMasonMemory'
import ProductModal, { ProductModalData } from './ProductModal'
import styles from './BoardsPanel.module.css'

function getBoardInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('')
}

interface BoardsPanelProps {
  memory: MasonMemory
  token: string
}

export default function BoardsPanel({ memory, token }: BoardsPanelProps) {
  const {
    selectedBoardId, setSelectedBoardId,
    boardDetail, setBoardDetail,
    boardTab, setBoardTab,
    showAddBoard, setShowAddBoard,
    newBoardName, setNewBoardName,
    newBoardDesc, setNewBoardDesc,
    newBoardImagePreview,
    addingBoard,
    newBoardImageRef,
    newNoteText, setNewNoteText,
    addingNote,
    detailLoading,
    uploadingCover,
    coverInputRef,
    handleAddBoard,
    handleNewBoardImageChange,
    handleDeleteBoard,
    handleCoverUpload,
    handleAddNote,
    handleDeleteNote,
    handleRemoveProduct,
    resetNewBoardForm,
  } = useBoardsState(memory, token)

  const selectedBoard = memory.boards.find(b => b.id === selectedBoardId)
  const [modalProduct, setModalProduct] = useState<ProductModalData | null>(null)
  const [editingName, setEditingName] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  // Vibes state
  const [boardVibes, setBoardVibes] = useState<BoardVibe[]>([])
  const [vibesLoading, setVibesLoading] = useState(false)

  // Pinterest state
  const [pinterestStatus, setPinterestStatus] = useState<{ connected: boolean; username?: string; profile_image?: string } | null>(null)
  const [importingPinterest, setImportingPinterest] = useState(false)

  // Load Pinterest status on mount
  useEffect(() => {
    if (!token) return
    api.getPinterestStatus(token).then(setPinterestStatus).catch(() => {})
  }, [token])

  // Load vibes when a board is selected and we switch to the vibes tab
  useEffect(() => {
    if (!selectedBoardId || boardTab !== 'vibes') return
    setVibesLoading(true)
    api.getBoardVibes(selectedBoardId, token)
      .then(setBoardVibes)
      .catch(() => setBoardVibes([]))
      .finally(() => setVibesLoading(false))
  }, [selectedBoardId, boardTab, token])

  const startEdit = () => {
    if (!selectedBoard) return
    setEditName(selectedBoard.name)
    setEditDesc(selectedBoard.description ?? '')
    setEditingName(true)
  }

  const saveEdit = async () => {
    if (!selectedBoard || !editName.trim()) return
    setSavingEdit(true)
    try {
      await api.updateBoard(selectedBoard.id, { name: editName.trim(), description: editDesc.trim() || null }, token)
      await memory.refresh()
      setEditingName(false)
    } catch (e) {
      console.error('saveEdit failed', e)
    } finally {
      setSavingEdit(false)
    }
  }

  const handleDeleteVibe = async (vibeId: number) => {
    if (!selectedBoardId) return
    await api.deleteBoardVibe(selectedBoardId, vibeId, token).catch(() => {})
    setBoardVibes(prev => prev.filter(v => v.id !== vibeId))
  }

  const handleImportPinterest = async () => {
    if (!token || importingPinterest) return
    setImportingPinterest(true)
    try {
      const result = await api.importPinterest({}, token)
      alert(`Imported ${result.imported} board${result.imported === 1 ? '' : 's'} from Pinterest.`)
      await memory.refresh()
    } catch (e) {
      alert('Pinterest import failed. Please try again.')
    } finally {
      setImportingPinterest(false)
    }
  }

  const handleConnectPinterest = () => {
    const apiBase = (import.meta.env.VITE_API_URL ?? 'https://backend-production-c5f5.up.railway.app')
    window.location.href = `${apiBase}/api/pinterest/connect?token=${token}`
  }

  // Board detail view
  if (selectedBoard) {
    const coverUrl = boardDetail?.cover_image_url ?? selectedBoard.cover_image_url ?? selectedBoard.first_product_image_url
    return (
      <>
      <div className={styles.boards}>
        <div className={styles.back}>
          <button className={styles.backBtn} onClick={() => { setSelectedBoardId(null); setBoardDetail(null); setEditingName(false) }}>
            ← Boards
          </button>
          <div className={styles.backActions}>
            {!selectedBoard.is_default && (
              <button className={styles.editBtn} onClick={startEdit} title="Edit board">✏️</button>
            )}
            {!selectedBoard.is_default && (
              <button className={styles.deleteBtn} onClick={() => handleDeleteBoard(selectedBoard.id)}>
                Delete
              </button>
            )}
          </div>
        </div>

        {/* Cover image */}
        <div className={styles.coverArea}>
          {coverUrl ? (
            <img className={styles.coverImg} src={coverUrl} alt="" />
          ) : (
            <div className={styles.coverPlaceholder}>
              {getBoardInitials(selectedBoard.name)}
            </div>
          )}
          <button
            className={styles.coverUploadBtn}
            onClick={() => coverInputRef.current?.click()}
            disabled={uploadingCover}
          >
            {uploadingCover ? 'Uploading…' : coverUrl ? 'Change photo' : 'Add photo'}
          </button>
          <input
            ref={coverInputRef}
            type="file"
            accept="image/*"
            className={styles.coverInput}
            onChange={handleCoverUpload}
          />
        </div>

        {editingName ? (
          <div className={styles.editForm}>
            <input
              className={styles.addInput}
              value={editName}
              onChange={e => setEditName(e.target.value)}
              placeholder="Board name"
              autoFocus
            />
            <input
              className={styles.addInput}
              value={editDesc}
              onChange={e => setEditDesc(e.target.value)}
              placeholder="Description (optional)"
            />
            <div className={styles.addRow}>
              <button className={styles.addBtn} onClick={saveEdit} disabled={savingEdit || !editName.trim()}>
                {savingEdit ? 'Saving…' : 'Save'}
              </button>
              <button className={styles.addBtn} style={{ background: 'transparent', color: '#555', border: '1.5px solid #d9cebd' }} onClick={() => setEditingName(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.boardTitle}>
            <strong>{selectedBoard.name}</strong>
            {selectedBoard.description && <span className={styles.boardPurpose}>{selectedBoard.description}</span>}
          </div>
        )}
        <div className={styles.boardTabs}>
          <button
            className={`${styles.boardTab} ${boardTab === 'saved' ? styles.boardTabActive : ''}`}
            onClick={() => setBoardTab('saved')}
          >
            Saved ({selectedBoard.product_count})
          </button>
          <button
            className={`${styles.boardTab} ${boardTab === 'notes' ? styles.boardTabActive : ''}`}
            onClick={() => setBoardTab('notes')}
          >
            Notes ({selectedBoard.note_count})
          </button>
          <button
            className={`${styles.boardTab} ${boardTab === 'vibes' ? styles.boardTabActive : ''}`}
            onClick={() => setBoardTab('vibes')}
          >
            Vibes
          </button>
        </div>
        {detailLoading ? (
          <p className={styles.empty}>Loading…</p>
        ) : boardTab === 'saved' ? (
          boardDetail?.products.length ? (
            <div className={styles.savedGrid}>
              {boardDetail.products.map((p: MasonSavedProduct) => (
                <div
                  key={p.product_id}
                  className={styles.savedTile}
                  onClick={() => setModalProduct({ product_id: p.product_id, name: p.name, price: p.price, image_url: p.image_url, shop_id: p.shop_id, shop_name: p.shop_name ?? '' })}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setModalProduct({ product_id: p.product_id, name: p.name, price: p.price, image_url: p.image_url, shop_id: p.shop_id, shop_name: p.shop_name ?? '' }) } }}
                >
                  {p.image_url
                    ? <img src={p.image_url} alt={p.name} className={styles.savedTileImg} />
                    : <div className={styles.savedTilePlaceholder}>🛍️</div>
                  }
                  <button className={styles.savedTileRemove} onClick={e => { e.stopPropagation(); handleRemoveProduct(p.product_id) }} title="Remove">×</button>
                </div>
              ))}
            </div>
          ) : <p className={styles.empty}>No saved items yet.</p>
        ) : boardTab === 'notes' ? (
          <div className={styles.notesSection}>
            <div className={styles.addRow}>
              <input
                className={styles.addInput}
                placeholder="Add a note…"
                value={newNoteText}
                onChange={e => setNewNoteText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddNote()}
              />
              <button className={styles.addBtn} onClick={handleAddNote} disabled={addingNote || !newNoteText.trim()}>Add</button>
            </div>
            {boardDetail?.notes.length ? (
              <ul className={styles.items}>
                {boardDetail.notes.map((n: BoardNote) => (
                  <li key={n.id} className={styles.item}>
                    <div className={styles.itemBody}>
                      <span className={styles.itemName}>{n.text}</span>
                      {n.created_at && (
                        <span className={styles.itemDate}>
                          {new Date(n.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                      )}
                    </div>
                    <button className={styles.removeBtn} onClick={() => handleDeleteNote(n.id)} title="Remove note">×</button>
                  </li>
                ))}
              </ul>
            ) : <p className={styles.empty}>No notes yet.</p>}
          </div>
        ) : (
          // Vibes tab
          <div className={styles.vibesSection}>
            {vibesLoading ? (
              <p className={styles.empty}>Loading vibes…</p>
            ) : boardVibes.length ? (
              <div className={styles.vibesGrid}>
                {boardVibes.map(v => (
                  <div key={v.id} className={styles.vibeTile}>
                    <img src={v.image_url} alt={v.label} className={styles.vibeTileImg} />
                    <span className={styles.vibeTileLabel}>{v.label}</span>
                    <button className={styles.vibeTileRemove} onClick={() => handleDeleteVibe(v.id)} title="Remove">×</button>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.empty}>No vibes saved yet. When Mason asks about your style, select options to save them here.</p>
            )}
          </div>
        )}
      </div>
      {modalProduct && (
        <ProductModal
          product={modalProduct}
          memory={memory}
          onClose={() => setModalProduct(null)}
        />
      )}
      </>
    )
  }

  // Board list view
  return (
    <div className={styles.boards}>
      <div className={styles.header}>
        <button className={styles.addBtn} onClick={() => setShowAddBoard(v => !v)}>+ New Board</button>
        <div className={styles.pinterestActions}>
          {pinterestStatus?.connected ? (
            <>
              <span className={styles.pinterestBadge}>
                {pinterestStatus.profile_image && (
                  <img src={pinterestStatus.profile_image} alt="" className={styles.pinterestAvatar} />
                )}
                {pinterestStatus.username}
              </span>
              <button
                className={styles.pinterestBtn}
                onClick={handleImportPinterest}
                disabled={importingPinterest}
              >
                {importingPinterest ? 'Importing…' : 'Import Pinterest'}
              </button>
            </>
          ) : (
            <button className={styles.pinterestBtn} onClick={handleConnectPinterest}>
              Connect Pinterest
            </button>
          )}
        </div>
      </div>
      {showAddBoard && (
        <div className={styles.form}>
          <input
            className={styles.addInput}
            placeholder="Board name (required)"
            value={newBoardName}
            onChange={e => setNewBoardName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddBoard()}
            autoFocus
          />
          <input
            className={styles.addInput}
            placeholder="Purpose / description (optional)"
            value={newBoardDesc}
            onChange={e => setNewBoardDesc(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddBoard()}
          />
          <div
            className={styles.newBoardImagePicker}
            onClick={() => newBoardImageRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && newBoardImageRef.current?.click()}
          >
            {newBoardImagePreview ? (
              <img src={newBoardImagePreview} alt="Cover preview" className={styles.newBoardImagePreview} />
            ) : (
              <span className={styles.newBoardImageLabel}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
                Add cover photo
              </span>
            )}
            {newBoardImagePreview && (
              <span className={styles.newBoardImageChange}>Change</span>
            )}
          </div>
          <input
            ref={newBoardImageRef}
            type="file"
            accept="image/*"
            className={styles.coverInput}
            onChange={handleNewBoardImageChange}
          />
          <div className={styles.addRow}>
            <button className={styles.addBtn} onClick={handleAddBoard} disabled={addingBoard || !newBoardName.trim()}>
              {addingBoard ? 'Creating…' : 'Create'}
            </button>
            <button
              className={styles.addBtn}
              style={{ background: 'transparent', color: '#555', border: '1.5px solid #d9cebd' }}
              onClick={resetNewBoardForm}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {memory.loading ? (
        <p className={styles.empty}>Loading…</p>
      ) : memory.boards.length === 0 ? (
        <p className={styles.empty}>No boards yet.</p>
      ) : (
        <div className={styles.boardGrid}>
          {[...memory.boards].sort((a, b) => (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0)).map(b => {
            const thumbUrl = b.cover_image_url ?? b.first_product_image_url
            return (
              <button key={b.id} className={styles.boardTile} onClick={() => { setSelectedBoardId(b.id); setBoardTab('saved') }}>
                <div className={styles.boardTileImg}>
                  {thumbUrl ? (
                    <img src={thumbUrl} alt="" className={styles.boardTileImgEl} />
                  ) : (
                    <div className={styles.boardTilePlaceholder}>
                      {getBoardInitials(b.name)}
                    </div>
                  )}
                </div>
                <span className={styles.boardTileName}>
                  {b.name}
                  {b.is_default && <span className={styles.defaultBadge}> ·</span>}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
