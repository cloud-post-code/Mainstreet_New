import styles from './A2ui.module.css'
import { IntentHandler } from '../../a2ui/types'

interface Action {
  label: string
  intent: string
}

interface Props {
  actions: Action[]
  onIntent?: IntentHandler
}

export default function NextActions({ actions, onIntent }: Props) {
  return (
    <div className={styles.actions}>
      {actions.map((a, i) => (
        <button
          key={`${a.intent}-${i}`}
          className={styles.actionChip}
          onClick={() => onIntent?.(a.intent, { label: a.label })}
        >
          {a.label}
        </button>
      ))}
    </div>
  )
}
