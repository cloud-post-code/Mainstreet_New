import styles from './A2ui.module.css'

interface Props {
  summary: string
}

export default function ReasoningBlock({ summary }: Props) {
  return (
    <details className={styles.reasoning}>
      <summary>View reasoning</summary>
      <div className={styles.reasoningBody}>{summary}</div>
    </details>
  )
}
