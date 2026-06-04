import React from 'react'
import { StreamEvent } from '../hooks/useAgentStream'
import Renderer from '../a2ui/Renderer'
import { A2uiTree } from '../a2ui/types'
import AgentErrorBoundary from './AgentErrorBoundary'
import styles from './AgentMessage.module.css'

interface Props {
  events: StreamEvent[]
  streaming?: boolean
  onAnswer: (answer: string, questionCardId: string) => void
  onIntent?: (intent: string, payload?: unknown) => void
}

function AgentMessageImpl({ events, onAnswer, onIntent }: Props) {
  const rendered: React.ReactNode[] = []
  const textBlocks: string[] = []

  function flushText(key: string) {
    if (textBlocks.length) {
      rendered.push(
        <p key={key} className={styles.text}>{textBlocks.splice(0).join('')}</p>
      )
    }
  }

  // Latest ui_tree replaces any earlier one (full-replacement model for MVP)
  const uiTreeEvents = events.filter((e): e is Extract<StreamEvent, { type: 'ui_tree' }> => e.type === 'ui_tree')
  const latestTree: A2uiTree | null = uiTreeEvents.length
    ? { root: uiTreeEvents[uiTreeEvents.length - 1].root, components: uiTreeEvents[uiTreeEvents.length - 1].components }
    : null

  // Handle intents — special-case answer_choice to wire into existing question flow
  const intentHandler = (intent: string, payload?: unknown) => {
    if (intent === 'answer_choice' && payload && typeof payload === 'object') {
      const p = payload as { question_id?: string; choice?: string }
      if (p.question_id && p.choice) {
        onAnswer(p.choice, p.question_id)
        return
      }
    }
    onIntent?.(intent, payload)
  }

  // Stream incremental text from `text` events into a paragraph above the tree.
  events.forEach(event => {
    if (event.type === 'text') {
      textBlocks.push(event.content)
    }
  })
  flushText('final')

  // Render the A2UI tree last (it's the main visual payload)
  if (latestTree) {
    rendered.push(
      <div key="ui-tree" className={styles.uiTreeWrapper}>
        <AgentErrorBoundary>
          <TreeWithQuestionCardAdapter
            tree={latestTree}
            intentHandler={intentHandler}
            onAnswer={onAnswer}
          />
        </AgentErrorBoundary>
      </div>
    )
  }

  return <div className={styles.wrapper}>{rendered}</div>
}

const AgentMessage = React.memo(AgentMessageImpl)
export default AgentMessage

function TreeWithQuestionCardAdapter({
  tree,
  intentHandler,
  onAnswer,
}: {
  tree: A2uiTree
  intentHandler: (intent: string, payload?: unknown) => void
  onAnswer: (answer: string, questionCardId: string) => void
}) {
  const patched: A2uiTree = {
    root: tree.root,
    components: (Array.isArray(tree.components) ? tree.components : []).map(c => {
      if (c.type === 'question_card') {
        return { ...c, props: { ...c.props, onAnswer } }
      }
      return c
    }),
  }
  return <Renderer tree={patched} onIntent={intentHandler} />
}
