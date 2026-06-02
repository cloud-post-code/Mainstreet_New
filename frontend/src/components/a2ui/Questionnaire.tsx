import { useEffect, useState } from 'react'
import styles from './A2ui.module.css'
import { IntentHandler } from '../../a2ui/types'

type StepKind = 'single' | 'multi' | 'text'

interface Step {
  step_id: string
  question: string
  kind: StepKind
  options?: string[]
  hint?: string
  allow_other?: boolean
}

interface Props {
  questionnaire_id: string
  current_step: number
  steps: Step[]
  title?: string
  onIntent?: IntentHandler
  // Injected by AgentMessage.TreeWithQuestionCardAdapter when the active step
  // has already been submitted, so controls stay disabled while the agent's
  // next turn is in flight.
  answered?: boolean
}

export default function Questionnaire({
  current_step,
  steps,
  title,
  onIntent,
  answered,
}: Props) {
  const safeSteps = Array.isArray(steps) ? steps : []
  const stepIndex = Math.max(0, Math.min(current_step ?? 0, safeSteps.length))
  const active = safeSteps[stepIndex]

  const [selectedMulti, setSelectedMulti] = useState<string[]>([])
  const [otherText, setOtherText] = useState('')
  const [textValue, setTextValue] = useState('')
  const [singleChoice, setSingleChoice] = useState<string | null>(null)

  // Reset transient input state whenever we advance to a new step.
  useEffect(() => {
    setSelectedMulti([])
    setOtherText('')
    setTextValue('')
    setSingleChoice(null)
  }, [stepIndex, active?.step_id])

  function submit(answer: string) {
    if (!active || answered) return
    const trimmed = answer.trim()
    if (!trimmed) return
    onIntent?.('answer_choice', { question_id: active.step_id, choice: trimmed })
  }

  function pickSingle(choice: string) {
    if (singleChoice) return
    setSingleChoice(choice)
    submit(choice)
  }

  function toggleMulti(opt: string) {
    setSelectedMulti(prev =>
      prev.includes(opt) ? prev.filter(o => o !== opt) : [...prev, opt]
    )
  }

  function submitMulti() {
    const parts = [...selectedMulti]
    const other = otherText.trim()
    if (other) parts.push(`Other: ${other}`)
    submit(parts.join(', '))
  }

  const disabled = Boolean(answered)

  return (
    <div className={styles.questionnaireCard}>
      <div className={styles.questionnaireHeader}>
        <span className={styles.questionnaireStep}>
          Step {Math.min(stepIndex + 1, safeSteps.length)} of {safeSteps.length}
        </span>
        {title ? <span className={styles.questionnaireTitle}>{title}</span> : null}
      </div>

      <ol className={styles.questionnaireList}>
        {safeSteps.map((s, i) => {
          if (i < stepIndex) {
            return (
              <li key={s.step_id} className={styles.questionnaireStepDone}>
                <span className={styles.questionnaireCheck}>✓</span>
                <span className={styles.questionnaireDoneQ}>{s.question}</span>
              </li>
            )
          }
          if (i > stepIndex) {
            return (
              <li key={s.step_id} className={styles.questionnaireStepFuture}>
                <span className={styles.questionnaireFutureNum}>{i + 1}.</span>
                <span className={styles.questionnaireFutureQ}>{s.question}</span>
              </li>
            )
          }
          // Active step
          return (
            <li key={s.step_id} className={styles.questionnaireStepActive}>
              <p className={styles.questionnaireQ}>{s.question}</p>

              {s.kind === 'single' && (
                <div className={styles.choiceList}>
                  {(s.options ?? []).map(opt => (
                    <button
                      key={opt}
                      className={`${styles.choiceBtn} ${singleChoice === opt ? styles.choiceBtnSelected : ''}`}
                      onClick={() => pickSingle(opt)}
                      disabled={disabled || Boolean(singleChoice)}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}

              {s.kind === 'multi' && (
                <div className={styles.questionnaireMulti}>
                  {(s.options ?? []).map(opt => {
                    const checked = selectedMulti.includes(opt)
                    return (
                      <label
                        key={opt}
                        className={`${styles.questionnaireCheckRow} ${checked ? styles.questionnaireCheckRowOn : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleMulti(opt)}
                          disabled={disabled}
                        />
                        <span>{opt}</span>
                      </label>
                    )
                  })}
                  {s.allow_other && (
                    <input
                      className={styles.questionnaireOther}
                      type="text"
                      placeholder="Other (optional)…"
                      value={otherText}
                      onChange={e => setOtherText(e.target.value)}
                      disabled={disabled}
                    />
                  )}
                  <button
                    className={styles.questionnaireContinue}
                    onClick={submitMulti}
                    disabled={
                      disabled ||
                      (selectedMulti.length === 0 && otherText.trim() === '')
                    }
                  >
                    Continue
                  </button>
                </div>
              )}

              {s.kind === 'text' && (
                <div className={styles.questionnaireText}>
                  <input
                    className={styles.questionnaireInput}
                    type="text"
                    placeholder={s.hint ?? 'Type your answer…'}
                    value={textValue}
                    onChange={e => setTextValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && textValue.trim()) submit(textValue.trim())
                    }}
                    disabled={disabled}
                  />
                  <button
                    className={styles.questionnaireContinue}
                    onClick={() => textValue.trim() && submit(textValue.trim())}
                    disabled={disabled || !textValue.trim()}
                  >
                    Send
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
