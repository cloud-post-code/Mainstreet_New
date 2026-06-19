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
import { MemoryProvider } from '../mason/MemoryContext'
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
  id: number
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
      if (text) msgs.push({ id: `turn-${t.id}-u`, from: 'user', text })
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
      if (events.length) msgs.push({ id: `turn-${t.id}-a`, from: 'agent', events })
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

const SESSIONS_PAGE_SIZE = 50

export default function Chat() {
  const { token, user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const mason = useMason()
  const [sessions, setSessions] = useState<Session[]>([])
  const [sessionsHasMore, setSessionsHasMore] = useState(false)
  const [sessionsLoadingMore, setSessionsLoadingMore] = useState(false)
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
  const [micRecording, setMicRecording] = useState(false)
  const [micError, setMicError] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const [attachedImage, setAttachedImage] = useState<{ url: string; preview: string } | null>(null)
  const [attachError, setAttachError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const { messages: liveMessages, streaming, plan, sendMessage, attachToRun, reset } = useAgentStream(activeSessionId)
  const [runningSessionIds, setRunningSessionIds] = useState<Set<number>>(new Set())
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
      // A finished run may have updated this session's title — refresh the
      // sidebar so background-completed chats reflect their first message.
      if (token) {
        api.getSessions(token, 'shop').then(s => {
          setSessions(s)
          setSessionsHasMore(s.length === SESSIONS_PAGE_SIZE)
        }).catch(() => { /* ignore */ })
      }
      // Second refresh after a short delay catches tool results (e.g. saved
      // products, board updates) that commit slightly after the done event.
      setTimeout(() => { masonMemory.refresh() }, 800)
    }
    prevStreamingRef.current = streaming
  }, [streaming, cart, masonMemory, activeSessionId, mode, token])

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
      setSessionsHasMore(s.length === SESSIONS_PAGE_SIZE)
      if (requested) {
        const id = Number(requested)
        if (Number.isFinite(id) && s.some(x => x.id === id)) {
          // Use selectSession so we also auto-attach if the chat is still
          // running in the background.
          selectSession(id)
          return
        }
      }
      // Defer session creation until the user actually sends a message
      // so empty "New conversation" entries don't pile up in history.
      setActiveSessionId(null)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  // Guest sessions are also created lazily on first send (see handleSubmit).

  useEffect(() => {
    if (!token) { setSuggestions(null); return }
    let cancelled = false
    api.getSuggestions(token)
      .then(r => { if (!cancelled) setSuggestions(r.suggestions) })
      .catch(() => { /* fallback chips remain */ })
    return () => { cancelled = true }
  }, [token])

  // Poll background runs so the sidebar dot reflects what's still working
  // across chats. Cheap query (indexed by user_id+status). 5s feels live enough.
  useEffect(() => {
    if (!token) { setRunningSessionIds(new Set()); return }
    let cancelled = false
    async function refresh() {
      try {
        const r = await api.getActiveRuns(token as string)
        if (cancelled) return
        setRunningSessionIds(new Set(r.runs.map(x => x.session_id)))
      } catch {
        /* transient — leave previous set in place */
      }
    }
    refresh()
    const id = window.setInterval(refresh, 5000)
    return () => { cancelled = true; window.clearInterval(id) }
  }, [token, streaming])

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
    // Defer creating a backend session until the user sends a message,
    // so opening "New task" without typing doesn't leave an empty
    // "New conversation" entry in history.
    setActiveSessionId(null)
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
      // If this session has an in-flight background turn, re-attach to it so
      // the user sees the live response continue from wherever it is.
      try {
        const active = await api.getActiveRunForSession(id, token)
        if (myToken === selectTokenRef.current && active?.run_id) {
          await attachToRun(active.run_id)
        }
      } catch {
        /* no active run, or transient — ignore */
      }
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
      setLoadedMessages(prev => {
        const seen = new Set(prev.map(m => m.id))
        const deduped = older.filter(m => !seen.has(m.id))
        return [...deduped, ...prev]
      })
      setHistoryHasMore(res.has_more)
      setHistoryCursor(res.next_cursor)
    } catch { /* ignore */ }
    finally {
      setHistoryLoading(false)
    }
  }

  const [goalBanner, setGoalBanner] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if ((!input.trim() && !attachedImage) || streaming) return
    const text = input.trim()

    // /goal <text> — set the session goal without sending to Mason
    if (text.startsWith('/goal ') || text === '/goal') {
      const goalText = text.slice(6).trim()
      if (!goalText) return
      setInput('')
      if (!token) { setGoalBanner('Sign in to set a goal.'); return }
      let sessionId = activeSessionId
      if (!sessionId) {
        const s = await api.createSession(token)
        setSessions(prev => [s, ...prev])
        setActiveSessionId(s.id)
        sessionId = s.id
      }
      try {
        await api.setSessionGoal(sessionId, goalText, token)
        setGoalBanner(`Goal set: "${goalText}" — Mason will update your notes 30 min into the conversation.`)
      } catch {
        setGoalBanner('Could not set goal. Please try again.')
      }
      return
    }

    setInput('')
    const messageText = attachedImage
      ? (text ? `${text}\n[image: ${attachedImage.url}]` : `[image: ${attachedImage.url}]`)
      : text
    if (attachedImage) {
      URL.revokeObjectURL(attachedImage.preview)
      setAttachedImage(null)
    }

    track('mason_message_sent', {
      session_id: activeSessionId,
      surface: 'chat',
      mode,
      message_length: text.length,
      user_message: text,
      is_authenticated: !!token,
    })
    sentAtRef.current = performance.now()

    if (!activeSessionId) {
      const s = token
        ? await api.createSession(token)
        : await api.createGuestSession()
      if (token) setSessions(prev => [s, ...prev])
      setActiveSessionId(s.id)
      await sendMessage(messageText, undefined, mode, s.id)
      return
    }
    await sendMessage(messageText, undefined, mode)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e as unknown as FormEvent)
    }
  }

  const handleMic = useCallback(async () => {
    setMicError(null)
    if (micRecording) { mediaRecorderRef.current?.stop(); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      audioChunksRef.current = []
      recorder.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data) }
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        setMicRecording(false)
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        try {
          const BASE = import.meta.env.VITE_API_URL ?? 'https://backend-production-c5f5.up.railway.app'
          const res = await fetch(`${BASE}/api/agent/transcribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'audio/webm', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: blob,
          })
          if (!res.ok) throw new Error('Transcription failed')
          const { text } = await res.json()
          if (text) setInput(prev => (prev ? `${prev} ${text}` : text))
        } catch { setMicError('Transcription failed. Please try again.') }
      }
      recorder.start()
      mediaRecorderRef.current = recorder
      setMicRecording(true)
    } catch { setMicError('Microphone access denied.') }
  }, [micRecording, token])

  const handleAttach = useCallback(() => { setAttachError(null); fileInputRef.current?.click() }, [])

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    ;(e.target as HTMLInputElement).value = ''
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { setAttachError('Image too large (max 5 MB)'); return }
    const preview = URL.createObjectURL(file)
    try {
      const BASE = import.meta.env.VITE_API_URL ?? 'https://backend-production-c5f5.up.railway.app'
      const res = await fetch(`${BASE}/api/agent/upload-image`, {
        method: 'POST',
        headers: { 'Content-Type': file.type, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: file,
      })
      if (!res.ok) throw new Error('Upload failed')
      const { url } = await res.json()
      setAttachedImage({ url, preview })
    } catch { URL.revokeObjectURL(preview); setAttachError('Image upload failed. Please try again.') }
  }, [token])

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
    } else if (intent === 'remix_current') {
      sendMessage('Show me 15 remixes and variations of what you just showed me')
    } else if (typeof p.label === 'string' && p.label) {
      sendMessage(p.label)
    } else {
      sendMessage(intent)
    }
  }, [sendMessage])

  async function loadMoreSessions() {
    if (!token || sessionsLoadingMore) return
    setSessionsLoadingMore(true)
    try {
      const older = await api.getSessions(token, 'shop', {
        limit: SESSIONS_PAGE_SIZE,
        offset: sessions.length,
      })
      setSessions(prev => {
        const seen = new Set(prev.map(s => s.id))
        return [...prev, ...older.filter(s => !seen.has(s.id))]
      })
      setSessionsHasMore(older.length === SESSIONS_PAGE_SIZE)
    } catch {
      /* ignore */
    } finally {
      setSessionsLoadingMore(false)
    }
  }

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
    <MemoryProvider memory={masonMemory}>
    <div className={styles.layout}>
      <main className={styles.main}>
        {messages.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}><MasonChip /></div>
            <h2 className={styles.emptyHeading}>
              {user
                ? `Hey ${user.display_name ?? user.email?.split('@')[0] ?? 'there'} — what are we finding today?`
                : 'Your neighborhood shopping assistant'}
            </h2>
            <p className={styles.emptyTagline}>
              {user
                ? 'Tell me what you\'re looking for and I\'ll find it from real local shops.'
                : 'Ask Mason anything — gift ideas, home goods, local finds, and more.'}
            </p>
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
                    await sendMessage(s, undefined, 'auto', sess.id)
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
                        onShuffleMessage={(productName) => sendMessage(`Show me 15 items similar to ${productName}`)}
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

        {goalBanner && (
          <div className={styles.goalBanner}>
            <span>{goalBanner}</span>
            <button type="button" className={styles.goalBannerClose} onClick={() => setGoalBanner(null)} aria-label="Dismiss">×</button>
          </div>
        )}

        {attachedImage && (
          <div className={styles.imagePreviewBar}>
            <img src={attachedImage.preview} alt="attachment" className={styles.imagePreviewThumb} />
            <button
              type="button"
              className={styles.imagePreviewRemove}
              onClick={() => { URL.revokeObjectURL(attachedImage.preview); setAttachedImage(null) }}
              aria-label="Remove image"
            >×</button>
          </div>
        )}
        {(micError || attachError) && (
          <div className={styles.composerError}>{micError || attachError}</div>
        )}
        <form className={styles.inputBar} onSubmit={handleSubmit}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
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
              <div className={styles.composerLeft}>
                <button
                  type="button"
                  className={styles.iconActionBtn}
                  onClick={handleAttach}
                  disabled={!!attachedImage}
                  aria-label="Attach image"
                  title="Attach image"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                </button>
                <button
                  type="button"
                  className={`${styles.iconActionBtn} ${micRecording ? styles.iconActionBtnActive : ''}`}
                  onClick={handleMic}
                  aria-label={micRecording ? 'Stop recording' : 'Voice input'}
                  title={micRecording ? 'Tap to stop' : 'Voice input'}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </svg>
                </button>
              </div>
              <div className={styles.composerRight}>
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
              <button className={styles.sendButton} type="submit" disabled={(!input.trim() && !attachedImage) || streaming} aria-label="Send">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
              </div>
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
        runningSessionIds={runningSessionIds}
        hasMoreSessions={sessionsHasMore}
        loadingMoreSessions={sessionsLoadingMore}
        onLoadMoreSessions={loadMoreSessions}
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
    </MemoryProvider>
  )
}
