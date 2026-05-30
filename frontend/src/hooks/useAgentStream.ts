import { useState, useCallback, useRef } from 'react'
import { useAuth } from './useAuth'
import { A2uiComponent } from '../a2ui/types'

const BASE = import.meta.env.VITE_API_URL ?? 'https://backend-production-c5f5.up.railway.app'

export type StreamEvent =
  | { type: 'thinking'; content: string }
  | { type: 'text'; content: string }
  | { type: 'tool_call'; tool: string; args: Record<string, unknown>; id: string }
  | { type: 'tool_result'; tool: string; result: unknown }
  | { type: 'ui_tree'; root: string; components: A2uiComponent[]; tool_use_id: string }
  | { type: 'plan_update'; steps: Array<{ step: number; description: string; done: boolean }> }
  | { type: 'done' }

export interface Message {
  id: string
  from: 'user' | 'agent'
  text?: string
  events?: StreamEvent[]
  questionCardId?: string
}

export function useAgentStream(sessionId: number | null) {
  const { token } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [streaming, setStreaming] = useState(false)
  const [plan, setPlan] = useState<Array<{ step: number; description: string; done: boolean }>>([])
  const abortRef = useRef<AbortController | null>(null)

  const sendMessage = useCallback(async (text: string, questionCardId?: string) => {
    if (!sessionId || streaming) return

    const userMsg: Message = { id: Date.now().toString(), from: 'user', text }
    setMessages(prev => [...prev, userMsg])

    const agentMsgId = (Date.now() + 1).toString()
    const agentMsg: Message = { id: agentMsgId, from: 'agent', events: [] }
    setMessages(prev => [...prev, agentMsg])

    setStreaming(true)
    abortRef.current = new AbortController()

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`

    try {
      const res = await fetch(`${BASE}/api/agent/turn`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ session_id: sessionId, message: text, question_card_id: questionCardId }),
        signal: abortRef.current.signal,
      })

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
            if (event.type === 'plan_update') {
              setPlan(event.steps)
            }
            setMessages(prev =>
              prev.map(m =>
                m.id === agentMsgId
                  ? { ...m, events: [...(m.events ?? []), event] }
                  : m
              )
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
              : m
          )
        )
      }
    } finally {
      setStreaming(false)
    }
  }, [sessionId, token, streaming])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setMessages([])
    setPlan([])
    setStreaming(false)
  }, [])

  return { messages, streaming, plan, setPlan, sendMessage, reset }
}
