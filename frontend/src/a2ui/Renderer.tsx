import { ReactNode, useMemo } from 'react'
import { A2uiComponent, A2uiTree, IntentHandler } from './types'
import { REGISTRY } from './registry'

interface NodeProps {
  tree: Map<string, A2uiComponent>
  id: string
  onIntent: IntentHandler
}

function Node({ tree, id, onIntent }: NodeProps): ReactNode {
  const node = tree.get(id)
  if (!node) return <div style={{ color: '#c0392b' }}>Missing component: {id}</div>
  const Comp = REGISTRY[node.type]
  if (!Comp) return <div style={{ color: '#c0392b' }}>Unknown type: {node.type}</div>
  const children = (node.children ?? []).map(cid => (
    <Node key={cid} tree={tree} id={cid} onIntent={onIntent} />
  ))
  return (
    <Comp {...node.props} _a2uiId={id} onIntent={onIntent}>
      {children}
    </Comp>
  )
}

export default function Renderer({ tree, onIntent }: { tree: A2uiTree; onIntent: IntentHandler }) {
  const map = useMemo(() => {
    const m = new Map<string, A2uiComponent>()
    for (const c of tree.components) m.set(c.id, c)
    return m
  }, [tree])
  return <Node tree={map} id={tree.root} onIntent={onIntent} />
}
