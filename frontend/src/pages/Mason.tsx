import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { api, Session, ShippingAddress, ShippingAddressPatch } from '../api'
import { useAuth } from '../hooks/useAuth'
import { useAgentStream, StreamEvent } from '../hooks/useAgentStream'
import { useMasonMemory } from '../mason/useMasonMemory'
import PrefsForm from '../components/PrefsForm'
import styles from './Mason.module.css'
import { formatDate } from '../lib/format'
import SavedProductItem from '../components/SavedProductItem'
import { track } from '../analytics/posthog'
import MasonFeedback from '../components/MasonFeedback'

type TabKey = 'shipping' | 'notes' | 'preferences' | 'saved' | 'history' | 'inbox'

const SESSIONS_PAGE_SIZE = 50

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'inbox', label: 'Inbox' },
  { key: 'history', label: 'History' },
  { key: 'notes', label: 'Notes' },
  { key: 'preferences', label: 'Prefs' },
  { key: 'saved', label: 'Saved' },
  { key: 'shipping', label: 'Shipping' },
]

export default function Mason() {
  const { token } = useAuth()
  const navigate = useNavigate()
  if (!token) return <Navigate to="/login" replace />

  return <MasonInner token={token} navigate={navigate} />
}

function MasonInner({ token, navigate }: { token: string; navigate: (path: string) => void }) {
  const memory = useMasonMemory(token)
  const [tab, setTab] = useState<TabKey>('inbox')
  const [newNote, setNewNote] = useState('')
  const [sessions, setSessions] = useState<Session[]>([])
  const [sessionsHasMore, setSessionsHasMore] = useState(false)
  const [sessionsLoadingMore, setSessionsLoadingMore] = useState(false)
  const [masonSessionId, setMasonSessionId] = useState<number | null>(null)
  const [chatOpen, setChatOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    const stored = window.localStorage.getItem('mason.chatOpen')
    return stored === null ? true : stored === '1'
  })

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('mason.chatOpen', chatOpen ? '1' : '0')
    }
  }, [chatOpen])

  // Load all sessions (for History tab) and pick or create a mason-type session
  // for the persistent chat panel.
  useEffect(() => {
    let cancelled = false
    api.getSessions(token).then(all => {
      if (cancelled) return
      setSessions(all)
      setSessionsHasMore(all.length === SESSIONS_PAGE_SIZE)
    })
    // Always start a fresh Mason chat session on page load — prior turns from
    // earlier conversations shouldn't be replayed to the model. Durable
    // context (notes, prefs, saved products) still flows through long-term
    // memory on the backend.
    api.createSession(token, 'mason').then(created => {
      if (cancelled) return
      setMasonSessionId(created.id)
      setSessions(prev => [created, ...prev])
    })
    return () => { cancelled = true }
  }, [token])

  const unreadCount = useMemo(
    () => memory.inbox.filter(m => !m.read).length,
    [memory.inbox],
  )

  async function loadMoreSessions() {
    if (sessionsLoadingMore) return
    setSessionsLoadingMore(true)
    try {
      const older = await api.getSessions(token, undefined, {
        limit: SESSIONS_PAGE_SIZE,
        offset: sessions.length,
      })
      setSessions(prev => {
        const seen = new Set(prev.map(s => s.id))
        return [...prev, ...older.filter(s => !seen.has(s.id))]
      })
      setSessionsHasMore(older.length === SESSIONS_PAGE_SIZE)
    } finally {
      setSessionsLoadingMore(false)
    }
  }

  async function addNoteFromInput() {
    const t = newNote.trim()
    if (!t) return
    await memory.addNote(t)
    setNewNote('')
  }

  async function openInboxMessage(id: number) {
    const { session_id } = await api.openInboxMessage(id, token)
    await memory.refreshInbox()
    navigate(`/?session=${session_id}`)
  }

  return (
    <div className={`${styles.page} ${chatOpen ? '' : styles.pageCollapsed}`}>
      <section className={styles.column} aria-label="Mason memory">
        <nav className={styles.tabs} role="tablist">
          {TABS.map(t => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              className={`${styles.tab} ${tab === t.key ? styles.tabActive : ''}`}
              onClick={() => { track('mason_tab_switched', { from: tab, to: t.key }); setTab(t.key) }}
            >
              {t.label}
              {t.key === 'inbox' && unreadCount > 0 && (
                <span className={styles.tabBadge}>{unreadCount}</span>
              )}
            </button>
          ))}
        </nav>

        <div className={styles.panelBody}>
          {tab === 'shipping' && (
            <ShippingPanel shipping={memory.shipping} onSave={memory.saveShipping} />
          )}

          {tab === 'notes' && (
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
                        <span className={styles.noteMeta}>
                          {formatDate(n.created_at)}
                        </span>
                      )}
                    </span>
                    <button
                      className={styles.iconBtn}
                      onClick={() => memory.removeNote(n.key)}
                      aria-label="Remove note"
                    >×</button>
                  </li>
                ))}
                {memory.notes.length === 0 && (
                  <li className={styles.empty}>No notes yet. Mason will start adding them as you chat.</li>
                )}
              </ul>
              <div className={styles.addRow}>
                <input
                  className={styles.addInput}
                  placeholder="Add a note about yourself…"
                  value={newNote}
                  onChange={e => setNewNote(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addNoteFromInput() } }}
                />
                <button className={styles.addBtn} onClick={addNoteFromInput} disabled={!newNote.trim()}>Add</button>
              </div>
            </>
          )}

          {tab === 'preferences' && (
            <PrefsForm prefs={memory.prefs} onPatch={memory.patchPrefs} />
          )}

          {tab === 'saved' && (
            memory.savedProducts.length === 0 ? (
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
                      remove: styles.iconBtn,
                    }}
                    onRemove={memory.unsaveProduct}
                  />
                ))}
              </ul>
            )
          )}

          {tab === 'history' && (
            sessions.length === 0 ? (
              <p className={styles.empty}>No past conversations yet.</p>
            ) : (
              <>
              <ul className={styles.sessionList}>
                {sessions.map(s => (
                  <li key={s.id}>
                    <button
                      className={styles.sessionItem}
                      onClick={() => navigate(`/?session=${s.id}`)}
                    >
                      <span className={styles.sessionTitle}>{s.title}</span>
                      <span className={styles.sessionMeta}>
                        {formatDate(s.updated_at)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {sessionsHasMore && (
                <button
                  className={styles.loadMoreBtn}
                  onClick={loadMoreSessions}
                  disabled={sessionsLoadingMore}
                >
                  {sessionsLoadingMore ? 'Loading…' : 'Load older conversations'}
                </button>
              )}
              </>
            )
          )}

          {tab === 'inbox' && (
            memory.inbox.length === 0 ? (
              <p className={styles.empty}>No messages yet.</p>
            ) : (
              <ul className={styles.inboxList}>
                {memory.inbox.map(msg => (
                  <li
                    key={msg.id}
                    className={`${styles.inboxItem} ${msg.read ? '' : styles.unread}`}
                    onClick={() => openInboxMessage(msg.id)}
                  >
                    {!msg.read && <span className={styles.dot} aria-label="Unread" />}
                    <div className={styles.inboxBody}>
                      <p className={styles.inboxTitle}>{msg.title}</p>
                      <p className={styles.inboxPreview}>{msg.preview}</p>
                      <div className={styles.inboxDate}>
                        {formatDate(msg.created_at)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )
          )}
        </div>
      </section>

      {chatOpen && (
        <section className={styles.column} aria-label="Chat with Mason">
          <MasonChatColumn
            sessionId={masonSessionId}
            onAfterTurn={memory.refresh}
            onClose={() => setChatOpen(false)}
          />
        </section>
      )}

      {!chatOpen && (
        <button
          type="button"
          className={styles.popOut}
          onClick={() => setChatOpen(true)}
          aria-label="Open Mason chat"
        >
          <img src="/mason/mason-1.png" alt="" />
        </button>
      )}
    </div>
  )
}

function MasonChatColumn({
  sessionId,
  onAfterTurn,
  onClose,
}: { sessionId: number | null; onAfterTurn: () => void; onClose: () => void }) {
  const { messages, streaming, sendMessage } = useAgentStream(sessionId)
  const [input, setInput] = useState('')
  const transcriptRef = useRef<HTMLDivElement | null>(null)
  const prevStreaming = useRef(streaming)
  const sentAt = useRef<number | null>(null)

  useEffect(() => {
    if (prevStreaming.current && !streaming) {
      onAfterTurn()
      track('mason_response_rendered', {
        session_id: sessionId,
        surface: 'mason_page',
        latency_perceived_ms: sentAt.current != null
          ? Math.round(performance.now() - sentAt.current)
          : null,
      })
      sentAt.current = null
    }
    prevStreaming.current = streaming
  }, [streaming, onAfterTurn, sessionId])

  useEffect(() => {
    const el = transcriptRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const handleSend = useCallback(() => {
    const t = input.trim()
    if (!t || !sessionId || streaming) return
    track('mason_message_sent', {
      session_id: sessionId,
      surface: 'mason_page',
      message_length: t.length,
    })
    sentAt.current = performance.now()
    sendMessage(t)
    setInput('')
  }, [input, sessionId, streaming, sendMessage])

  return (
    <>
      <div className={styles.chatHeader}>
        <div className={styles.chatAvatar}>
          <img src="/mason/mason-1.png" alt="" />
        </div>
        <div className={styles.chatHeaderText}>
          <div className={styles.chatTitle}>Mason</div>
          <div className={styles.chatSub}>available</div>
        </div>
        <button
          type="button"
          className={styles.chatClose}
          onClick={onClose}
          aria-label="Close Mason chat"
        >×</button>
      </div>

      <div className={styles.transcript} ref={transcriptRef}>
        {messages.length === 0 && (
          <div className={styles.bubbleThinking}>
            Hi! Tell me a fact to remember, or ask what you have saved.
          </div>
        )}
        {messages.map(m => {
          if (m.from === 'user') {
            return (
              <div key={m.id} className={`${styles.bubble} ${styles.bubbleUser}`}>{m.text}</div>
            )
          }
          const text = collectAgentText(m.events ?? [])
          if (!text && streaming) {
            return (
              <div key={m.id} className={`${styles.bubble} ${styles.bubbleAgent}`}>…</div>
            )
          }
          const isLast = m.id === messages[messages.length - 1]?.id
          return (
            <div key={m.id}>
              <div className={`${styles.bubble} ${styles.bubbleAgent}`}>
                {text || ' '}
              </div>
              {!streaming && isLast && text && (
                <MasonFeedback
                  sessionId={sessionId}
                  messageId={String(m.id)}
                  surface="mason_page"
                />
              )}
            </div>
          )
        })}
      </div>

      <div className={styles.composer}>
        <textarea
          rows={1}
          value={input}
          placeholder={sessionId ? 'Text Mason…' : 'Loading…'}
          disabled={!sessionId}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
        />
        <button
          className={styles.sendBtn}
          onClick={handleSend}
          disabled={!sessionId || streaming || !input.trim()}
        >Send</button>
      </div>
    </>
  )
}

function ShippingPanel({
  shipping,
  onSave,
}: { shipping: ShippingAddress; onSave: (patch: ShippingAddressPatch) => Promise<void> }) {
  const [open, setOpen] = useState(true)
  const [draft, setDraft] = useState<ShippingAddress>(shipping)
  const [saving, setSaving] = useState(false)

  useEffect(() => { setDraft(shipping) }, [shipping])

  const hasAddress = !!(shipping.line1 || shipping.city || shipping.postal_code)
  const summary = hasAddress
    ? [shipping.name, shipping.line1, shipping.line2,
       [shipping.city, shipping.state, shipping.postal_code].filter(Boolean).join(', '),
       shipping.country].filter(Boolean).join(' · ')
    : 'No shipping address saved yet — click to add one.'

  const update = (k: keyof ShippingAddress, v: string) => setDraft(d => ({ ...d, [k]: v }))

  const save = async () => {
    setSaving(true)
    try { await onSave(draft); setOpen(false) }
    finally { setSaving(false) }
  }

  return (
    <>
      <p className={styles.helpText}>
        Mason ships your single-cart orders here. Click to edit.
      </p>
      <button
        type="button"
        className={styles.sessionItem}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{ width: '100%', textAlign: 'left' }}
      >
        <span className={styles.sessionTitle}>{hasAddress ? (shipping.name || 'Shipping address') : 'Add shipping address'}</span>
        <span className={styles.sessionMeta}>{open ? '▴' : '▾'}</span>
      </button>
      {!open && (
        <p className={styles.helpText} style={{ marginTop: 8 }}>{summary}</p>
      )}
      {open && (
        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          <input className={styles.addInput} placeholder="Full name"
            value={draft.name} onChange={e => update('name', e.target.value)} />
          <input className={styles.addInput} placeholder="Address line 1"
            value={draft.line1} onChange={e => update('line1', e.target.value)} />
          <input className={styles.addInput} placeholder="Address line 2 (optional)"
            value={draft.line2} onChange={e => update('line2', e.target.value)} />
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8 }}>
            <input className={styles.addInput} placeholder="City"
              value={draft.city} onChange={e => update('city', e.target.value)} />
            <input className={styles.addInput} placeholder="State"
              value={draft.state} onChange={e => update('state', e.target.value)} />
            <input className={styles.addInput} placeholder="ZIP"
              value={draft.postal_code} onChange={e => update('postal_code', e.target.value)} />
          </div>
          <input className={styles.addInput} placeholder="Country"
            value={draft.country} onChange={e => update('country', e.target.value)} />
          <input className={styles.addInput} placeholder="Phone (optional)"
            value={draft.phone} onChange={e => update('phone', e.target.value)} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className={styles.addBtn} onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button className={styles.addBtn}
              style={{ background: 'transparent', color: 'inherit' }}
              onClick={() => { setDraft(shipping); setOpen(false) }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  )
}

function collectAgentText(events: StreamEvent[]): string {
  const parts: string[] = []
  for (const ev of events) {
    if (ev.type === 'text') parts.push(ev.content)
  }
  return parts.join('').trim()
}
