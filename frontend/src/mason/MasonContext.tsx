import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react'

export type AgentState = 'idle' | 'thinking' | 'tool' | 'replying'

interface MasonContextValue {
  isOpen: boolean
  isPopped: boolean
  openDrawer: () => void
  closeDrawer: () => void
  toggleDrawer: () => void
  agentState: AgentState
  setAgentState: (s: AgentState) => void
}

const MasonContext = createContext<MasonContextValue | null>(null)

const DESKTOP_QUERY = '(min-width: 769px)'

function getInitialOpen(): boolean {
  if (typeof window === 'undefined') return true
  return window.matchMedia(DESKTOP_QUERY).matches
}

export function MasonProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState<boolean>(getInitialOpen)
  const [agentState, setAgentState] = useState<AgentState>('idle')

  // On resize transitions, default to open on desktop and closed on mobile.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia(DESKTOP_QUERY)
    const handler = (e: MediaQueryListEvent) => setIsOpen(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const openDrawer = useCallback(() => setIsOpen(true), [])
  const closeDrawer = useCallback(() => setIsOpen(false), [])
  const toggleDrawer = useCallback(() => setIsOpen(o => !o), [])

  const value = useMemo<MasonContextValue>(() => ({
    isOpen,
    isPopped: true,
    openDrawer,
    closeDrawer,
    toggleDrawer,
    agentState,
    setAgentState,
  }), [isOpen, openDrawer, closeDrawer, toggleDrawer, agentState])

  return <MasonContext.Provider value={value}>{children}</MasonContext.Provider>
}

export function useMason(): MasonContextValue {
  const ctx = useContext(MasonContext)
  if (!ctx) throw new Error('useMason must be used within MasonProvider')
  return ctx
}
