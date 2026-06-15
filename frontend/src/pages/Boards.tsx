import { Navigate } from 'react-router-dom'
import { Board, BoardNote, MasonSavedProduct } from '../api'
import { useAuth } from '../hooks/useAuth'
import { useBoardsState } from '../mason/useBoardsState'
import { useMasonMemory } from '../mason/useMasonMemory'
import { formatCurrency } from '../lib/format'
import styles from './Boards.module.css'

export default function Boards() {
  const { token } = useAuth()
  if (!token) return <Navigate to="/login" replace />
  return <BoardsInner token={token} />
}

function BoardsInner({ token }: { token: string }) {
  const memory = useMasonMemory(token)
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

  const handleOpenBoard = (id: number) => {
    setSelectedBoardId(id)
    setBoardTab('saved')
  }

  const handleBack = () => {
    setSelectedBoardId(null)
    setBoardDetail(null)
  }

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
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
          <div className={styles.addFormActions}>
            <button className={styles.saveBtn} onClick={handleAddBoard} disabled={addingBoard || !newBoardName.trim()}>
              {addingBoard ? 'Creating…' : 'Create Board'}
            </button>
            <button className={styles.cancelBtn} onClick={resetNewBoardForm}>
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
