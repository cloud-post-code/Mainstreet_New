import { useState } from 'react'
import styles from './PlanDropdown.module.css'

interface PlanStep {
  step: number
  description: string
  done: boolean
}

interface Props {
  steps: PlanStep[]
}

export default function PlanDropdown({ steps }: Props) {
  const [open, setOpen] = useState(false)
  if (!steps.length) return null

  const done = steps.filter(s => s.done).length
  const total = steps.length

  return (
    <div className={styles.wrapper}>
      <button className={styles.toggle} onClick={() => setOpen(o => !o)}>
        <span className={styles.icon}>{open ? '▾' : '▸'}</span>
        <span className={styles.label}>Plan</span>
        <span className={styles.progress}>{done}/{total}</span>
      </button>
      {open && (
        <ol className={styles.steps}>
          {steps.map(s => (
            <li key={s.step} className={`${styles.step} ${s.done ? styles.done : ''}`}>
              <span className={styles.check}>{s.done ? '✓' : s.step}</span>
              <span>{s.description}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
