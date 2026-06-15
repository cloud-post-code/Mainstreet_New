import { MouseEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { Session, api, BoardDetail, BoardNote } from '../api'
import { Message } from '../hooks/useAgentStream'
import PlanDropdown from './PlanDropdown'
import LiveReasoning from './LiveReasoning'
import PrefsSetup from './PrefsSetup'
import { useMason } from '../mason/MasonContext'
import { MasonMemory } from '../mason/useMasonMemory'
import styles from './MasonDrawer.module.css'
import { formatDate } from '../lib/format'
import SavedProductItem from './SavedProductItem'

type TabKey = 'notes' | 'preferences' | 'saved' | 'boards' | 'history'

interface PlanStep { step: number; description: string; done: boolean }

interface MasonDrawerProps {
  sessions: Session[]
  activeSessionId: number | null
  onSelectSession: (id: number) => void
  onNewSession: () => void
  onDeleteSession: (e: MouseEvent, id: number) => void
  plan: PlanStep[]
  messages: Message[]
  streaming: boolean
  user: { display_name: string | null; email: string } | null
  token: string | null
  onSignIn: () => void
  memory: MasonMemory
  /** session IDs that currently have a background turn running */
  runningSessionIds?: Set<number>
  hasMoreSessions?: boolean
  loadingMoreSessions?: boolean
  onLoadMoreSessions?: () => void
}

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'history', label: 'History' },
  { key: 'preferences', label: 'Prefs' },
  { key: 'boards', label: 'Boards' },
  { key: 'notes', label: 'Notes' },
]

