import { KeyboardEvent, useState } from 'react'
import styles from './PrefsForm.module.css'

interface ChipInputProps {
  values: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  suggestions?: string[]
}

export default function ChipInput({ values, onChange, placeholder, suggestions }: ChipInputProps) {
  const [draft, setDraft] = useState('')

  function add(raw: string) {
    const v = raw.trim()
    if (!v) return
    if (values.some(x => x.toLowerCase() === v.toLowerCase())) {
      setDraft('')
      return
    }
    onChange([...values, v])
    setDraft('')
  }

  function remove(v: string) {
    onChange(values.filter(x => x !== v))
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      add(draft)
    } else if (e.key === 'Backspace' && !draft && values.length) {
      onChange(values.slice(0, -1))
    }
  }

  const remainingSuggestions = (suggestions ?? []).filter(
    s => !values.some(v => v.toLowerCase() === s.toLowerCase()),
  )

  return (
    <div className={styles.chipInputWrap}>
      <div className={styles.chipRow}>
        {values.map(v => (
          <span key={v} className={styles.chip}>
            {v}
            <button
              type="button"
              className={styles.chipRemove}
              onClick={() => remove(v)}
              aria-label={`Remove ${v}`}
            >×</button>
          </span>
        ))}
      </div>
      <div className={styles.chipInputRow}>
        <input
          className={styles.chipInput}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={onKey}
          placeholder={placeholder}
        />
        <button
          type="button"
          className={styles.chipAddBtn}
          onClick={() => add(draft)}
          disabled={!draft.trim()}
        >Add</button>
      </div>
      {remainingSuggestions.length > 0 && (
        <div className={styles.chipSuggestRow}>
          {remainingSuggestions.map(s => (
            <button
              key={s}
              type="button"
              className={styles.chipSuggest}
              onClick={() => add(s)}
            >+ {s}</button>
          ))}
        </div>
      )}
    </div>
  )
}
