import styles from './A2ui.module.css'
import { IntentHandler } from '../../a2ui/types'

interface Action {
  label: string
  intent: string
  url?: string
  style?: 'primary' | 'default'
}

interface Props {
  actions: Action[]
  onIntent?: IntentHandler
}

export default function NextActions({ actions, onIntent }: Props) {
  const items = Array.isArray(actions) ? actions : []
  return (
    <div className={styles.actions}>
      {items.map((a, i) => {
        const primaryClass = (styles as Record<string, string>).actionChipPrimary
        const className = `${styles.actionChip} ${a.style === 'primary' && primaryClass ? primaryClass : ''}`.trim()
        if (a.url) {
          return (
            <a
              key={`${a.intent}-${i}`}
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className={className}
            >
              {a.label}
            </a>
          )
        }
        return (
          <button
            key={`${a.intent}-${i}`}
            className={className}
            onClick={() => onIntent?.(a.intent, { label: a.label, url: a.url })}
          >
            {a.label}
          </button>
        )
      })}
    </div>
  )
}
