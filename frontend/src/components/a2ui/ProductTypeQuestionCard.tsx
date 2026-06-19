import { useState } from 'react'
import { IntentHandler } from '../../a2ui/types'
import styles from './VibeQuestionCard.module.css'

interface ProductType {
  type_id: string
  label: string
  image_url: string
}

interface Props {
  question_id: string
  question: string
  types: ProductType[]
  hint?: string
  onIntent?: IntentHandler
}

export default function ProductTypeQuestionCard({
  question_id,
  question,
  types,
  hint,
  onIntent,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const safeTypes = Array.isArray(types) ? types.slice(0, 6) : []

  function handleSelect(type: ProductType) {
    if (selectedId !== null) return
    setSelectedId(type.type_id)
    onIntent?.('answer_choice', {
      question_id,
      choice: `I chose type: ${type.label}`,
    })
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <img src="/mason/mason-1.png" alt="Mason" className={styles.avatar} />
        <div className={styles.headerText}>
          <div className={styles.question}>{question}</div>
          {hint && <div className={styles.hint}>{hint}</div>}
        </div>
      </div>

      <div className={styles.grid}>
        {safeTypes.map(type => {
          const selected = selectedId === type.type_id
          const dimmed = selectedId !== null && !selected
          return (
            <button
              key={type.type_id}
              className={[
                styles.tile,
                selected ? styles.tileSelected : '',
                dimmed ? styles.tileDimmed : '',
              ].filter(Boolean).join(' ')}
              onClick={() => handleSelect(type)}
              disabled={dimmed || selected}
              aria-pressed={selected}
            >
              <div className={styles.imageWrap}>
                {type.image_url ? (
                  <img src={type.image_url} alt={type.label} className={styles.image} />
                ) : (
                  <div className={styles.imagePlaceholder}>🛍️</div>
                )}
                {selected && (
                  <div className={styles.selectedOverlay}>✓</div>
                )}
              </div>
              <div className={styles.label}>{type.label}</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
