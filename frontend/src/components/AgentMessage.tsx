import React from 'react'
import { StreamEvent } from '../hooks/useAgentStream'
import PlanDropdown from './PlanDropdown'
import Renderer from '../a2ui/Renderer'
import { A2uiTree } from '../a2ui/types'
import styles from './AgentMessage.module.css'

interface Props {
  events: StreamEvent[]
  onAnswer: (answer: string, questionCardId: string) => void
  onIntent?: (intent: string, payload?: unknown) => void
  answeredQuestions: Set<string>
}

export default function AgentMessage({ events, onAnswer, onIntent, answeredQuestions }: Props) {
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

  let toolPillShown = false

  events.forEach((event, i) => {
    if (event.type === 'text') {
      textBlocks.push(event.content)
    } else if (event.type === 'thinking') {
      // Show only the first thinking pill while streaming; the ui_tree supersedes it
      if (!toolPillShown && !latestTree) {
        flushText(`text-${i}`)
        rendered.push(
          <p key={`thinking-${i}`} className={styles.thinking}>
            <span className={styles.thinkingDot} />
            Thinking…
          </p>
        )
        toolPillShown = true
      }
    } else if (event.type === 'tool_call') {
      // Don't repeat for render_ui — it's the closing call
      if (event.tool === 'render_ui') return
      flushText(`text-${i}`)
      rendered.push(
        <div key={`tool-${i}`} className={styles.toolCall}>
          <span className={styles.toolIcon}>⚙️</span>
          <span className={styles.toolName}>{event.tool}</span>
          {event.args?.query != null && <span className={styles.toolArg}>"{String(event.args.query)}"</span>}
        </div>
      )
    }
  })
  flushText('final')

  // Render the A2UI tree last (it's the main visual payload)
  if (latestTree) {
    // If the tree contains question_cards, override their onAnswer via a wrapping handler
    // (QuestionCard takes onAnswer not onIntent — the registry passes onIntent, so we route via intentHandler)
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
