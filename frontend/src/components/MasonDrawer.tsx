import { FormEvent, MouseEvent, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Session } from '../api'
import { Message } from '../hooks/useAgentStream'
import PlanDropdown from './PlanDropdown'
import LiveReasoning from './LiveReasoning'
import { useMason } from '../mason/MasonContext'
import styles from './MasonDrawer.module.css'

type TabKey = 'now' | 'notes' | 'preferences' | 'saved' | 'recent'

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
  onCorrect: (text: string) => void
  user: { display_name: string | null; email: string } | null
  token: string | null
  onSignIn: () => void
}

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'now', label: 'Now' },
  { key: 'notes', label: 'Notes' },
  { key: 'preferences', label: 'Prefs' },
  { key: 'saved', label: 'Saved' },
  { key: 'recent', label: 'Tasks' },
]

export default function MasonDrawer(props: MasonDrawerProps) {
  const { isOpen, closeDrawer, agentState } = useMason()
  const [tab, setTab] = useState<TabKey>('now')
  const [correction, setCorrection] = useState('')
  const [notes, setNotes] = useState<string[]>([
    'Lives nearby and prefers shops within walking distance.',
    'Cares about supporting local businesses.',
  ])
  const [newNote, setNewNote] = useState('')
  const [prefs, setPrefs] = useState({
    sizes: '',
    budget: '',
    likes: '',
    dislikes: '',
  })

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeDrawer() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, closeDrawer])

  // Latest agent message's events drive the "Now" reasoning view.
  const latestAgentEvents = useMemo(() => {
    for (let i = props.messages.length - 1; i >= 0; i--) {
      const m = props.messages[i]
      if (m.from === 'agent') return m.events ?? []
    }
    return []
  }, [props.messages])

  if (!isOpen) return null

  const statusText =
    agentState === 'thinking' ? 'thinking…'
    : agentState === 'tool' ? 'updating knowledge…'
    : agentState === 'replying' ? 'replying…'
    : 'available'

  function submitCorrection(e: FormEvent) {
    e.preventDefault()
    const text = correction.trim()
    if (!text) return
    props.onCorrect(text)
    setCorrection('')
  }

  function addNote() {
    const t = newNote.trim()
    if (!t) return
    setNotes(prev => [...prev, t])
    setNewNote('')
  }

  function removeNote(idx: number) {
    setNotes(prev => prev.filter((_, i) => i !== idx))
  }

  return createPortal(
    <>
      <div className={styles.backdrop} onClick={closeDrawer} aria-hidden="true" />
      <aside className={styles.panel} role="dialog" aria-label="Mason">
        <div className={styles.header}>
          <div className={styles.headerIdent}>
            <div className={styles.avatar}>
              <img src="/mason/mason-1.png" alt="" />
              <span className={`${styles.statusDot} ${styles[`status_${agentState}`]}`} />
            </div>
            <div className={styles.headerText}>
              <span className={styles.headerName}>Mason</span>
              <span className={styles.headerStatus}>{statusText}</span>
            </div>
          </div>
          <button className={styles.closeBtn} onClick={closeDrawer} aria-label="Close">×</button>
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
          {tab === 'now' && (
            <div className={styles.section}>
              {props.plan.length === 0 && latestAgentEvents.length === 0 ? (
                <p className={styles.empty}>
                  {props.streaming ? "Mason is just getting started…" : "Nothing on Mason's desk right now. Ask him something to get going."}
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

              <form className={styles.correctForm} onSubmit={submitCorrection}>
                <label className={styles.sectionLabel}>Steer Mason</label>
                <textarea
                  className={styles.correctInput}
                  placeholder="e.g. Actually I meant shoes for trail running, not road."
                  value={correction}
                  onChange={e => setCorrection(e.target.value)}
                  rows={2}
                />
                <button
                  type="submit"
                  className={styles.correctSubmit}
                  disabled={!correction.trim() || props.streaming}
                >
                  Send correction
                </button>
              </form>
            </div>
          )}

          {tab === 'notes' && (
            <div className={styles.section}>
              <p className={styles.helpText}>What Mason knows about you. Saved locally for now.</p>
              <ul className={styles.notesList}>
                {notes.map((n, i) => (
                  <li key={i} className={styles.noteItem}>
                    <span>{n}</span>
                    <button className={styles.noteRemove} onClick={() => removeNote(i)} aria-label="Remove">×</button>
                  </li>
                ))}
                {notes.length === 0 && <li className={styles.emptyRow}>No notes yet.</li>}
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
            </div>
          )}

          {tab === 'preferences' && (
            <div className={styles.section}>
              <p className={styles.helpText}>Defaults Mason uses when shopping for you. Saved locally for now.</p>
              <label className={styles.prefField}>
                <span>Sizes</span>
                <input value={prefs.sizes} onChange={e => setPrefs(p => ({ ...p, sizes: e.target.value }))} placeholder="e.g. M top, 32 waist, 10.5 shoe" />
              </label>
              <label className={styles.prefField}>
                <span>Budget</span>
                <input value={prefs.budget} onChange={e => setPrefs(p => ({ ...p, budget: e.target.value }))} placeholder="e.g. up to $150" />
              </label>
              <label className={styles.prefField}>
                <span>Likes</span>
                <input value={prefs.likes} onChange={e => setPrefs(p => ({ ...p, likes: e.target.value }))} placeholder="brands, styles, materials" />
              </label>
              <label className={styles.prefField}>
                <span>Dislikes</span>
                <input value={prefs.dislikes} onChange={e => setPrefs(p => ({ ...p, dislikes: e.target.value }))} placeholder="things to avoid" />
              </label>
            </div>
          )}

          {tab === 'saved' && (
            <div className={styles.section}>
              <p className={styles.empty}>Saved items will live here once you start bookmarking products.</p>
            </div>
          )}

          {tab === 'recent' && (
            <div className={styles.section}>
              <button
                className={styles.newTaskBtn}
                onClick={() => { props.onNewSession(); closeDrawer() }}
              >+ New task</button>

              {props.token ? (
                props.sessions.length === 0 ? (
                  <p className={styles.empty}>No past tasks yet.</p>
                ) : (
                  <ul className={styles.sessionList}>
                    {props.sessions.map(s => (
                      <li key={s.id}>
                        <button
                          className={`${styles.sessionItem} ${s.id === props.activeSessionId ? styles.sessionActive : ''}`}
                          onClick={() => { props.onSelectSession(s.id); closeDrawer() }}
                        >
                          <span className={styles.sessionTitle}>{s.title}</span>
                          <span className={styles.sessionMeta}>
                            <span className={styles.sessionDate}>{new Date(s.updated_at).toLocaleDateString()}</span>
                            <button
                              className={styles.sessionDelete}
                              onClick={e => props.onDeleteSession(e, s.id)}
                              title="Delete conversation"
                              aria-label="Delete conversation"
                            >×</button>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              ) : (
                <div className={styles.guestNotice}>
                  <p>Sign in to save tasks, notes, and preferences so Mason remembers you next time.</p>
                  <button className={styles.signInBtn} onClick={() => { props.onSignIn(); closeDrawer() }}>Sign in</button>
                </div>
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
    </>,
    document.body,
  )
}
