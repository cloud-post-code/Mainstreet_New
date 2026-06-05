import { useCallback, useEffect, useMemo, useRef, useState, FormEvent, KeyboardEvent, MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useAgentStream, StreamEvent } from '../hooks/useAgentStream'
import { api, Session } from '../api'
import AgentMessage from '../components/AgentMessage'
import AgentErrorBoundary from '../components/AgentErrorBoundary'
import MasonDrawer from '../components/MasonDrawer'
import MasonChip from '../components/MasonChip'
import { useMason, AgentState } from '../mason/MasonContext'
import { useCart } from '../cart/CartContext'
import styles from './Chat.module.css'

const FALLBACK_SUGGESTIONS = [
  "Create Gift Basket",
  "Find Eco Home Goods",
  "Find Local Snacks",
  "Create a local spa day package",
]

type Turn = {
  role: string
  content: unknown
  tool_calls: unknown
  tool_results: unknown
  created_at: string
}

function parseTurns(turns: Turn[]): import('../hooks/useAgentStream').Message[] {
  const msgs: import('../hooks/useAgentStream').Message[] = []
  for (const t of turns) {
    if (t.role === 'user') {
      const text = typeof t.content === 'string'
        ? t.content
        : Array.isArray(t.content)
          ? (t.content as Array<{type:string;text?:string}>).find(b => b.type === 'text')?.text ?? ''
          : ''
      if (text) msgs.push({ id: t.created_at + '-u', from: 'user', text })
    } else if (t.role === 'assistant') {
      const blocks = Array.isArray(t.content)
        ? t.content as Array<{ type: string; text?: string; name?: string; id?: string; input?: { root?: string; components?: import('../a2ui/types').A2uiComponent[] } }>
        : []
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
  return msgs
}

// Derive Mason's visible state from the last event of the latest agent message.
function deriveAgentState(events: StreamEvent[], streaming: boolean): AgentState {
  if (!streaming) return 'idle'
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.type === 'thinking') return 'thinking'
    if (e.type === 'tool_call' || e.type === 'tool_result') return 'tool'
    if (e.type === 'text' || e.type === 'ui_tree') return 'replying'
  }
  return 'thinking'
}

