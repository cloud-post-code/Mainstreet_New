import { useState } from 'react'
import styles from './Cards.module.css'

interface Props {
  question_id: string
  question: string
  options?: string[]
  hint?: string
  onAnswer: (answer: string, questionCardId: string) => void
  answered?: boolean
}

export default function QuestionCard({ question_id, question, options, hint, onAnswer, answered }: Props) {
  const [text, setText] = useState('')
  const [selected, setSelected] = useState<string | null>(null)

  function submit(answer: string) {
    if (answered) return
    setSelected(answer)
    onAnswer(answer, question_id)
  }

  return (
    <div className={`${styles.questionCard} ${answered ? styles.answered : ''}`}>
      <div className={styles.questionIcon}>❓</div>
      <p className={styles.question}>{question}</p>
      {options && options.length > 0 ? (
        <div className={styles.options}>
          {options.map(opt => (
            <button
              key={opt}
              className={`${styles.optionBtn} ${selected === opt ? styles.selectedOption : ''}`}
              onClick={() => submit(opt)}
              disabled={answered}
            >
              {opt}
            </button>
          ))}
        </div>
      ) : (
        <div className={styles.freeText}>
          <input
            className={styles.freeInput}
            type="text"
            placeholder={hint ?? 'Type your answer…'}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && text.trim()) submit(text.trim()) }}
            disabled={answered}
          />
          <button
            className={styles.sendBtn}
            onClick={() => text.trim() && submit(text.trim())}
            disabled={answered || !text.trim()}
          >
            Send
          </button>
        </div>
      )}
    </div>
  )
}
