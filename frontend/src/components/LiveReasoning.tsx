import { StreamEvent } from '../hooks/useAgentStream'
import styles from './LiveReasoning.module.css'

interface Props {
  events: StreamEvent[]
  streaming: boolean
}

interface Step {
  kind: 'thinking' | 'tool'
  label: string
  detail?: string
}

function buildSteps(events: StreamEvent[]): Step[] {
  const steps: Step[] = []
  for (const e of events) {
    if (e.type === 'thinking') {
      steps.push({ kind: 'thinking', label: e.content })
    } else if (e.type === 'tool_call') {
      if (e.tool === 'render_ui') continue
      let detail: string | undefined
      if (e.args?.query != null) detail = String(e.args.query)
      else if (e.args && typeof e.args === 'object') {
        const summary = Object.entries(e.args as Record<string, unknown>)
          .filter(([, v]) => v != null && v !== '')
          .slice(0, 3)
          .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
          .join(', ')
        if (summary) detail = summary
      }
      steps.push({ kind: 'tool', label: e.tool, detail })
    }
  }
  return steps
}

export default function LiveReasoning({ events, streaming }: Props) {
  const steps = buildSteps(events)
  if (!steps.length && !streaming) return null

  const summary = streaming
    ? (steps.length ? steps[steps.length - 1].label : 'Thinking…')
    : `Thinking trace · ${steps.length} step${steps.length === 1 ? '' : 's'}`

  return (
    <details className={styles.reasoning}>
      <summary>
        {streaming && <span className={styles.dot} />}
        <span className={styles.summaryLabel}>{summary}</span>
      </summary>
      <ol className={styles.steps}>
        {steps.map((s, i) => (
          <li key={i} className={s.kind === 'tool' ? styles.toolStep : styles.thinkingStep}>
            {s.kind === 'tool' ? (
              <>
                <span className={styles.toolIcon}>⚙️</span>
                <span className={styles.toolName}>{s.label}</span>
                {s.detail && <span className={styles.toolDetail}>{s.detail}</span>}
              </>
            ) : (
              <span>{s.label}</span>
            )}
          </li>
        ))}
        {streaming && (
          <li className={styles.streamingPulse}>
            <span className={styles.dot} /> working…
          </li>
        )}
      </ol>
    </details>
  )
}
