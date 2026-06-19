import { ComponentType, ReactNode, useMemo } from 'react'
import { A2uiComponent, A2uiTree, IntentHandler } from './types'
import a2uiStyles from '../components/a2ui/A2ui.module.css'
import ProductCard from '../components/ProductCard'
import { api, Product } from '../api'
import ShopCard from '../components/ShopCard'
import QuestionCard from '../components/QuestionCard'
import PlanDropdown from '../components/PlanDropdown'
import ProductGrid from '../components/a2ui/ProductGrid'
import ComparisonTable from '../components/a2ui/ComparisonTable'
import MultipleChoice from '../components/a2ui/MultipleChoice'
import Questionnaire from '../components/a2ui/Questionnaire'
import ProductDetailsModal from '../components/a2ui/ProductDetailsModal'
import NextActions from '../components/a2ui/NextActions'
import MasonDiscoverCard from '../components/a2ui/MasonDiscoverCard'
import StyleQuestionCard from '../components/a2ui/StyleQuestionCard'
import BoardPicker from '../components/a2ui/BoardPicker'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyComp = ComponentType<any>

const COMPONENTS: Record<string, AnyComp> = {
  product_card: ProductCard,
  product_grid: ProductGrid,
  comparison_table: ComparisonTable,
  multiple_choice: MultipleChoice,
  question_card: QuestionCard,
  questionnaire: Questionnaire,
  product_details_modal: ProductDetailsModal,
  next_actions: NextActions,
  shop_card: ShopCard,
  plan: PlanDropdown,
  mason_discover_card: MasonDiscoverCard,
  style_question_card: StyleQuestionCard,
  board_picker: BoardPicker,
}

interface NodeProps {
  tree: Map<string, A2uiComponent>
  id: string
  onIntent: IntentHandler
  parentLayout?: string
  onShuffleMessage?: (productName: string) => void
}

function Node({ tree, id, onIntent, parentLayout, onShuffleMessage }: NodeProps): ReactNode {
  if (!id || typeof id !== 'string') return null
  const node = tree.get(id)
  if (!node) return <div style={{ color: '#c0392b' }}>Missing component: {id}</div>
  if (!node.type || typeof node.type !== 'string') {
    return <div style={{ color: '#c0392b' }}>Invalid component: {id}</div>
  }
  const p = (node.props && typeof node.props === 'object' ? node.props : {}) as Record<string, unknown>
  const childLayout =
    node.type === 'product_grid' ? (p.layout as string | undefined) : undefined
  const children = (node.children ?? []).map(cid => (
    <Node key={cid} tree={tree} id={cid} onIntent={onIntent} parentLayout={childLayout} onShuffleMessage={onShuffleMessage} />
  ))

  // Inline trivial wrappers — they're a pure CSS shell, not worth a separate file.
  switch (node.type) {
    case 'stack':
      return (
        <div className={a2uiStyles.stack} style={p.gap ? { gap: p.gap as string } : undefined}>
          {children}
        </div>
      )
    case 'text_block':
      return (
        <div className={a2uiStyles.textBlockBubble}>
          <p className={`${a2uiStyles.textBlock} ${p.tone === 'muted' ? a2uiStyles.textBlockMuted : ''}`}>
            {p.content as string}
          </p>
        </div>
      )
    case 'reasoning_block':
      return (
        <details className={a2uiStyles.reasoning}>
          <summary>View reasoning</summary>
          <div className={a2uiStyles.reasoningBody}>{p.summary as string}</div>
        </details>
      )
  }

  const Comp = COMPONENTS[node.type]
  if (!Comp) return <div style={{ color: '#c0392b' }}>Unknown type: {node.type}</div>
  const productCardLayout =
    parentLayout === 'hero' ? 'hero'
      : parentLayout === 'showcase' ? 'compact'
        : parentLayout === 'trio' ? 'grid'
          : parentLayout === 'quad' ? 'grid'
            : (p.layout as string | undefined) ?? (p.variant as string | undefined)
  const compProps =
    node.type === 'product_card'
      ? {
          ...p,
          showAddToCart: (p.showAddToCart as boolean | undefined) ?? true,
          layout: productCardLayout,
          onShuffle: onShuffleMessage
            ? async () => {
                // Chat context: send a message to Mason so the reply builds
                // a full A2UI product grid with text explanation.
                const name = (p as { name?: string }).name ?? 'this item'
                onShuffleMessage(name)
                return [] // return empty — result comes through Mason's reply
              }
            : async () => {
                // Discover / standalone context: show inline similar panel.
                const pid = (p as { product_id?: number }).product_id
                if (!pid) return []
                const results: Product[] = await api.getSimilarProducts(pid, 15)
                return results.map(s => ({
                  product_id: s.id,
                  name: s.name,
                  price: Number(s.price_range?.min ?? 0),
                  image_url: s.image_url,
                  shop_name: s.shop_name ?? '',
                }))
              },
        }
      : p
  return (
    <Comp {...compProps} _a2uiId={id} onIntent={onIntent}>
      {children}
    </Comp>
  )
}

export default function Renderer({ tree, onIntent, onShuffleMessage }: { tree: A2uiTree; onIntent: IntentHandler; onShuffleMessage?: (productName: string) => void }) {
  const map = useMemo(() => {
    const m = new Map<string, A2uiComponent>()
    const components = Array.isArray(tree?.components) ? tree.components : []
    for (const c of components) {
      if (c && typeof c.id === 'string') m.set(c.id, c)
    }
    return m
  }, [tree])
  if (!tree || !tree.root || typeof tree.root !== 'string') {
    if (import.meta.env.DEV) {
      console.warn('[a2ui Renderer] tree missing root', tree)
    }
    return null
  }
  return <Node tree={map} id={tree.root} onIntent={onIntent} onShuffleMessage={onShuffleMessage} />
}
