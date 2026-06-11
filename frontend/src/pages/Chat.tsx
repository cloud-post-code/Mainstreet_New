import { useCallback, useEffect, useMemo, useRef, useState, FormEvent, KeyboardEvent, MouseEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useAgentStream, StreamEvent, MasonMode } from '../hooks/useAgentStream'
import { api, Session } from '../api'
import AgentMessage from '../components/AgentMessage'
import AgentErrorBoundary from '../components/AgentErrorBoundary'
import MasonDrawer from '../components/MasonDrawer'
import MasonChip from '../components/MasonChip'
import ProductModal, { ProductModalData } from '../components/ProductModal'
import { useMason, AgentState } from '../mason/MasonContext'
import { useMasonMemory } from '../mason/useMasonMemory'
import { useCart } from '../cart/CartContext'
import { track } from '../analytics/posthog'
import MasonFeedback from '../components/MasonFeedback'
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
  const location = useLocation()
  const mason = useMason()
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null)
  const [input, setInput] = useState('')
  const [loadedMessages, setLoadedMessages] = useState<import('../hooks/useAgentStream').Message[]>([])
  const [historyCursor, setHistoryCursor] = useState<string | null>(null)
  const [historyHasMore, setHistoryHasMore] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [suggestions, setSuggestions] = useState<string[] | null>(null)
  const [modalProduct, setModalProduct] = useState<ProductModalData | null>(null)
  const [mode, setMode] = useState<MasonMode>('auto')
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const modeMenuRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const selectTokenRef = useRef(0)
  const skipNextScrollRef = useRef(false)

  const { messages: liveMessages, streaming, plan, sendMessage, reset } = useAgentStream(activeSessionId)
  const cart = useCart()
  const masonMemory = useMasonMemory(token)
  const prevStreamingRef = useRef(streaming)
  const sentAtRef = useRef<number | null>(null)
  useEffect(() => {
    if (prevStreamingRef.current && !streaming) {
      cart.refresh()
      // Pick up any save_note / save_preference / save_product that ran this turn.
      masonMemory.refresh()
      track('mason_response_rendered', {
        session_id: activeSessionId,
        surface: 'chat',
        mode,
        latency_perceived_ms: sentAtRef.current != null
          ? Math.round(performance.now() - sentAtRef.current)
          : null,
      })
      sentAtRef.current = null
    }
    prevStreamingRef.current = streaming
  }, [streaming, cart, masonMemory, activeSessionId, mode])

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
    // Honor ?session=<id> for deep links (e.g. opening an inbox message);
    // otherwise start a fresh shop session so prior turns aren't replayed
    // to the model. Past sessions remain available through the history UI.
    const params = new URLSearchParams(location.search)
    const requested = params.get('session')
    api.getSessions(token, 'shop').then(async s => {
      setSessions(s)
      if (requested) {
        const id = Number(requested)
        if (Number.isFinite(id) && s.some(x => x.id === id)) {
          setActiveSessionId(id)
          return
        }
      }
      const created = await api.createSession(token)
      setSessions(prev => [created, ...prev])
      setActiveSessionId(created.id)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  useEffect(() => {
    if (!modeMenuOpen) return
    function onDocClick(e: globalThis.MouseEvent) {
      if (modeMenuRef.current && !modeMenuRef.current.contains(e.target as Node)) {
        setModeMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [modeMenuOpen])

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

  const lastNewChatRef = useRef<number | null>(null)
  useEffect(() => {
    const stamp = (location.state as { newChat?: number } | null)?.newChat
    if (!stamp) return
    if (lastNewChatRef.current === stamp) return
    lastNewChatRef.current = stamp
    newSession()
    navigate('/', { replace: true, state: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state])

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

    track('mason_message_sent', {
      session_id: activeSessionId,
      surface: 'chat',
      mode,
      message_length: text.length,
      is_authenticated: !!token,
    })
    sentAtRef.current = performance.now()

    if (!activeSessionId) {
      const s = token
        ? await api.createSession(token)
        : await api.createGuestSession()
      if (token) setSessions(prev => [s, ...prev])
      setActiveSessionId(s.id)
      setTimeout(() => sendMessage(text, undefined, mode), 50)
      return
    }
    await sendMessage(text, undefined, mode)
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

  function findProductProps(productId: number): ProductModalData | null {
    const messages = messagesRef.current
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.from !== 'agent') continue
      const events = m.events ?? []
      for (let j = events.length - 1; j >= 0; j--) {
        const e = events[j]
        if (e.type !== 'ui_tree') continue
        const tree = e as Extract<import('../hooks/useAgentStream').StreamEvent, { type: 'ui_tree' }>
        for (const c of tree.components) {
          if (c.type !== 'product_card') continue
          const p = c.props as Record<string, unknown>
          if (p.product_id !== productId) continue
          return {
            product_id: productId,
            name: typeof p.name === 'string' ? p.name : `Product ${productId}`,
            price: typeof p.price === 'number' ? p.price : Number(p.price ?? 0),
            quantity: typeof p.quantity === 'number' ? p.quantity : (p.quantity != null ? Number(p.quantity) : undefined),
            image_url: typeof p.image_url === 'string' ? p.image_url : null,
            shop_id: typeof p.shop_id === 'number' ? p.shop_id : undefined,
            shop_name: typeof p.shop_name === 'string' ? p.shop_name : '',
            description_summary: typeof p.description_summary === 'string' ? p.description_summary : undefined,
            description_long: typeof p.description_long === 'string' ? p.description_long : undefined,
            tags: Array.isArray(p.tags) ? (p.tags as unknown[]).filter((t): t is string => typeof t === 'string') : undefined,
            variants: Array.isArray(p.variants)
              ? (p.variants as unknown[]).flatMap((raw) => {
                  if (!raw || typeof raw !== 'object') return []
                  const v = raw as Record<string, unknown>
                  const vid = typeof v.variant_id === 'number' ? v.variant_id : Number(v.variant_id)
                  if (!Number.isFinite(vid)) return []
                  return [{
                    variant_id: vid,
                    option_names: Array.isArray(v.option_names)
                      ? (v.option_names as unknown[]).filter((x): x is string => typeof x === 'string')
                      : undefined,
                    option_values: Array.isArray(v.option_values)
                      ? (v.option_values as unknown[]).filter((x): x is string => typeof x === 'string')
                      : undefined,
                    variant_label: typeof v.variant_label === 'string' ? v.variant_label : null,
                    price: typeof v.price === 'number' ? v.price : Number(v.price ?? 0),
                    quantity: typeof v.quantity === 'number' ? v.quantity : Number(v.quantity ?? 0),
                    image_url: typeof v.image_url === 'string' ? v.image_url : null,
                  }]
                })
              : undefined,
            default_variant_id: typeof p.default_variant_id === 'number' ? p.default_variant_id : undefined,
          }
        }
      }
    }
    return null
  }

  const streamingRef = useRef(streaming)
  streamingRef.current = streaming
  const handleIntent = useCallback((intent: string, payload?: unknown) => {
    if (streamingRef.current) return
    const p: Record<string, unknown> =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    if (intent === 'open_details') {
      const pid = typeof p.product_id === 'number' ? p.product_id : null
      if (pid != null) {
        const found = findProductProps(pid)
        const fallbackName = typeof p.name === 'string' ? p.name : `Product ${pid}`
        track('mason_product_clicked', {
          session_id: activeSessionId,
          product_id: pid,
          product_name: found?.name ?? fallbackName,
          shop_name: found?.shop_name ?? null,
          source: 'mason_response',
        })
        setModalProduct(found ?? {
          product_id: pid,
          name: fallbackName,
          price: 0,
          shop_name: '',
        })
      }
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

  return (
    <div className={styles.layout}>
      <main className={styles.main}>
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
                    // Welcome chips always start a fresh conversation. The
                    // empty-state view can render while activeSessionId still
                    // points at a prior session (auto-attached on login or
                    // left over after reset), and reusing that id would bleed
                    // earlier turns into Claude's context via load_short_term.
                    const sess = token
                      ? await api.createSession(token)
                      : await api.createGuestSession()
                    if (token) setSessions(prev => [sess, ...prev])
                    ++selectTokenRef.current
                    setActiveSessionId(sess.id)
                    setLoadedMessages([])
                    setHistoryCursor(null)
                    setHistoryHasMore(false)
                    reset()
                    setTimeout(() => sendMessage(s), 50)
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
                      {!streaming && idx === lastAgentIdx && (
                        <MasonFeedback
                          sessionId={activeSessionId}
                          messageId={String(msg.id)}
                          surface="chat"
                        />
                      )}
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
          <div className={styles.inputWrap}>
            <textarea
              className={styles.textarea}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask Mason…"
              rows={1}
              disabled={streaming}
            />
            <div className={styles.composerActions}>
              <div className={styles.modeDropdown} ref={modeMenuRef}>
                <button
                  type="button"
                  className={styles.modeTrigger}
                  aria-haspopup="listbox"
                  aria-expanded={modeMenuOpen}
                  onClick={() => setModeMenuOpen(o => !o)}
                  title={
                    mode === 'fast'
                      ? 'Fast: skip the router, run Fast Mason (quicker, simpler answers)'
                      : mode === 'thinking'
                        ? 'Thinking: skip the router, run Full Mason (slower, deeper answers)'
                        : 'Auto: let Mason decide (default)'
                  }
                >
                  {mode === 'fast' ? 'Fast' : mode === 'thinking' ? 'Thinking' : 'Auto'}
                  <svg className={styles.modeCaret} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 4.5 6 7.5 9 4.5" />
                  </svg>
                </button>
                {modeMenuOpen && (
                  <div className={styles.modeMenu} role="listbox">
                    {(['auto', 'fast', 'thinking'] as const).map(opt => (
                      <button
                        key={opt}
                        type="button"
                        role="option"
                        aria-selected={mode === opt}
                        className={`${styles.modeMenuItem} ${mode === opt ? styles.modeMenuItemActive : ''}`}
                        onClick={() => {
                          setMode(opt)
                          setModeMenuOpen(false)
                        }}
                      >
                        {opt === 'fast' ? 'Fast' : opt === 'thinking' ? 'Thinking' : 'Auto'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button className={styles.sendButton} type="submit" disabled={!input.trim() || streaming} aria-label="Send">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
          </div>
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
        user={user}
        token={token}
        onSignIn={() => navigate('/login')}
        memory={masonMemory}
      />

      {modalProduct && (
        <ProductModal
          product={modalProduct}
          memory={masonMemory}
          onClose={() => setModalProduct(null)}
          onChatAbout={(name) => sendMessage(`Tell me more about ${name}.`)}
        />
      )}
    </div>
  )
}
