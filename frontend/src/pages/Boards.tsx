import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { api, Board, BoardDetail, BoardNote, MasonSavedProduct } from '../api'
import { useAuth } from '../hooks/useAuth'
import { useMasonMemory } from '../mason/useMasonMemory'
import { formatCurrency } from '../lib/format'
import styles from './Boards.module.css'

export default function Boards() {
  const { token } = useAuth()
  if (!token) return <Navigate to="/login" replace />
  return <BoardsInner token={token} />
}

type BoardTab = 'notes' | 'saved'

function BoardsInner({ token }: { token: string }) {
  const memory = useMasonMemory(token)
  const [selectedBoardId, setSelectedBoardId] = useState<number | null>(null)
  const [boardDetail, setBoardDetail] = useState<BoardDetail | null>(null)
  const [boardTab, setBoardTab] = useState<BoardTab>('saved')
  const [showAddBoard, setShowAddBoard] = useState(false)
  const [newBoardName, setNewBoardName] = useState('')
  const [newBoardDesc, setNewBoardDesc] = useState('')
  const [addingBoard, setAddingBoard] = useState(false)
  const [newNoteText, setNewNoteText] = useState('')
  const [addingNote, setAddingNote] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [uploadingCover, setUploadingCover] = useState(false)
  const coverInputRef = useRef<HTMLInputElement>(null)

  const loadBoardDetail = useCallback(async (id: number) => {
    setDetailLoading(true)
    try {
      const detail = await api.getBoard(id, token)
      setBoardDetail(detail)
    } catch (e) {
      console.error('[Boards] load board detail failed', e)
    } finally {
      setDetailLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (selectedBoardId != null) {
      loadBoardDetail(selectedBoardId)
    } else {
      setBoardDetail(null)
    }
  }, [selectedBoardId, loadBoardDetail])

  const handleOpenBoard = (id: number) => {
    setSelectedBoardId(id)
    setBoardTab('saved')
  }

  const handleBack = () => {
    setSelectedBoardId(null)
    setBoardDetail(null)
  }

  const handleAddBoard = async () => {
    const name = newBoardName.trim()
    if (!name) return
    setAddingBoard(true)
    try {
      await memory.createBoard(name, newBoardDesc.trim() || undefined)
      setNewBoardName('')
      setNewBoardDesc('')
      setShowAddBoard(false)
    } catch (e) {
      console.error('[Boards] create board failed', e)
    } finally {
      setAddingBoard(false)
    }
  }

  const handleDeleteBoard = async (id: number) => {
    if (!confirm('Delete this board and all its items?')) return
    await memory.deleteBoard(id)
    if (selectedBoardId === id) setSelectedBoardId(null)
  }

  const handleRemoveProduct = async (productId: number) => {
    if (!selectedBoardId || !boardDetail) return
    await memory.removeProductFromBoard(selectedBoardId, productId)
    setBoardDetail(prev => prev ? { ...prev, products: prev.products.filter(p => p.product_id !== productId) } : prev)
  }

  const handleAddNote = async () => {
    const text = newNoteText.trim()
    if (!text || !selectedBoardId) return
    setAddingNote(true)
    try {
      const note = await memory.addNoteToBoard(selectedBoardId, text)
      setBoardDetail(prev => prev ? { ...prev, notes: [...prev.notes, note] } : prev)
      setNewNoteText('')
    } catch (e) {
      console.error('[Boards] add note failed', e)
    } finally {
      setAddingNote(false)
    }
  }

  const handleDeleteNote = async (noteId: number) => {
    if (!selectedBoardId) return
    await memory.deleteBoardNote(selectedBoardId, noteId)
    setBoardDetail(prev => prev ? { ...prev, notes: prev.notes.filter(n => n.id !== noteId) } : prev)
  }

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !selectedBoardId) return
    setUploadingCover(true)
    try {
      const result = await api.uploadBoardCover(selectedBoardId, file, token)
      memory.refresh()
      setBoardDetail(prev => prev ? { ...prev, cover_image_url: result.cover_image_url } : prev)
    } catch (e) {
      console.error('[Boards] cover upload failed', e)
    } finally {
      setUploadingCover(false)
      if (coverInputRef.current) coverInputRef.current.value = ''
    }
  }

  const selectedBoard = memory.boards.find(b => b.id === selectedBoardId)

  // Board detail view
  if (selectedBoard) {
    const coverUrl = boardDetail?.cover_image_url ?? selectedBoard.cover_image_url
    return (
      <div className={styles.page}>
        <div className={styles.header}>
          <button className={styles.backBtn} onClick={handleBack}>
            ← Boards
          </button>
          <button
            className={styles.deleteBoardBtn}
            onClick={() => handleDeleteBoard(selectedBoard.id)}
            title="Delete board"
          >
            Delete
          </button>
        </div>

        <div className={styles.boardDetailHeader}>
          <div className={styles.coverArea}>
            {coverUrl ? (
              <img className={styles.coverImg} src={coverUrl} alt="" />
            ) : (
              <div className={styles.coverPlaceholder}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
                <span>No cover photo</span>
              </div>
            )}
            <button
              className={styles.coverUploadBtn}
              onClick={() => coverInputRef.current?.click()}
              disabled={uploadingCover}
              title="Upload cover photo"
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
          <h1 className={styles.title}>{selectedBoard.name}</h1>
          {selectedBoard.description && (
            <p className={styles.boardDetailPurpose}>{selectedBoard.description}</p>
          )}
        </div>

        <div className={styles.detailTabs}>
          <button
            className={`${styles.detailTab} ${boardTab === 'saved' ? styles.detailTabActive : ''}`}
            onClick={() => setBoardTab('saved')}
          >
            Saved ({selectedBoard.product_count})
          </button>
          <button
            className={`${styles.detailTab} ${boardTab === 'notes' ? styles.detailTabActive : ''}`}
            onClick={() => setBoardTab('notes')}
          >
            Notes ({selectedBoard.note_count})
          </button>
        </div>

        {detailLoading ? (
          <p className={styles.empty}>Loading…</p>
        ) : boardTab === 'saved' ? (
          <SavedTab products={boardDetail?.products ?? []} onRemove={handleRemoveProduct} />
        ) : (
          <NotesTab
            notes={boardDetail?.notes ?? []}
            newNoteText={newNoteText}
            addingNote={addingNote}
            onNoteChange={setNewNoteText}
            onAddNote={handleAddNote}
            onDeleteNote={handleDeleteNote}
          />
        )}
      </div>
    )
  }

  // Board list view
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Boards</h1>
        <button className={styles.addBtn} onClick={() => setShowAddBoard(v => !v)}>
          + New Board
        </button>
      </div>

      {showAddBoard && (
        <div className={styles.addForm}>
          <input
            className={styles.input}
            placeholder="Board name (required)"
            value={newBoardName}
            onChange={e => setNewBoardName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddBoard()}
            autoFocus
          />
          <input
            className={styles.input}
            placeholder="Purpose / description (optional)"
            value={newBoardDesc}
            onChange={e => setNewBoardDesc(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddBoard()}
          />
          <div className={styles.addFormActions}>
            <button className={styles.saveBtn} onClick={handleAddBoard} disabled={addingBoard || !newBoardName.trim()}>
              {addingBoard ? 'Creating…' : 'Create Board'}
            </button>
            <button className={styles.cancelBtn} onClick={() => { setShowAddBoard(false); setNewBoardName(''); setNewBoardDesc('') }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {memory.loading ? (
        <p className={styles.empty}>Loading…</p>
      ) : memory.boards.length === 0 ? (
        <p className={styles.empty}>No boards yet. Create one to organize your saved items.</p>
      ) : (
        <div className={styles.boardList}>
          {memory.boards.map(board => (
            <button
              key={board.id}
              className={styles.boardRow}
              onClick={() => handleOpenBoard(board.id)}
            >
              <div className={styles.boardCover}>
                {board.cover_image_url ? (
                  <img src={board.cover_image_url} alt="" className={styles.boardCoverImg} />
                ) : (
                  <div className={styles.boardCoverPlaceholder}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                  </div>
                )}
              </div>
              <div className={styles.boardMeta}>
                <span className={styles.boardName}>{board.name}</span>
                {board.description && <span className={styles.boardDesc}>{board.description}</span>}
              </div>
              <div className={styles.boardCounts}>
                <span>{board.product_count} saved · {board.note_count} notes</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SavedTab({ products, onRemove }: { products: MasonSavedProduct[]; onRemove: (id: number) => void }) {
  if (!products.length) return <p className={styles.detailEmpty}>No saved items yet.</p>
  return (
    <ul className={styles.productList}>
      {products.map(p => (
        <li key={p.product_id} className={styles.productItem}>
          <div className={styles.productThumb}>
            {p.image_url && <img src={p.image_url} alt="" />}
          </div>
          <div className={styles.productBody}>
            <p className={styles.productName}>{p.name}</p>
            <p className={styles.productSub}>{p.shop_name ?? 'Unknown shop'} · {formatCurrency(p.price)}</p>
          </div>
          <button className={styles.removeBtn} onClick={() => onRemove(p.product_id)} title="Remove">×</button>
        </li>
      ))}
    </ul>
  )
}

function NotesTab({
  notes, newNoteText, addingNote, onNoteChange, onAddNote, onDeleteNote
}: {
  notes: BoardNote[]
  newNoteText: string
  addingNote: boolean
  onNoteChange: (v: string) => void
  onAddNote: () => void
  onDeleteNote: (id: number) => void
}) {
  return (
    <div className={styles.notesContainer}>
      <div className={styles.addNoteRow}>
        <input
          className={styles.input}
          placeholder="Add a note…"
          value={newNoteText}
          onChange={e => onNoteChange(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onAddNote()}
        />
        <button className={styles.saveBtn} onClick={onAddNote} disabled={addingNote || !newNoteText.trim()}>
          Add
        </button>
      </div>
      {notes.length === 0 ? (
        <p className={styles.detailEmpty}>No notes yet.</p>
      ) : (
        <ul className={styles.noteList}>
          {notes.map(n => (
            <li key={n.id} className={styles.noteItem}>
              <span className={styles.noteText}>{n.text}</span>
              <button className={styles.removeBtn} onClick={() => onDeleteNote(n.id)} title="Remove note">×</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
