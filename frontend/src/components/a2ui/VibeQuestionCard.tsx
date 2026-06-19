import { useState } from 'react'
import { IntentHandler } from '../../a2ui/types'
import styles from './VibeQuestionCard.module.css'

interface Vibe {
  vibe_id: string
  label: string
  image_url: string
}

interface Props {
  question_id: string
  question: string
  vibes: Vibe[]
  hint?: string
  onIntent?: IntentHandler
}

export default function VibeQuestionCard({
  question_id,
  question,
  vibes,
  hint,
  onIntent,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const safeVibes = Array.isArray(vibes) ? vibes.slice(0, 6) : []

  function handleSelect(vibe: Vibe) {
    if (selectedId !== null) return
    setSelectedId(vibe.vibe_id)
    onIntent?.('answer_choice', {
      question_id,
      choice: `I chose vibe: ${vibe.label}`,
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
        {safeVibes.map(vibe => {
          const selected = selectedId === vibe.vibe_id
          const dimmed = selectedId !== null && !selected
          return (
            <button
              key={vibe.vibe_id}
              className={[
                styles.tile,
                selected ? styles.tileSelected : '',
                dimmed ? styles.tileDimmed : '',
              ].filter(Boolean).join(' ')}
              onClick={() => handleSelect(vibe)}
              disabled={dimmed || selected}
              aria-pressed={selected}
            >
              <div className={styles.imageWrap}>
                {vibe.image_url ? (
                  <img src={vibe.image_url} alt={vibe.label} className={styles.image} />
                ) : (
                  <div className={styles.imagePlaceholder}>🌿</div>
                )}
                {selected && (
                  <div className={styles.selectedOverlay}>✓</div>
                )}
              </div>
              <div className={styles.label}>{vibe.label}</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
