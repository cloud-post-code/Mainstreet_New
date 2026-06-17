import { createContext, useContext, ReactNode } from 'react'
import { MasonMemory } from './useMasonMemory'

const MemoryContext = createContext<MasonMemory | null>(null)

export function MemoryProvider({ memory, children }: { memory: MasonMemory; children: ReactNode }) {
  return <MemoryContext.Provider value={memory}>{children}</MemoryContext.Provider>
}

export function useMemory(): MasonMemory | null {
  return useContext(MemoryContext)
}
