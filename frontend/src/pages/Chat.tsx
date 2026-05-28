import { useEffect, useRef, useState, FormEvent, KeyboardEvent } from 'react'
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
  const [authMode, setAuthMode] = useState<AuthMode>('none')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authName, setAuthName] = useState('')
  const [authError, setAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const { messages, streaming, plan, sendMessage, reset } = useAgentStream(activeSessionId)

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
    reset()
  }

  function selectSession(id: number) {
    setActiveSessionId(id)
    setAnsweredQuestions(new Set())
    reset()
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
        setActiveSessionId(s[0].id)
        reset()
      }
    } catch (err: unknown) {
      setAuthError((err as Error).message)
    } finally {
      setAuthLoading(false)
    }
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
                <span className={styles.sessionDate}>{new Date(s.updated_at).toLocaleDateString()}</span>
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
            {messages.map(msg => (
              <div key={msg.id} className={`${styles.row} ${msg.from === 'user' ? styles.userRow : styles.agentRow}`}>
                {msg.from === 'agent' && <div className={styles.avatar}>🧱</div>}
                <div className={styles.bubble}>
                  {msg.from === 'user' ? (
                    <p className={styles.userText}>{msg.text}</p>
                  ) : (
                    <AgentMessage
                      events={msg.events ?? []}
                      onAnswer={handleAnswer}
                      answeredQuestions={answeredQuestions}
                    />
                  )}
                </div>
                {msg.from === 'user' && <div className={styles.avatar}>👤</div>}
              </div>
            ))}
            {streaming && (
              <div className={`${styles.row} ${styles.agentRow}`}>
                <div className={styles.avatar}>🧱</div>
                <div className={styles.bubble}>
                  <div className={styles.typingIndicator}>
                    <span /><span /><span />
                  </div>
                </div>
              </div>
            )}
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
