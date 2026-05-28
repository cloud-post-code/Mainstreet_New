import { useEffect, useRef, useState, FormEvent, KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useAgentStream } from '../hooks/useAgentStream'
import { api, Session } from '../api'
import AgentMessage from '../components/AgentMessage'
import styles from './Chat.module.css'

export default function Chat() {
  const { token, user, logout } = useAuth()
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null)
  const [input, setInput] = useState('')
  const [answeredQuestions, setAnsweredQuestions] = useState<Set<string>>(new Set())
  const bottomRef = useRef<HTMLDivElement>(null)

  const { messages, streaming, plan, sendMessage, reset } = useAgentStream(activeSessionId)

  useEffect(() => {
    if (!token) return
    api.getSessions(token).then(s => {
      setSessions(s)
      if (s.length) setActiveSessionId(s[0].id)
    })
  }, [token])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function newSession() {
    if (!token) return
    const s = await api.createSession(token)
    setSessions(prev => [s, ...prev])
    setActiveSessionId(s.id)
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
      const s = await api.createSession(token!)
      setSessions(prev => [s, ...prev])
      setActiveSessionId(s.id)
      // slight delay to let state settle
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

  return (
    <div className={styles.layout}>
      {/* Sidebar */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <div className={styles.brand}>🛍️ Shopper</div>
          {user?.is_admin && (
            <button className={styles.adminBtn} onClick={() => navigate('/admin')}>Admin</button>
          )}
        </div>
        <button className={styles.newChat} onClick={newSession}>+ New chat</button>
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
        <div className={styles.sidebarFooter}>
          <span className={styles.userName}>{user?.display_name ?? user?.email}</span>
          <button className={styles.logoutBtn} onClick={() => { logout(); navigate('/login') }}>Sign out</button>
        </div>
      </aside>

      {/* Main */}
      <main className={styles.main}>
        {messages.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>🛍️</div>
            <h2>Your Personal Shopper</h2>
            <p>Ask me to help you find products, compare options, or discover shops.</p>
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
                {msg.from === 'agent' && <div className={styles.avatar}>🤖</div>}
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
                <div className={styles.avatar}>🤖</div>
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
