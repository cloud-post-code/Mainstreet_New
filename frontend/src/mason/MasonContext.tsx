import { createContext, useCallback, useContext, useMemo, useState, ReactNode } from 'react'

export type AgentState = 'idle' | 'thinking' | 'tool' | 'replying'

interface MasonContextValue {
  isOpen: boolean
  openDrawer: () => void
  closeDrawer: () => void
  toggleDrawer: () => void
  agentState: AgentState
  setAgentState: (s: AgentState) => void
}

const MasonContext = createContext<MasonContextValue | null>(null)

export function MasonProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [agentState, setAgentState] = useState<AgentState>('idle')

  const openDrawer = useCallback(() => setIsOpen(true), [])
  const closeDrawer = useCallback(() => setIsOpen(false), [])
  const toggleDrawer = useCallback(() => setIsOpen(o => !o), [])

  const value = useMemo<MasonContextValue>(() => ({
    isOpen,
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
