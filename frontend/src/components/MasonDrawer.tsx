import { MouseEvent, useEffect, useMemo, useState } from 'react'
import { api, Session } from '../api'
import { Message } from '../hooks/useAgentStream'
import PlanDropdown from './PlanDropdown'
import LiveReasoning from './LiveReasoning'
import PrefsSetup from './PrefsSetup'
import BoardsPanel from './BoardsPanel'
import MasonInboxTab from './MasonInboxTab'
import { useMason } from '../mason/MasonContext'
import { MasonMemory } from '../mason/useMasonMemory'
import styles from './MasonDrawer.module.css'
import { formatDate } from '../lib/format'
import SavedProductItem from './SavedProductItem'

type TabKey = 'preferences' | 'saved' | 'boards' | 'history' | 'inbox'

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
  { key: 'preferences', label: 'Preferences' },
  { key: 'inbox', label: 'Inbox' },
  { key: 'boards', label: 'Boards' },
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

  async function openInboxMessage(id: number) {
    if (!props.token) return
    const { session_id } = await api.openInboxMessage(id, props.token)
    await memory.refreshInbox()
    props.onSelectSession(session_id)
    closeDrawer()
  }

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
          {TABS.map(t => {
            const unread = t.key === 'inbox' ? memory.inbox.filter(m => !m.read).length : 0
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                className={`${styles.tab} ${tab === t.key ? styles.tabActive : ''}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
                {unread > 0 && <span className={styles.tabBadge}>{unread}</span>}
              </button>
            )
          })}
        </nav>

        <div className={styles.body}>
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
                <BoardsPanel memory={memory} token={props.token!} />
              )}
            </div>
          )}

          {tab === 'inbox' && (
            <div className={styles.section}>
              {!signedIn ? (
                <GuestNotice message="Sign in to receive messages and recommendations from Mason." />
              ) : (
                <MasonInboxTab
                  messages={memory.inbox}
                  onOpen={openInboxMessage}
                  emptyClass={styles.empty}
                  listClass={styles.inboxList}
                  itemClass={styles.inboxItem}
                  unreadClass={styles.inboxUnread}
                  dotClass={styles.inboxDot}
                  bodyClass={styles.inboxBody}
                  titleClass={styles.inboxTitle}
                  previewClass={styles.inboxPreview}
                  dateClass={styles.inboxDate}
                />
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
