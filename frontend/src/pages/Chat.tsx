import { useEffect, useRef, useState, FormEvent, KeyboardEvent, MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useAgentStream } from '../hooks/useAgentStream'
import { api, Session } from '../api'
import AgentMessage from '../components/AgentMessage'
import styles from './Chat.module.css'

type AuthMode = 'none' | 'login' | 'register'

export default function Chat() {
  const { token, user, login, logout } = useAuth()
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null)
  const [input, setInput] = useState('')
  const [answeredQuestions, setAnsweredQuestions] = useState<Set<string>>(new Set())
  const [loadedMessages, setLoadedMessages] = useState<import('../hooks/useAgentStream').Message[]>([])
  const [authMode, setAuthMode] = useState<AuthMode>('none')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authName, setAuthName] = useState('')
  const [authError, setAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const { messages: liveMessages, streaming, plan, sendMessage, reset } = useAgentStream(activeSessionId)
  const messages = liveMessages.length > 0 ? liveMessages : loadedMessages

  // Load sessions for authenticated users
  useEffect(() => {
    if (!token) return
    api.getSessions(token).then(s => {
      setSessions(s)
      if (s.length) setActiveSessionId(s[0].id)
    })
  }, [token])

  // Create a guest session on first load if not authenticated
  useEffect(() => {
    if (token) return // authenticated users handled above
    if (activeSessionId) return
    api.createGuestSession().then(s => setActiveSessionId(s.id))
  }, [token, activeSessionId])

  useEffect(() => {
    if (liveMessages.length > 0) setLoadedMessages([])
  }, [liveMessages.length])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function newSession() {
    if (token) {
      const s = await api.createSession(token)
      setSessions(prev => [s, ...prev])
      setActiveSessionId(s.id)
    } else {
      const s = await api.createGuestSession()
      setActiveSessionId(s.id)
    }
    setAnsweredQuestions(new Set())
    setLoadedMessages([])
    reset()
  }

  async function selectSession(id: number) {
    setActiveSessionId(id)
    setAnsweredQuestions(new Set())
    reset()
    if (token) {
      try {
        const turns = await api.getTurns(id, token)
        const msgs: import('../hooks/useAgentStream').Message[] = []
        for (const t of turns) {
          if (t.role === 'user') {
            const text = typeof t.content === 'string' ? t.content : Array.isArray(t.content) ? (t.content as Array<{type:string;text?:string}>).find(b => b.type === 'text')?.text ?? '' : ''
            if (text) msgs.push({ id: t.created_at + '-u', from: 'user', text })
          } else if (t.role === 'assistant') {
            const blocks = Array.isArray(t.content)
              ? t.content as Array<{ type: string; text?: string; name?: string; id?: string; input?: { root?: string; components?: import('../a2ui/types').A2uiComponent[] } }>
              : []
            // Map tool_use_id -> success, derived from tool_results. Only restore
            // ui_trees whose render_ui call actually succeeded.
            const toolResults = Array.isArray(t.tool_results)
              ? t.tool_results as Array<{ tool_use_id?: string; content?: string }>
              : []
            const renderOk = new Set<string>()
            for (const tr of toolResults) {
              if (!tr.tool_use_id || typeof tr.content !== 'string') continue
              try {
                const parsed = JSON.parse(tr.content)
                if (parsed?.rendered === true) renderOk.add(tr.tool_use_id)
              } catch { /* ignore */ }
            }
            const events: import('../hooks/useAgentStream').StreamEvent[] = []
            for (const b of blocks) {
              if (b.type === 'text' && b.text) {
                events.push({ type: 'text', content: b.text })
              } else if (
                b.type === 'tool_use'
                && b.name === 'render_ui'
                && b.id
                && renderOk.has(b.id)
                && b.input?.root
                && Array.isArray(b.input.components)
              ) {
                events.push({
                  type: 'ui_tree',
                  root: b.input.root,
                  components: b.input.components,
                  tool_use_id: b.id,
                })
              }
            }
            if (events.length) msgs.push({ id: t.created_at + '-a', from: 'agent', events })
          }
        }
        if (msgs.length) setLoadedMessages(msgs)
      } catch { /* ignore — session may have no turns yet */ }
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!input.trim() || streaming) return
    const text = input.trim()
    setInput('')

    if (!activeSessionId) {
      const s = token
        ? await api.createSession(token)
        : await api.createGuestSession()
      if (token) setSessions(prev => [s, ...prev])
      setActiveSessionId(s.id)
      setTimeout(() => sendMessage(text), 50)
      return
    }
    await sendMessage(text)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e as unknown as FormEvent)
    }
  }

  function handleAnswer(answer: string, questionCardId: string) {
    setAnsweredQuestions(prev => new Set([...prev, questionCardId]))
    sendMessage(answer, questionCardId)
  }

  function latestProductIds(): number[] {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.from !== 'agent') continue
      const trees = (m.events ?? []).filter(e => e.type === 'ui_tree')
      if (!trees.length) continue
      const last = trees[trees.length - 1] as Extract<import('../hooks/useAgentStream').StreamEvent, { type: 'ui_tree' }>
      const ids: number[] = []
      for (const c of last.components) {
        if (c.type === 'product_card') {
          const pid = (c.props as { product_id?: unknown }).product_id
          if (typeof pid === 'number') ids.push(pid)
        }
      }
      return ids
    }
    return []
  }

  function handleIntent(intent: string, payload?: unknown) {
    if (streaming) return
    const p: Record<string, unknown> =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    if (intent === 'open_details') {
      const name = p.name ?? (p.product_id != null ? `product ${p.product_id}` : 'this product')
      sendMessage(`Show me more details for ${name}.`)
    } else if (intent === 'compare') {
      const ids = latestProductIds()
      sendMessage(
        ids.length
          ? `Compare these products for me: ${ids.join(', ')}.`
          : `Compare the products you just showed me.`
      )
    } else if (typeof p.label === 'string' && p.label) {
      sendMessage(p.label)
    } else {
      sendMessage(intent)
    }
  }

  function openAuth(mode: 'login' | 'register') {
    setAuthMode(mode)
    setAuthError('')
    setAuthEmail('')
    setAuthPassword('')
    setAuthName('')
  }

  async function handleAuth(e: FormEvent) {
    e.preventDefault()
    setAuthError('')
    setAuthLoading(true)
    try {
      const data = authMode === 'login'
        ? await api.login(authEmail, authPassword)
        : await api.register(authEmail, authPassword, authName || undefined)
      login(data.access_token, data.user)
      setAuthMode('none')
      // Load sessions for the newly logged-in user
      const s = await api.getSessions(data.access_token)
      setSessions(s)
      if (s.length) {
        await selectSession(s[0].id)
      }
    } catch (err: unknown) {
      setAuthError((err as Error).message)
    } finally {
      setAuthLoading(false)
    }
  }

  async function handleDeleteSession(e: MouseEvent, id: number) {
    e.stopPropagation()
    if (!token || !confirm('Delete this conversation?')) return
    await api.deleteSession(id, token)
    setSessions(prev => {
      const remaining = prev.filter(s => s.id !== id)
      if (activeSessionId === id) {
        if (remaining.length > 0) selectSession(remaining[0].id)
        else newSession()
      }
      return remaining
    })
  }

  function handleLogout() {
    logout()
    setSessions([])
    setActiveSessionId(null)
    setAnsweredQuestions(new Set())
    reset()
    // Create a fresh guest session
    api.createGuestSession().then(s => setActiveSessionId(s.id))
  }

  return (
    <div className={styles.layout}>
      {/* Sidebar */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <div className={styles.brand}>MAIN ST</div>
          {user?.is_admin && (
            <button className={styles.adminBtn} onClick={() => navigate('/admin')}>Admin</button>
          )}
        </div>
        <button className={styles.newChat} onClick={newSession}>+ New chat</button>

        {/* Session list — only shown when logged in */}
        {token && (
          <div className={styles.sessionList}>
            {sessions.map(s => (
              <button
                key={s.id}
                className={`${styles.sessionItem} ${s.id === activeSessionId ? styles.active : ''}`}
                onClick={() => selectSession(s.id)}
              >
                <span className={styles.sessionTitle}>{s.title}</span>
                <div className={styles.sessionMeta}>
                  <span className={styles.sessionDate}>{new Date(s.updated_at).toLocaleDateString()}</span>
                  <button
                    className={styles.deleteSessionBtn}
                    onClick={e => handleDeleteSession(e, s.id)}
                    title="Delete conversation"
                  >×</button>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Guest notice — shown when not logged in */}
        {!token && authMode === 'none' && (
          <div className={styles.guestNotice}>
            <p>Sign in to save your shopping history and preferences.</p>
            <div className={styles.guestButtons}>
              <button className={styles.signInBtn} onClick={() => openAuth('login')}>Sign in</button>
              <button className={styles.registerBtn} onClick={() => openAuth('register')}>Register</button>
            </div>
          </div>
        )}

        {/* Inline auth form */}
        {!token && authMode !== 'none' && (
          <div className={styles.authPanel}>
            <div className={styles.authPanelHeader}>
              <span>{authMode === 'login' ? 'Sign in' : 'Create account'}</span>
              <button className={styles.authClose} onClick={() => setAuthMode('none')}>✕</button>
            </div>
            <form onSubmit={handleAuth} className={styles.authForm}>
              {authMode === 'register' && (
                <input
                  className={styles.authInput}
                  type="text"
                  placeholder="Display name (optional)"
                  value={authName}
                  onChange={e => setAuthName(e.target.value)}
                />
              )}
              <input
                className={styles.authInput}
                type="email"
                placeholder="Email"
                value={authEmail}
                onChange={e => setAuthEmail(e.target.value)}
                required
                autoFocus
              />
              <input
                className={styles.authInput}
                type="password"
                placeholder="Password"
                value={authPassword}
                onChange={e => setAuthPassword(e.target.value)}
                required
              />
              {authError && <p className={styles.authError}>{authError}</p>}
              <button className={styles.authSubmit} type="submit" disabled={authLoading}>
                {authLoading ? '…' : authMode === 'login' ? 'Sign in' : 'Register'}
              </button>
            </form>
            <p className={styles.authSwitch}>
              {authMode === 'login' ? (
                <>No account? <button onClick={() => openAuth('register')}>Register</button></>
              ) : (
                <>Have an account? <button onClick={() => openAuth('login')}>Sign in</button></>
              )}
            </p>
          </div>
        )}

        <div className={styles.sidebarFooter}>
          {user ? (
            <>
              <span className={styles.userName}>{user.display_name ?? user.email}</span>
              <button className={styles.logoutBtn} onClick={handleLogout}>Sign out</button>
            </>
          ) : (
            <span className={styles.guestLabel}>Browsing as guest</span>
          )}
        </div>
      </aside>

      {/* Main */}
      <main className={styles.main}>
        {messages.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>🧱</div>
            <h2>Your Local Shopper</h2>
            <p>Ask Mason to help you find products from local shops near you.</p>
            {!token && (
              <p className={styles.guestHint}>
                <button onClick={() => openAuth('login')} className={styles.inlineLink}>Sign in</button> to save your preferences and shopping history.
              </p>
            )}
            <div className={styles.suggestions}>
              {[
                "Find me running shoes under $100",
                "What shops sell electronics?",
                "I need a gift for a home cook",
                "Show me in-stock yoga gear",
              ].map(s => (
                <button key={s} className={styles.suggestion} onClick={() => { setInput(s) }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className={styles.messages}>
            {(() => {
              // Find the index of the last agent message — only that one shows live streaming state.
              let lastAgentIdx = -1
              for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i].from === 'agent') { lastAgentIdx = i; break }
              }
              return messages.map((msg, idx) => (
                <div key={msg.id} className={`${styles.row} ${msg.from === 'user' ? styles.userRow : styles.agentRow}`}>
                  {msg.from === 'agent' && <div className={styles.avatar}>🧱</div>}
                  <div className={styles.bubble}>
                    {msg.from === 'user' ? (
                      <p className={styles.userText}>{msg.text}</p>
                    ) : (
                      <AgentMessage
                        events={msg.events ?? []}
                        streaming={streaming && idx === lastAgentIdx}
                        onAnswer={handleAnswer}
                        onIntent={handleIntent}
                        answeredQuestions={answeredQuestions}
                      />
                    )}
                  </div>
                  {msg.from === 'user' && <div className={styles.avatar}>👤</div>}
                </div>
              ))
            })()}
            <div ref={bottomRef} />
          </div>
        )}

        <form className={styles.inputBar} onSubmit={handleSubmit}>
          <textarea
            className={styles.textarea}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask your personal shopper…"
            rows={1}
            disabled={streaming}
          />
          <button className={styles.sendButton} type="submit" disabled={!input.trim() || streaming}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </form>
      </main>
    </div>
  )
}
