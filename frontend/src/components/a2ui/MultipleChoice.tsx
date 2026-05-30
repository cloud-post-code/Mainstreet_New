import { useState } from 'react'
import styles from './A2ui.module.css'
import { IntentHandler } from '../../a2ui/types'

interface Props {
  question_id: string
  question: string
  choices: string[]
  hint?: string
  onIntent?: IntentHandler
}

export default function MultipleChoice({ question_id, question, choices, onIntent }: Props) {
  const [selected, setSelected] = useState<string | null>(null)

  function pick(choice: string) {
    if (selected) return
    setSelected(choice)
    onIntent?.('answer_choice', { question_id, choice })
  }

  return (
    <div className={styles.choiceCard}>
      <p className={styles.choiceQ}>{question}</p>
      <div className={styles.choiceList}>
        {choices.map(c => (
          <button
            key={c}
            className={`${styles.choiceBtn} ${selected === c ? styles.choiceBtnSelected : ''}`}
            onClick={() => pick(c)}
            disabled={Boolean(selected)}
          >
            {c}
          </button>
        ))}
      </div>
    </div>
  )
}
