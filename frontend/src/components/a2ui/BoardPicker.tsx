import { useState } from 'react'
import styles from './A2ui.module.css'
import { IntentHandler } from '../../a2ui/types'

interface BoardOption {
  id: number
  name: string
  description?: string | null
}

interface Props {
  question_id: string
  product_id: number
  product_name: string
  boards: BoardOption[]
  onIntent?: IntentHandler
}

export default function BoardPicker({ question_id, product_id, product_name, boards, onIntent }: Props) {
  const [selected, setSelected] = useState<number | null>(null)

  function pick(boardId: number, boardName: string) {
    if (selected !== null) return
    setSelected(boardId)
    onIntent?.('answer_choice', {
      question_id,
      choice: `Save to "${boardName}" (board_id=${boardId}, product_id=${product_id})`,
    })
  }

  const items = Array.isArray(boards) ? boards : []

  return (
    <div className={styles.choiceCard}>
      <p className={styles.choiceQ}>Where should I save <strong>{product_name}</strong>?</p>
      <div className={styles.choiceList}>
        {items.map(b => (
          <button
            key={b.id}
            className={`${styles.choiceBtn} ${selected === b.id ? styles.choiceBtnSelected : ''}`}
            onClick={() => pick(b.id, b.name)}
            disabled={selected !== null}
          >
            <span>{b.name}</span>
            {b.description && <span style={{ fontSize: '0.78em', opacity: 0.7, display: 'block' }}>{b.description}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
