import { ChangeEvent, ReactNode } from 'react'
import { MasonGiftBudget, MasonLifestyle, MasonPrefs, MasonPrefsPatch, MasonSizes } from '../api'
import ChipInput from './ChipInput'
import styles from './PrefsForm.module.css'

interface PrefsFormProps {
  prefs: MasonPrefs
  onPatch: (patch: MasonPrefsPatch) => void
}

const SHIRT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL']
const HAT_SIZES = ['S', 'M', 'L', 'XL']
const STYLE_TAGS = [
  'minimalist', 'classic', 'streetwear', 'preppy', 'athleisure',
  'bohemian', 'vintage', 'technical', 'rugged', 'modern',
]
const PET_OPTIONS = ['Dog', 'Cat', 'Bird', 'Reptile', 'Fish', 'Other']
const FITNESS_OPTIONS = [
  'Running', 'Lifting', 'Yoga', 'Cycling',
  'Hiking', 'Climbing', 'Swimming', 'Team sports',
]

function numOrUndef(s: string): number | null {
  if (!s.trim()) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export default function PrefsForm({ prefs, onPatch }: PrefsFormProps) {
  const sizes = prefs.sizes ?? {}
  const lifestyle = prefs.lifestyle ?? {}
  const gb = prefs.gift_budget ?? {}

  function patchSize(field: keyof MasonSizes, value: string) {
    onPatch({ sizes: { [field]: value || null } as Partial<MasonSizes> })
  }
  function patchLifestyle(patch: Partial<MasonLifestyle>) {
    onPatch({ lifestyle: patch as Partial<MasonLifestyle> })
  }
  function patchGift(patch: Partial<MasonGiftBudget>) {
    onPatch({ gift_budget: patch as Partial<MasonGiftBudget> })
  }
  function toggleInArray(list: string[] | undefined, value: string): string[] {
    const arr = list ?? []
    return arr.includes(value) ? arr.filter(x => x !== value) : [...arr, value]
  }

  return (
    <div className={styles.form}>
      <p className={styles.helpText}>
        Defaults Mason uses when shopping for you. Saved automatically as you change anything.
      </p>

      <Section title="Sizes" defaultOpen>
        <Row>
          <Field label="Shirt">
            <select
              value={sizes.shirt ?? ''}
              onChange={e => patchSize('shirt', e.target.value)}
            >
              <option value="">—</option>
              {SHIRT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Dress / general">
            <select
              value={sizes.dress ?? ''}
              onChange={e => patchSize('dress', e.target.value)}
            >
              <option value="">—</option>
              {SHIRT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </Row>
        <Row>
          <Field label="Pant waist">
            <input
              type="number"
              inputMode="numeric"
              value={sizes.waist ?? ''}
              onChange={e => patchSize('waist', e.target.value)}
              placeholder="32"
            />
          </Field>
          <Field label="Inseam">
            <input
              type="number"
              inputMode="numeric"
              value={sizes.inseam ?? ''}
              onChange={e => patchSize('inseam', e.target.value)}
              placeholder="32"
            />
          </Field>
        </Row>
        <Row>
          <Field label="Shoe">
            <input
              type="number"
              step="0.5"
              value={sizes.shoe ?? ''}
              onChange={e => patchSize('shoe', e.target.value)}
              placeholder="10.5"
            />
          </Field>
          <Field label="Shoe fit">
            <select
              value={sizes.shoe_gender ?? ''}
              onChange={e => patchSize('shoe_gender', e.target.value)}
            >
              <option value="">—</option>
              <option value="mens">Men's</option>
              <option value="womens">Women's</option>
              <option value="unisex">Unisex</option>
            </select>
          </Field>
        </Row>
        <Row>
          <Field label="Hat">
            <select
              value={sizes.hat ?? ''}
              onChange={e => patchSize('hat', e.target.value)}
            >
              <option value="">—</option>
              {HAT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Ring">
            <input
              type="number"
              step="0.5"
              value={sizes.ring ?? ''}
              onChange={e => patchSize('ring', e.target.value)}
              placeholder="8"
            />
          </Field>
        </Row>
      </Section>

      <Section title="Style preferences">
        <div className={styles.toggleRow}>
          {STYLE_TAGS.map(tag => {
            const on = (prefs.style_tags ?? []).includes(tag)
            return (
              <button
                key={tag}
                type="button"
                className={`${styles.toggleChip} ${on ? styles.toggleChipOn : ''}`}
                onClick={() => onPatch({ style_tags: toggleInArray(prefs.style_tags, tag) })}
              >{tag}</button>
            )
          })}
        </div>
      </Section>

      <Section title="Quality vs price">
        <SliderRow
          value={prefs.quality_price}
          onChange={v => onPatch({ quality_price: v })}
          minLabel="budget"
          maxLabel="premium"
        />
      </Section>

      <Section title="Bulk vs individual">
        <SliderRow
          value={prefs.bulk_individual}
          onChange={v => onPatch({ bulk_individual: v })}
          minLabel="individual"
          maxLabel="bulk / restock"
        />
      </Section>

      <Section title="Discover vs known">
        <SliderRow
          value={prefs.discover_known}
          onChange={v => onPatch({ discover_known: v })}
          minLabel="stick to known"
          maxLabel="surprise me"
        />
      </Section>

      <Section title="Personal budget">
        <Field label="Max for a single item ($)">
          <input
            type="number"
            inputMode="numeric"
            value={prefs.personal_budget ?? ''}
            onChange={e => onPatch({ personal_budget: numOrUndef(e.target.value) })}
            placeholder="150"
          />
        </Field>
      </Section>

      <Section title="Typical gift budget">
        <Row>
          <Field label="Default ($)">
            <input
              type="number"
              value={gb.default ?? ''}
              onChange={e => patchGift({ default: numOrUndef(e.target.value) ?? undefined })}
              placeholder="50"
            />
          </Field>
          <Field label="Birthday ($)">
            <input
              type="number"
              value={gb.birthday ?? ''}
              onChange={e => patchGift({ birthday: numOrUndef(e.target.value) ?? undefined })}
            />
          </Field>
        </Row>
        <Row>
          <Field label="Holiday ($)">
            <input
              type="number"
              value={gb.holiday ?? ''}
              onChange={e => patchGift({ holiday: numOrUndef(e.target.value) ?? undefined })}
            />
          </Field>
          <Field label="Anniversary ($)">
            <input
              type="number"
              value={gb.anniversary ?? ''}
              onChange={e => patchGift({ anniversary: numOrUndef(e.target.value) ?? undefined })}
            />
          </Field>
        </Row>
      </Section>

      <Section title="Lifestyle">
        <Field label="Housing">
          <RadioGroup
            name="housing"
            value={lifestyle.housing ?? ''}
            onChange={v => patchLifestyle({ housing: (v || undefined) as MasonLifestyle['housing'] })}
            options={[
              { value: 'homeowner', label: 'Homeowner' },
              { value: 'renter', label: 'Renter' },
            ]}
          />
        </Field>
        <Field label="Area">
          <RadioGroup
            name="area"
            value={lifestyle.area ?? ''}
            onChange={v => patchLifestyle({ area: (v || undefined) as MasonLifestyle['area'] })}
            options={[
              { value: 'urban', label: 'Urban' },
              { value: 'suburban', label: 'Suburban' },
              { value: 'rural', label: 'Rural' },
            ]}
          />
        </Field>
        <Field label="Pets">
          <div className={styles.toggleRow}>
            {PET_OPTIONS.map(p => {
              const on = (lifestyle.pets ?? []).includes(p)
              return (
                <button
                  key={p}
                  type="button"
                  className={`${styles.toggleChip} ${on ? styles.toggleChipOn : ''}`}
                  onClick={() => patchLifestyle({ pets: toggleInArray(lifestyle.pets, p) })}
                >{p}</button>
              )
            })}
          </div>
          <input
            className={styles.inlineInput}
            value={lifestyle.pets_notes ?? ''}
            onChange={e => patchLifestyle({ pets_notes: e.target.value })}
            placeholder="Pet details (breed, age, etc.)"
          />
        </Field>
        <Field label="Hobbies">
          <ChipInput
            values={lifestyle.hobbies ?? []}
            onChange={next => patchLifestyle({ hobbies: next })}
            placeholder="Add a hobby and press Enter"
          />
        </Field>
        <Field label="Cooking habits">
          <RadioGroup
            name="cooking"
            value={lifestyle.cooking ?? ''}
            onChange={v => patchLifestyle({ cooking: (v || undefined) as MasonLifestyle['cooking'] })}
            options={[
              { value: 'rarely', label: 'Rarely' },
              { value: 'sometimes', label: 'Sometimes' },
              { value: 'often', label: 'Often' },
              { value: 'daily', label: 'Daily' },
            ]}
          />
        </Field>
        <Field label="Travel frequency">
          <RadioGroup
            name="travel"
            value={lifestyle.travel ?? ''}
            onChange={v => patchLifestyle({ travel: (v || undefined) as MasonLifestyle['travel'] })}
            options={[
              { value: 'rarely', label: 'Rarely' },
              { value: 'few_times_year', label: 'A few times / year' },
              { value: 'monthly', label: 'Monthly' },
              { value: 'frequently', label: 'Frequently' },
            ]}
          />
        </Field>
        <Field label="Fitness activities">
          <div className={styles.toggleRow}>
            {FITNESS_OPTIONS.map(f => {
              const on = (lifestyle.fitness ?? []).includes(f)
              return (
                <button
                  key={f}
                  type="button"
                  className={`${styles.toggleChip} ${on ? styles.toggleChipOn : ''}`}
                  onClick={() => patchLifestyle({ fitness: toggleInArray(lifestyle.fitness, f) })}
                >{f}</button>
              )
            })}
          </div>
        </Field>
        <Field label="Work environment">
          <RadioGroup
            name="work_env"
            value={lifestyle.work_env ?? ''}
            onChange={v => patchLifestyle({ work_env: (v || undefined) as MasonLifestyle['work_env'] })}
            options={[
              { value: 'wfh', label: 'WFH' },
              { value: 'hybrid', label: 'Hybrid' },
              { value: 'office', label: 'Office' },
              { value: 'outdoor', label: 'Outdoor' },
              { value: 'industrial', label: 'Industrial' },
            ]}
          />
        </Field>
      </Section>

      <Section title="Likes" defaultOpen>
        <ChipInput
          values={prefs.likes}
          onChange={next => onPatch({ likes: next })}
          placeholder="Add a brand, style, or material…"
        />
      </Section>

      <Section title="Dislikes" defaultOpen>
        <ChipInput
          values={prefs.dislikes}
          onChange={next => onPatch({ dislikes: next })}
          placeholder="Add something to avoid…"
        />
      </Section>
    </div>
  )
}

function Section({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details className={styles.section} open={defaultOpen}>
      <summary className={styles.sectionSummary}>{title}</summary>
      <div className={styles.sectionBody}>{children}</div>
    </details>
  )
}

function Row({ children }: { children: ReactNode }) {
  return <div className={styles.row}>{children}</div>
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
    </label>
  )
}

function RadioGroup({
  name, value, onChange, options,
}: {
  name: string
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
}) {
  function handle(e: ChangeEvent<HTMLInputElement>) {
    onChange(e.target.value === value ? '' : e.target.value)
  }
  return (
    <div className={styles.radioRow}>
      {options.map(o => (
        <label key={o.value} className={`${styles.radioChip} ${value === o.value ? styles.radioChipOn : ''}`}>
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={handle}
            onClick={() => { if (value === o.value) onChange('') }}
          />
          {o.label}
        </label>
      ))}
    </div>
  )
}

function SliderRow({
  value, onChange, minLabel, maxLabel,
}: {
  value: number | null
  onChange: (v: number | null) => void
  minLabel: string
  maxLabel: string
}) {
  const v = value ?? 3
  const set = value == null
  return (
    <div className={styles.sliderWrap}>
      <div className={styles.sliderLabels}>
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
      <input
        type="range"
        min={1}
        max={5}
        step={1}
        value={v}
        onChange={e => onChange(Number(e.target.value))}
        className={set ? styles.sliderUnset : ''}
      />
      <div className={styles.sliderMeta}>
        {set ? 'Not set' : `${v} / 5`}
        {!set && (
          <button
            type="button"
            className={styles.sliderClear}
            onClick={() => onChange(null)}
          >clear</button>
        )}
      </div>
    </div>
  )
}