export default function MasonDrawer(props: MasonDrawerProps) {
  const { isOpen, isPopped, closeDrawer, agentState } = useMason()
  const { memory } = props

  // Lock body scroll on mobile so the overlay feels modal.
  useEffect(() => {
    if (typeof document === 'undefined') return
    const lock = isOpen && window.matchMedia('(max-width: 768px)').matches
    if (lock) {
      const prev = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = prev }
    }
  }, [isOpen])
  const [tab, setTab] = useState<TabKey>('history')
  const [newNote, setNewNote] = useState('')

  // Latest agent message's events drive the "Now" reasoning view.
  const latestAgentEvents = useMemo(() => {
    for (let i = props.messages.length - 1; i >= 0; i--) {
      const m = props.messages[i]
      if (m.from === 'agent') return m.events ?? []
    }
    return []
  }, [props.messages])

  const statusText =
    agentState === 'thinking' ? 'thinking…'
    : agentState === 'tool' ? 'updating knowledge…'
    : agentState === 'replying' ? 'replying…'
    : 'available'

  async function addNote() {
    const t = newNote.trim()
    if (!t) return
    await memory.addNote(t)
    setNewNote('')
  }

  if (!isOpen) return (
    <ReopenButton
      onNewSession={props.onNewSession}
      onOpenHistory={() => setTab('history')}
    />
  )

  const panelClass = [
    styles.panel,
    isPopped ? styles.panelPopped : '',
  ].filter(Boolean).join(' ')

  const signedIn = !!props.token

  function GuestNotice({ message }: { message: string }) {
    return (
      <div className={styles.guestNotice}>
        <p>{message}</p>
        <button className={styles.signInBtn} onClick={() => { props.onSignIn(); closeDrawer() }}>Sign in</button>
      </div>
    )
  }

  return (
    <>
      <aside className={panelClass} aria-label="Mason">
        <div className={styles.header}>
          <div className={styles.headerIdent}>
            <div className={styles.avatar}>
              <img src="/mason/mason-1.png" alt="" />
            </div>
            <div className={styles.headerText}>
              <span className={styles.headerName}>Mason</span>
              <span className={styles.headerStatus}>{statusText}</span>
            </div>
          </div>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={closeDrawer}
              aria-label="Close Mason panel"
              title="Close"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <section className={styles.nowBanner} aria-label="What Mason is doing now">
          <div className={styles.nowHeader}>
            <span className={styles.sectionLabel}>Now</span>
            <span className={`${styles.liveDot} ${props.streaming ? styles.liveDotOn : ''}`} aria-hidden="true" />
          </div>
          {props.plan.length === 0 && latestAgentEvents.length === 0 ? (
            <p className={styles.nowEmpty}>
              {props.streaming ? "Mason is just getting started…" : "Mason is idle. Ask him something to get going."}
            </p>
          ) : (
            <>
              {props.plan.length > 0 && (
                <div className={styles.planBlock}>
                  <PlanDropdown steps={props.plan} />
                </div>
              )}
              <LiveReasoning events={latestAgentEvents} streaming={props.streaming} />
            </>
          )}

        </section>

        <div className={styles.newTaskRow}>
          <button
            className={styles.newTaskBtn}
            onClick={() => { props.onNewSession(); closeDrawer() }}
          >+ New task</button>
        </div>

        <nav className={styles.tabs} role="tablist">
          {TABS.map(t => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              className={`${styles.tab} ${tab === t.key ? styles.tabActive : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className={styles.body}>
          {tab === 'notes' && (
            <div className={styles.section}>
              {!signedIn ? (
                <GuestNotice message="Sign in so Mason can remember notes about you between visits." />
              ) : (
                <>
                  <p className={styles.helpText}>
                    What Mason knows about you. Mason adds notes automatically when he learns something durable; you can edit them here.
                  </p>
                  <ul className={styles.notesList}>
                    {memory.notes.map(n => (
                      <li key={n.key} className={styles.noteItem}>
                        <span>
                          {n.text}
                          {n.created_at && (
                            <span className={styles.noteMeta}>{formatDate(n.created_at)}</span>
                          )}
                        </span>
                        <button
                          className={styles.noteRemove}
                          onClick={() => memory.removeNote(n.key)}
                          aria-label="Remove"
                        >×</button>
                      </li>
                    ))}
                    {memory.notes.length === 0 && (
                      <li className={styles.emptyRow}>No notes yet. Mason will start adding them as you chat.</li>
                    )}
                  </ul>
                  <div className={styles.addRow}>
                    <input
                      className={styles.addInput}
                      placeholder="Add a note about yourself…"
                      value={newNote}
                      onChange={e => setNewNote(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addNote() } }}
                    />
                    <button className={styles.addBtn} onClick={addNote} disabled={!newNote.trim()}>Add</button>
                  </div>
                </>
              )}
            </div>
          )}

          {tab === 'preferences' && (
            <div className={styles.section}>
              {!signedIn ? (
                <GuestNotice message="Sign in to save your shopping preferences so Mason can use them every time." />
              ) : (
                <PrefsSetup prefs={memory.prefs} onPatch={memory.patchPrefs} />
              )}
            </div>
          )}

          {tab === 'saved' && (
            <div className={styles.section}>
              {!signedIn ? (
                <GuestNotice message="Sign in so Mason can save products you want to revisit." />
              ) : memory.savedProducts.length === 0 ? (
                <p className={styles.empty}>
                  Saved products will land here. Tell Mason to "save this" or "keep this for later".
                </p>
              ) : (
                <ul className={styles.savedList}>
                  {memory.savedProducts.map(p => (
                    <SavedProductItem
                      key={p.product_id}
                      product={p}
                      classes={{
                        item: styles.savedItem,
                        thumb: styles.savedThumb,
                        body: styles.savedBody,
                        name: styles.savedName,
                        sub: styles.savedSub,
                        remove: styles.savedRemove,
                      }}
                      onRemove={memory.unsaveProduct}
                    />
                  ))}
                </ul>
              )}
            </div>
          )}

          {tab === 'boards' && (
            <div className={styles.section}>
              {!signedIn ? (
                <GuestNotice message="Sign in to create boards and organize saved items." />
              ) : (
                <DrawerBoardsPanel memory={memory} token={props.token!} />
              )}
            </div>
          )}

          {tab === 'history' && (
            <div className={styles.section}>
              {props.token ? (
                props.sessions.length === 0 ? (
                  <p className={styles.empty}>No past tasks yet.</p>
                ) : (
                  <>
                  <ul className={styles.sessionList}>
                    {props.sessions.map(s => (
                      <li key={s.id}>
                        <button
                          className={`${styles.sessionItem} ${s.id === props.activeSessionId ? styles.sessionActive : ''}`}
                          onClick={() => { props.onSelectSession(s.id); closeDrawer() }}
                        >
                          <span className={styles.sessionTitle}>
                            {props.runningSessionIds?.has(s.id) && (
                              <span
                                className={styles.runningDot}
                                title="Mason is working on this chat"
                                aria-label="Running"
                              />
                            )}
                            {s.title}
                          </span>
                          <span className={styles.sessionMeta}>
                            <span className={styles.sessionDate}>{formatDate(s.updated_at)}</span>
                            <button
                              className={styles.sessionDelete}
                              onClick={e => props.onDeleteSession(e, s.id)}
                              title="Delete conversation"
                              aria-label="Delete conversation"
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M3 6h18" />
                                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                <path d="M10 11v6" />
                                <path d="M14 11v6" />
                              </svg>
                            </button>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {props.hasMoreSessions && props.onLoadMoreSessions && (
                    <button
                      className={styles.loadMoreBtn}
                      onClick={props.onLoadMoreSessions}
                      disabled={props.loadingMoreSessions}
                    >
                      {props.loadingMoreSessions ? 'Loading…' : 'Load older conversations'}
                    </button>
                  )}
                  </>
                )
              ) : (
                <GuestNotice message="Sign in to save tasks, notes, and preferences so Mason remembers you next time." />
              )}
            </div>
          )}
        </div>

        <div className={styles.footer}>
          {props.user ? (
            <span className={styles.userName}>Signed in as {props.user.display_name ?? props.user.email}</span>
          ) : (
            <span className={styles.userName}>Browsing as guest</span>
          )}
        </div>
      </aside>
    </>
  )
}

function DrawerBoardsPanel({ memory, token }: { memory: MasonMemory; token: string }) {
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
      console.error('[DrawerBoardsPanel] load board detail failed', e)
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
      console.error('[DrawerBoardsPanel] create board failed', e)
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
      console.error('[DrawerBoardsPanel] add note failed', e)
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

  if (selectedBoard) {
    return (
      <div className={styles.drawerBoards}>
        <div className={styles.drawerBoardsBack}>
          <button className={styles.drawerBackBtn} onClick={() => { setSelectedBoardId(null); setBoardDetail(null) }}>
            ← Boards
          </button>
          <button className={styles.drawerDeleteBtn} onClick={() => handleDeleteBoard(selectedBoard.id)}>
            Delete
          </button>
        </div>
        <div className={styles.drawerBoardTitle}>
          <strong>{selectedBoard.name}</strong>
          {selectedBoard.description && <span className={styles.drawerBoardPurpose}>{selectedBoard.description}</span>}
        </div>
        <div className={styles.drawerBoardTabs}>
          <button
            className={`${styles.drawerBoardTab} ${boardTab === 'saved' ? styles.drawerBoardTabActive : ''}`}
            onClick={() => setBoardTab('saved')}
          >
            Saved ({selectedBoard.product_count})
          </button>
          <button
            className={`${styles.drawerBoardTab} ${boardTab === 'notes' ? styles.drawerBoardTabActive : ''}`}
            onClick={() => setBoardTab('notes')}
          >
            Notes ({selectedBoard.note_count})
          </button>
        </div>
        {detailLoading ? (
          <p className={styles.emptyRow}>Loading…</p>
        ) : boardTab === 'saved' ? (
          boardDetail?.products.length ? (
            <ul className={styles.drawerBoardItems}>
              {boardDetail.products.map((p: { product_id: number; name: string }) => (
                <li key={p.product_id} className={styles.drawerBoardItem}>
                  <span className={styles.drawerBoardItemName}>{p.name}</span>
                  <button className={styles.noteRemove} onClick={() => handleRemoveProduct(p.product_id)}>×</button>
                </li>
              ))}
            </ul>
          ) : <p className={styles.emptyRow}>No saved items yet.</p>
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
              <ul className={styles.drawerBoardItems}>
                {boardDetail.notes.map((n: BoardNote) => (
                  <li key={n.id} className={styles.drawerBoardItem}>
                    <span className={styles.drawerBoardItemName}>{n.text}</span>
                    <button className={styles.noteRemove} onClick={() => handleDeleteNote(n.id)}>×</button>
                  </li>
                ))}
              </ul>
            ) : <p className={styles.emptyRow}>No notes yet.</p>}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={styles.drawerBoards}>
      <div className={styles.drawerBoardsHeader}>
        <button className={styles.addBtn} onClick={() => setShowAddBoard(v => !v)}>+ New Board</button>
      </div>
      {showAddBoard && (
        <div className={styles.drawerBoardForm}>
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
            placeholder="Purpose (optional)"
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
      {memory.boards.length === 0 ? (
        <p className={styles.emptyRow}>No boards yet.</p>
      ) : (
        <ul className={styles.drawerBoardList}>
          {memory.boards.map(b => (
            <li key={b.id}>
              <button
                className={styles.drawerBoardRow}
                onClick={() => { setSelectedBoardId(b.id); setBoardTab('saved') }}
              >
                <div className={styles.drawerBoardRowMeta}>
                  <span className={styles.drawerBoardRowName}>{b.name}</span>
                  {b.description && <span className={styles.drawerBoardRowDesc}>{b.description}</span>}
                </div>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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

function ReopenButton({
  onNewSession,
  onOpenHistory,
}: {
  onNewSession: () => void
  onOpenHistory: () => void
}) {
  const { openDrawer } = useMason()
  return (
    <div className={styles.reopenStack}>
      <button
        type="button"
        className={styles.reopenBtn}
        onClick={openDrawer}
        aria-label="Open Mason panel"
        title="Open Mason"
      >
        <img src="/mason/mason-1.png" alt="" />
      </button>
      <button
        type="button"
        className={styles.reopenAction}
        onClick={onNewSession}
        aria-label="Start a new task"
        title="New task"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
      <button
        type="button"
        className={styles.reopenAction}
        onClick={() => { onOpenHistory(); openDrawer() }}
        aria-label="Open history"
        title="History"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
      </button>
    </div>
  )
}
