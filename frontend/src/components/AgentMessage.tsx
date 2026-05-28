import React from 'react'
import { StreamEvent } from '../hooks/useAgentStream'
import ProductCard from './ProductCard'
import ShopCard from './ShopCard'
import QuestionCard from './QuestionCard'
import PlanDropdown from './PlanDropdown'
import styles from './AgentMessage.module.css'

interface Props {
  events: StreamEvent[]
  onAnswer: (answer: string, questionCardId: string) => void
  answeredQuestions: Set<string>
}

export default function AgentMessage({ events, onAnswer, answeredQuestions }: Props) {
  const textBlocks: string[] = []
  const renderedElements: React.ReactNode[] = []

  // Accumulate text, then flush before artifacts
  function flushText(key: string) {
    if (textBlocks.length) {
      renderedElements.push(
        <p key={key} className={styles.text}>{textBlocks.splice(0).join('')}</p>
      )
    }
  }

  // Get the latest plan from events
  const planEvents = events.filter(e => e.type === 'plan_update')
  const latestPlan = planEvents.length ? (planEvents[planEvents.length - 1] as { type: 'plan_update'; steps: Array<{ step: number; description: string; done: boolean }> }).steps : []

  if (latestPlan.length) {
    renderedElements.push(<PlanDropdown key="plan" steps={latestPlan} />)
  }

  events.forEach((event, i) => {
    if (event.type === 'text') {
      textBlocks.push(event.content)
    } else if (event.type === 'thinking') {
      flushText(`text-${i}`)
      renderedElements.push(
        <p key={i} className={styles.thinking}>
          <span className={styles.thinkingDot} />
          {event.content}
        </p>
      )
    } else if (event.type === 'artifact') {
      flushText(`text-${i}`)
      const { kind, data } = event
      if (kind === 'build_product_card') {
        renderedElements.push(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          <ProductCard key={i} {...(data as any)} />
        )
      } else if (kind === 'build_shop_card') {
        renderedElements.push(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          <ShopCard key={i} {...(data as any)} />
        )
      } else if (kind === 'build_question_card') {
        const d = data as { question_id: string; question: string; options?: string[]; hint?: string }
        renderedElements.push(
          <QuestionCard
            key={i}
            question_id={d.question_id}
            question={d.question}
            options={d.options}
            hint={d.hint}
            onAnswer={onAnswer}
            answered={answeredQuestions.has(d.question_id)}
          />
        )
      }
    } else if (event.type === 'tool_call') {
      flushText(`text-${i}`)
      renderedElements.push(
        <div key={i} className={styles.toolCall}>
          <span className={styles.toolIcon}>⚙️</span>
          <span className={styles.toolName}>{event.tool}</span>
          {event.args.query != null && <span className={styles.toolArg}>"{String(event.args.query)}"</span>}
        </div>
      )
    }
  })
  flushText('final')

  return <div className={styles.wrapper}>{renderedElements}</div>
}
