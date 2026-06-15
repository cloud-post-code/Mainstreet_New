import { useCallback, useEffect, useState } from 'react'
import { api, BoardDetail, BoardNote } from '../api'
import { MasonMemory } from '../mason/useMasonMemory'
import styles from './BoardsPanel.module.css'

interface BoardsPanelProps {
  memory: MasonMemory
  token: string
}

export default function BoardsPanel({ memory, token }: BoardsPanelProps) {
  const [selectedBoardId, setSelectedBoardId] = useState<number | null>(null)
  const [boardDetail, setBoardDetail] = useState<BoardDetail | null>(null)
  const [boardTab, setBoardTab] = useState<'saved' | 'notes'>('saved')
  const [showAddBoard, setShowAddBoard] = useState(false)
  const [newBoardName, setNewBoardName] = useState('')
  const [newBoardDesc, setNewBoardDesc] = useState('')
  const [addingBoard, setAddingBoard] = useState(false)
  const [newNoteText, setNewNoteText] = useState('')
  const [addingNote, setAddingNote] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)

  const loadBoardDetail = useCallback(async (id: number) => {
    setDetailLoading(true)
    try {
      const detail = await api.getBoard(id, token)
      setBoardDetail(detail)
    } catch (e) {
      console.error('[BoardsPanel] load board detail failed', e)
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

  const selectedBoard = memory.boards.find(b => b.id === selectedBoardId)

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
      console.error('[BoardsPanel] create board failed', e)
    } finally {
      setAddingBoard(false)
    }
  }

  const handleDeleteBoard = async (id: number) => {
    if (!confirm('Delete this board and all its items?')) return
    await memory.deleteBoard(id)
    if (selectedBoardId === id) setSelectedBoardId(null)
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
      console.error('[BoardsPanel] add note failed', e)
    } finally {
      setAddingNote(false)
    }
  }

  const handleDeleteNote = async (noteId: number) => {
    if (!selectedBoardId) return
    await memory.deleteBoardNote(selectedBoardId, noteId)
    setBoardDetail(prev => prev ? { ...prev, notes: prev.notes.filter((n: BoardNote) => n.id !== noteId) } : prev)
  }

  const handleRemoveProduct = async (productId: number) => {
    if (!selectedBoardId || !boardDetail) return
    await memory.removeProductFromBoard(selectedBoardId, productId)
    setBoardDetail(prev => prev ? { ...prev, products: prev.products.filter((p: { product_id: number }) => p.product_id !== productId) } : prev)
  }

  // Board detail view
  if (selectedBoard) {
    return (
      <div className={styles.boards}>
        <div className={styles.back}>
          <button className={styles.backBtn} onClick={() => { setSelectedBoardId(null); setBoardDetail(null) }}>
            ← Boards
          </button>
          <button className={styles.deleteBtn} onClick={() => handleDeleteBoard(selectedBoard.id)}>
            Delete
          </button>
        </div>
        <div className={styles.boardTitle}>
          <strong>{selectedBoard.name}</strong>
          {selectedBoard.description && <span className={styles.boardPurpose}>{selectedBoard.description}</span>}
        </div>
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
        </div>
        {detailLoading ? (
          <p className={styles.empty}>Loading…</p>
        ) : boardTab === 'saved' ? (
          boardDetail?.products.length ? (
            <ul className={styles.items}>
              {boardDetail.products.map((p: { product_id: number; name: string }) => (
                <li key={p.product_id} className={styles.item}>
                  <span className={styles.itemName}>{p.name}</span>
                  <button className={styles.removeBtn} onClick={() => handleRemoveProduct(p.product_id)}>×</button>
                </li>
              ))}
            </ul>
          ) : <p className={styles.empty}>No saved items yet.</p>
        ) : (
          <div>
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
                    <span className={styles.itemName}>{n.text}</span>
                    <button className={styles.removeBtn} onClick={() => handleDeleteNote(n.id)}>×</button>
                  </li>
                ))}
              </ul>
            ) : <p className={styles.empty}>No notes yet.</p>}
          </div>
        )}
      </div>
    )
  }

  // Board list view
  return (
    <div className={styles.boards}>
      <div className={styles.header}>
        <button className={styles.addBtn} onClick={() => setShowAddBoard(v => !v)}>+ New Board</button>
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
          <div className={styles.addRow}>
            <button className={styles.addBtn} onClick={handleAddBoard} disabled={addingBoard || !newBoardName.trim()}>
              {addingBoard ? 'Creating…' : 'Create'}
            </button>
            <button
              className={styles.addBtn}
              style={{ background: 'transparent', color: '#555', border: '1.5px solid #d9cebd' }}
              onClick={() => { setShowAddBoard(false); setNewBoardName(''); setNewBoardDesc('') }}
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
        <ul className={styles.list}>
          {memory.boards.map(b => (
            <li key={b.id}>
              <button className={styles.row} onClick={() => { setSelectedBoardId(b.id); setBoardTab('saved') }}>
                <div className={styles.rowMeta}>
                  <span className={styles.rowName}>{b.name}</span>
                  {b.description && <span className={styles.rowDesc}>{b.description}</span>}
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
