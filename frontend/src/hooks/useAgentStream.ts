import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from './useAuth'
import { A2uiComponent } from '../a2ui/types'

const BASE = import.meta.env.VITE_API_URL ?? 'https://backend-production-c5f5.up.railway.app'

export type MasonMode = 'auto' | 'fast' | 'thinking'

export type StreamEvent =
  | { type: 'thinking'; content: string }
  | { type: 'text'; content: string }
  | { type: 'tool_call'; tool: string; args: Record<string, unknown>; id: string }
  | { type: 'tool_result'; tool: string; result: unknown }
  | { type: 'ui_tree'; root: string; components: A2uiComponent[]; tool_use_id: string }
  | { type: 'plan_update'; steps: Array<{ step: number; description: string; done: boolean }> }
  | { type: 'meta'; mode: 'fast' | 'full'; classify_ms?: number; decided_by?: string }
  | { type: 'error'; error: string; traceback?: string }
  | { type: 'done' }

export interface Message {
  id: string
  from: 'user' | 'agent'
  text?: string
  events?: StreamEvent[]
  questionCardId?: string
}

interface TurnStartResponse {
  run_id: number
  session_id: number
  status: string
}

export class MaxBackgroundRunsError extends Error {
  constructor() {
    super('max_background_turns')
    this.name = 'MaxBackgroundRunsError'
  }
}

export class TurnAlreadyInProgressError extends Error {
  constructor() {
    super('A turn is already in progress for this session')
    this.name = 'TurnAlreadyInProgressError'
  }
}

/**
 * Mason turns are now durable jobs: POST /api/agent/turn returns a `run_id` and
 * the backend runs the turn detached from this socket. We attach to it via
 * GET /api/agent/runs/{run_id}/stream, which replays already-emitted events and
 * then tails the live stream. Leaving the page (unmount) just drops the reader;
 * the run keeps going server-side until we re-attach (or it finishes on its own).
 */
export function useAgentStream(sessionId: number | null) {
  const { token } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [streaming, setStreaming] = useState(false)
  const [plan, setPlan] = useState<Array<{ step: number; description: string; done: boolean }>>([])
  const [activeRunId, setActiveRunId] = useState<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // Highest seq applied to the current agent message — lets a reconnect skip
  // past events we've already rendered.
  const lastSeqRef = useRef(0)
  // Mirror sessionId in a ref so sendMessage always sees the latest value
  // without needing the callback to be re-created. Callers can also pass an
  // explicit override (used when sending the first message in a fresh session
  // before React has flushed the state update).
  const sessionIdRef = useRef(sessionId)
  useEffect(() => { sessionIdRef.current = sessionId }, [sessionId])
  const streamingRef = useRef(streaming)
  useEffect(() => { streamingRef.current = streaming }, [streaming])

  const consumeStream = useCallback(async (
    runId: number,
    agentMsgId: string,
    afterSeq: number,
  ) => {
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    setStreaming(true)
    setActiveRunId(runId)

    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`

    try {
      const res = await fetch(
        `${BASE}/api/agent/runs/${runId}/stream?after_seq=${afterSeq}`,
        { headers, signal: abortRef.current.signal },
      )
      if (!res.ok || !res.body) throw new Error('Stream failed')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const event: StreamEvent = JSON.parse(line)
            lastSeqRef.current += 1
            if (event.type === 'plan_update') {
              setPlan(event.steps)
            }
            if (event.type === 'error') {
              console.error('agent stream error:', event.error, event.traceback)
            }
            const visibleEvents: StreamEvent[] =
              event.type === 'error'
                ? [event, { type: 'text', content: `⚠️ Agent error: ${event.error}` }]
                : [event]
            setMessages(prev =>
              prev.map(m =>
                m.id === agentMsgId
                  ? { ...m, events: [...(m.events ?? []), ...visibleEvents] }
                  : m,
              ),
            )
          } catch (err) {
            if (import.meta.env.DEV) {
              console.warn('useAgentStream: dropped malformed NDJSON line', line, err)
            }
          }
        }
      }
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') {
        setMessages(prev =>
          prev.map(m =>
            m.id === agentMsgId
              ? { ...m, events: [...(m.events ?? []), { type: 'text', content: 'Something went wrong. Please try again.' }] }
              : m,
          ),
        )
      }
    } finally {
      setStreaming(false)
      setActiveRunId(null)
    }
  }, [token])

  const sendMessage = useCallback(async (
    text: string,
    questionCardId?: string,
    mode: MasonMode = 'auto',
    overrideSessionId?: number,
  ) => {
    const sessionId = overrideSessionId ?? sessionIdRef.current
    if (!sessionId || streamingRef.current) return

    const userMsg: Message = { id: Date.now().toString(), from: 'user', text }
    setMessages(prev => [...prev, userMsg])

    const agentMsgId = (Date.now() + 1).toString()
    const agentMsg: Message = { id: agentMsgId, from: 'agent', events: [] }
    setMessages(prev => [...prev, agentMsg])
    lastSeqRef.current = 0

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`

    let runId: number
    try {
      const res = await fetch(`${BASE}/api/agent/turn`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          session_id: sessionId,
          message: text,
          question_card_id: questionCardId,
          mode_override: mode === 'auto' ? null : mode === 'thinking' ? 'full' : 'fast',
        }),
      })
      if (res.status === 429) {
        const body = await res.json().catch(() => ({}))
        if (body?.detail === 'max_background_turns') throw new MaxBackgroundRunsError()
        if (body?.detail === 'A turn is already in progress for this session') throw new TurnAlreadyInProgressError()
        throw new Error(typeof body?.detail === 'string' ? body.detail : 'Rate limited')
      }
      if (!res.ok) throw new Error('Failed to start turn')
      const body = (await res.json()) as TurnStartResponse
      runId = body.run_id
    } catch (e) {
      setMessages(prev =>
        prev.map(m =>
          m.id === agentMsgId
            ? {
                ...m,
                events: [
                  ...(m.events ?? []),
                  {
                    type: 'text',
                    content: e instanceof MaxBackgroundRunsError
                      ? "You've got 3 Mason chats running already — finish or cancel one before starting another."
                      : e instanceof TurnAlreadyInProgressError
                      ? "Mason is still thinking — please wait a moment before sending another message."
                      : 'Something went wrong. Please try again.',
                  },
                ],
              }
            : m,
        ),
      )
      return
    }

    await consumeStream(runId, agentMsgId, 0)
  }, [token, consumeStream])

  /**
   * Re-attach to an in-flight run for the current session. Used when the user
   * opens a chat that's still working in the background.
   */
  const attachToRun = useCallback(async (runId: number) => {
    // Tear down any in-flight reader from a previous session before attaching.
    // Without this, switching from one streaming chat into another would
    // silently no-op (streamingRef still true) and leave the new chat blank.
    abortRef.current?.abort()
    abortRef.current = null
    // Insert a fresh empty agent bubble — the replay will populate it.
    const agentMsgId = (Date.now() + 1).toString()
    setMessages(prev => [...prev, { id: agentMsgId, from: 'agent', events: [] }])
    lastSeqRef.current = 0
    await consumeStream(runId, agentMsgId, 0)
  }, [consumeStream])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setMessages([])
    setPlan([])
    setStreaming(false)
    setActiveRunId(null)
    lastSeqRef.current = 0
  }, [])

  // Drop the reader on unmount so we don't keep a stranded fetch open. The
  // server-side run keeps going on its own.
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  return { messages, setMessages, streaming, plan, setPlan, sendMessage, attachToRun, reset, activeRunId }
}