export default function Chat() {
  const { token, user } = useAuth()
  const navigate = useNavigate()
  const mason = useMason()
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null)
  const [input, setInput] = useState('')
  const [loadedMessages, setLoadedMessages] = useState<import('../hooks/useAgentStream').Message[]>([])
  const [historyCursor, setHistoryCursor] = useState<string | null>(null)
  const [historyHasMore, setHistoryHasMore] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [suggestions, setSuggestions] = useState<string[] | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const selectTokenRef = useRef(0)
  const skipNextScrollRef = useRef(false)

  const { messages: liveMessages, streaming, plan, sendMessage, reset } = useAgentStream(activeSessionId)
  const cart = useCart()
  const prevStreamingRef = useRef(streaming)
  useEffect(() => {
    if (prevStreamingRef.current && !streaming) {
      cart.refresh()
    }
    prevStreamingRef.current = streaming
  }, [streaming, cart])

  const messages = useMemo(
    () => [...loadedMessages, ...liveMessages],
    [loadedMessages, liveMessages]
  )

  // Find the last agent message + index for streaming state and avatar bubbles.
  const lastAgentIdx = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].from === 'agent') return i
    }
    return -1
  }, [messages])

  const latestAgentEvents = useMemo(() => {
    if (lastAgentIdx === -1) return []
    return messages[lastAgentIdx].events ?? []
  }, [messages, lastAgentIdx])

  // Sync derived agent state up to MasonContext so TopNav's chip can show it.
  const agentState = useMemo(
    () => deriveAgentState(latestAgentEvents, streaming),
    [latestAgentEvents, streaming]
  )
  useEffect(() => {
    mason.setAgentState(agentState)
  }, [agentState, mason])

  useEffect(() => {
    if (!token) return
    api.getSessions(token).then(s => {
      setSessions(s)
      if (s.length) setActiveSessionId(s[0].id)
    })
  }, [token])

  useEffect(() => {
    if (token) return
    if (activeSessionId) return
    api.createGuestSession().then(s => setActiveSessionId(s.id))
  }, [token, activeSessionId])

  useEffect(() => {
    if (!token) { setSuggestions(null); return }
    let cancelled = false
    api.getSuggestions(token)
      .then(r => { if (!cancelled) setSuggestions(r.suggestions) })
      .catch(() => { /* fallback chips remain */ })
    return () => { cancelled = true }
  }, [token])

  const prevSessionRef = useRef<number | null>(null)
  useEffect(() => {
    const switched = prevSessionRef.current !== activeSessionId
    prevSessionRef.current = activeSessionId
    if (skipNextScrollRef.current) {
      skipNextScrollRef.current = false
      return
    }
    bottomRef.current?.scrollIntoView({
      behavior: switched ? 'auto' : 'smooth',
    })
  }, [messages.length, activeSessionId])

  async function newSession() {
    ++selectTokenRef.current
    if (token) {
      const s = await api.createSession(token)
      setSessions(prev => [s, ...prev])
      setActiveSessionId(s.id)
    } else {
      const s = await api.createGuestSession()
      setActiveSessionId(s.id)
    }
    setLoadedMessages([])
    reset()
  }

  async function selectSession(id: number) {
    if (id === activeSessionId) return
    const myToken = ++selectTokenRef.current
    setActiveSessionId(id)
    setLoadedMessages([])
    setHistoryCursor(null)
    setHistoryHasMore(false)
    reset()
    if (!token) return
    try {
      const res = await api.getTurns(id, token, { limit: 20 })
      if (myToken !== selectTokenRef.current) return
      const msgs = parseTurns(res.turns)
      setLoadedMessages(msgs)
      setHistoryHasMore(res.has_more)
      setHistoryCursor(res.next_cursor)
    } catch (e) {
      console.error('[selectSession] failed to load turns for', id, e)
    }
  }

  async function loadOlderMessages() {
    if (!token || !activeSessionId || !historyCursor || historyLoading) return
    setHistoryLoading(true)
    const myToken = selectTokenRef.current
    try {
      const res = await api.getTurns(activeSessionId, token, {
        limit: 20,
        before: historyCursor,
      })
      if (myToken !== selectTokenRef.current) return
      const older = parseTurns(res.turns)
      skipNextScrollRef.current = true
      setLoadedMessages(prev => [...older, ...prev])
      setHistoryHasMore(res.has_more)
      setHistoryCursor(res.next_cursor)
    } catch { /* ignore */ }
    finally {
      setHistoryLoading(false)
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

  const handleAnswer = useCallback((answer: string, questionCardId: string) => {
    sendMessage(answer, questionCardId)
  }, [sendMessage])

  const messagesRef = useRef(messages)
  messagesRef.current = messages

  function latestProductIds(): number[] {
    const messages = messagesRef.current
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

  const streamingRef = useRef(streaming)
  streamingRef.current = streaming
  const handleIntent = useCallback((intent: string, payload?: unknown) => {
    if (streamingRef.current) return
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
  }, [sendMessage])

  async function handleDeleteSession(e: MouseEvent, id: number) {
    e.stopPropagation()
    if (!token || !confirm('Delete this conversation?')) return
    await api.deleteSession(id, token)
    const remaining = sessions.filter(s => s.id !== id)
    setSessions(remaining)
    if (activeSessionId === id) {
      if (remaining.length > 0) selectSession(remaining[0].id)
      else newSession()
    }
  }

  function handleCorrect(text: string) {
    if (streaming) return
    sendMessage(`Correction from you: ${text}`)
  }

  return (
    <div className={styles.layout}>
      <main className={styles.main}>
        <div className={styles.masonHeader}>
          <div className={styles.masonHeaderAvatar}>
            <img src="/mason/mason-1.png" alt="" />
          </div>
          <div className={styles.masonHeaderText}>
            <span className={styles.masonHeaderName}>Mason</span>
            <span className={styles.masonHeaderStatus}>
              {streaming
                ? agentState === 'tool'
                  ? 'looking'
                  : agentState === 'replying'
                    ? 'replying'
                    : 'thinking'
                : 'available'}
            </span>
          </div>
        </div>
        {messages.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}><MasonChip /></div>
            <h2>
              {user
                ? `Welcome back, ${user.display_name ?? user.email?.split('@')[0] ?? 'friend'} — anything I can help you find today?`
                : 'Experience your local shopping assistant today'}
            </h2>
            {!token && (
              <p className={styles.guestHint}>
                <button onClick={() => navigate('/login')} className={styles.inlineLink}>Sign in</button> to save your preferences and shopping history.
              </p>
            )}
            <div className={styles.suggestions}>
              {FALLBACK_SUGGESTIONS.map(s => (
                <button
                  key={s}
                  className={styles.suggestion}
                  disabled={streaming}
                  onClick={async () => {
                    if (streaming) return
                    if (!activeSessionId) {
                      const sess = token
                        ? await api.createSession(token)
                        : await api.createGuestSession()
                      if (token) setSessions(prev => [sess, ...prev])
                      setActiveSessionId(sess.id)
                      setTimeout(() => sendMessage(s), 50)
                      return
                    }
                    sendMessage(s)
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className={styles.messages}>
            {historyHasMore && (
              <div className={styles.loadOlderWrap}>
                <button
                  className={styles.loadOlderBtn}
                  onClick={loadOlderMessages}
                  disabled={historyLoading}
                >
                  {historyLoading ? 'Loading…' : 'Load older messages'}
                </button>
              </div>
            )}
            {messages.map((msg, idx) => (
              <div key={msg.id} className={`${styles.row} ${msg.from === 'user' ? styles.userRow : styles.agentRow}`}>
                {msg.from === 'agent' && (
                  <div className={styles.agentAvatar}>
                    <MasonChip />
                    {streaming && idx === lastAgentIdx && (
                      <button
                        type="button"
                        className={styles.thinkingBar}
                        onClick={() => mason.openDrawer()}
                        aria-label="Open Mason reasoning"
                      >
                        <span className={styles.thinkingDot} />
                        <span className={styles.thinkingLabel}>
                          {agentState === 'tool' ? 'Looking…' : agentState === 'replying' ? 'Replying…' : 'Thinking…'}
                        </span>
                      </button>
                    )}
                  </div>
                )}
                <div className={styles.bubble}>
                  {msg.from === 'user' ? (
                    <p className={styles.userText}>{msg.text}</p>
                  ) : (
                    <AgentErrorBoundary>
                      <AgentMessage
                        events={msg.events ?? []}
                        streaming={streaming && idx === lastAgentIdx}
                        onAnswer={handleAnswer}
                        onIntent={handleIntent}
                      />
                    </AgentErrorBoundary>
                  )}
                </div>
                {msg.from === 'user' && <div className={styles.userAvatar}>👤</div>}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}

        <form className={styles.inputBar} onSubmit={handleSubmit}>
          <textarea
            className={styles.textarea}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Mason…"
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

      <MasonDrawer
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={selectSession}
        onNewSession={newSession}
        onDeleteSession={handleDeleteSession}
        plan={plan}
        messages={messages}
        streaming={streaming}
        onCorrect={handleCorrect}
        user={user}
        token={token}
        onSignIn={() => navigate('/login')}
      />
    </div>
  )
}
