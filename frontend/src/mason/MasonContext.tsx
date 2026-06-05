import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react'

export type AgentState = 'idle' | 'thinking' | 'tool' | 'replying'

interface MasonContextValue {
  isOpen: boolean
  isPopped: boolean
  openDrawer: () => void
  closeDrawer: () => void
  toggleDrawer: () => void
  popOut: () => void
  popIn: () => void
  togglePop: () => void
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
  const [isPopped, setIsPopped] = useState(false)
  const [agentState, setAgentState] = useState<AgentState>('idle')

  // Keep default open-state aligned with viewport on resize transitions,
  // but only when the user hasn't manually toggled within this breakpoint.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia(DESKTOP_QUERY)
    const handler = (e: MediaQueryListEvent) => {
      // When switching to mobile, collapse to closed + un-pop.
      // When switching to desktop, open inline.
      setIsOpen(e.matches)
      setIsPopped(false)
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const openDrawer = useCallback(() => setIsOpen(true), [])
  const closeDrawer = useCallback(() => { setIsOpen(false); setIsPopped(false) }, [])
  const toggleDrawer = useCallback(() => setIsOpen(o => !o), [])
  const popOut = useCallback(() => { setIsOpen(true); setIsPopped(true) }, [])
  const popIn = useCallback(() => setIsPopped(false), [])
  const togglePop = useCallback(() => setIsPopped(p => !p), [])

  const value = useMemo<MasonContextValue>(() => ({
    isOpen,
    isPopped,
    openDrawer,
    closeDrawer,
    toggleDrawer,
    popOut,
    popIn,
    togglePop,
    agentState,
    setAgentState,
  }), [isOpen, isPopped, openDrawer, closeDrawer, toggleDrawer, popOut, popIn, togglePop, agentState])

  return <MasonContext.Provider value={value}>{children}</MasonContext.Provider>
}

export function useMason(): MasonContextValue {
  const ctx = useContext(MasonContext)
  if (!ctx) throw new Error('useMason must be used within MasonProvider')
  return ctx
}
