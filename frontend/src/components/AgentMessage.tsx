import React from 'react'
import { StreamEvent } from '../hooks/useAgentStream'
import PlanDropdown from './PlanDropdown'
import LiveReasoning from './LiveReasoning'
import Renderer from '../a2ui/Renderer'
import { A2uiTree } from '../a2ui/types'
import styles from './AgentMessage.module.css'

interface Props {
  events: StreamEvent[]
  streaming?: boolean
  onAnswer: (answer: string, questionCardId: string) => void
  onIntent?: (intent: string, payload?: unknown) => void
  answeredQuestions: Set<string>
}

function AgentMessageImpl({ events, streaming, onAnswer, onIntent, answeredQuestions }: Props) {
  const rendered: React.ReactNode[] = []
  const textBlocks: string[] = []

  function flushText(key: string) {
    if (textBlocks.length) {
      rendered.push(
        <p key={key} className={styles.text}>{textBlocks.splice(0).join('')}</p>
      )
    }
  }

  // Plan: render the latest one as a dropdown at the top
  const planEvents = events.filter(e => e.type === 'plan_update')
  const latestPlan = planEvents.length
    ? (planEvents[planEvents.length - 1] as Extract<StreamEvent, { type: 'plan_update' }>).steps
    : []
  if (latestPlan.length) {
    rendered.push(<PlanDropdown key="plan" steps={latestPlan} />)
  }

  // Latest ui_tree replaces any earlier one (full-replacement model for MVP)
  const uiTreeEvents = events.filter((e): e is Extract<StreamEvent, { type: 'ui_tree' }> => e.type === 'ui_tree')
  const latestTree: A2uiTree | null = uiTreeEvents.length
    ? { root: uiTreeEvents[uiTreeEvents.length - 1].root, components: uiTreeEvents[uiTreeEvents.length - 1].components }
    : null

  // Live reasoning surface — collapsed by default, summarizes thinking + tool_call
  // events. Shows while streaming and also stays around after for inspection.
  const hasReasoningEvents = events.some(e => e.type === 'thinking' || (e.type === 'tool_call' && e.tool !== 'render_ui'))
  if (hasReasoningEvents || streaming) {
    rendered.push(
      <LiveReasoning key="live-reasoning" events={events} streaming={Boolean(streaming)} />
    )
  }

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
        <TreeWithQuestionCardAdapter
          tree={latestTree}
          intentHandler={intentHandler}
          onAnswer={onAnswer}
          answeredQuestions={answeredQuestions}
        />
      </div>
    )
  }

  return <div className={styles.wrapper}>{rendered}</div>
}

// Memoize so unrelated parent re-renders (e.g., textarea keystrokes) don't
// rebuild every historical agent message. `events` is a stable reference held
// inside the Message object, and `answeredQuestions` only changes when a
// question is actually answered.
const AgentMessage = React.memo(AgentMessageImpl)
export default AgentMessage

// QuestionCard expects onAnswer, not onIntent. Patch the tree's question_card nodes
// at render time to pass the right props.
function TreeWithQuestionCardAdapter({
  tree,
  intentHandler,
  onAnswer,
  answeredQuestions,
}: {
  tree: A2uiTree
  intentHandler: (intent: string, payload?: unknown) => void
  onAnswer: (answer: string, questionCardId: string) => void
  answeredQuestions: Set<string>
}) {
  // Build a shadow component map where question_card props get onAnswer + answered injected
  const patched: A2uiTree = {
    root: tree.root,
    components: tree.components.map(c => {
      if (c.type !== 'question_card') return c
      const qid = (c.props as { question_id?: string }).question_id
      return {
        ...c,
        props: {
          ...c.props,
          onAnswer,
          answered: qid ? answeredQuestions.has(qid) : false,
        },
      }
    }),
  }
  return <Renderer tree={patched} onIntent={intentHandler} />
}
