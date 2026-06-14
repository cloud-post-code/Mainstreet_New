import { ReactNode } from 'react'
import { MasonGiftBudget, MasonLifestyle, MasonPrefs, MasonPrefsPatch } from '../api'
import ChipInput from './ChipInput'
import styles from './PrefsForm.module.css'

interface PrefsFormProps {
  prefs: MasonPrefs
  onPatch: (patch: MasonPrefsPatch) => void
}

function numOrNull(s: string): number | null {
  if (!s.trim()) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export default function PrefsForm({ prefs, onPatch }: PrefsFormProps) {
  const lifestyle = prefs.lifestyle ?? {}
  const gb = prefs.gift_budget ?? {}

  function patchLifestyle(patch: Partial<MasonLifestyle>) {
    onPatch({ lifestyle: patch as Partial<MasonLifestyle> })
  }
  function patchGift(patch: Partial<MasonGiftBudget>) {
    onPatch({ gift_budget: patch as Partial<MasonGiftBudget> })
  }

  return (
    <div className={styles.form}>
      <p className={styles.helpText}>
        Defaults Mason uses when shopping for you. Saved automatically as you change anything.
      </p>

      <Section title="Style" defaultOpen>
        <p className={styles.sectionHint}>Add words that describe your aesthetic — type one and press Enter.</p>
        <ChipInput
          values={prefs.style_tags ?? []}
          onChange={next => onPatch({ style_tags: next })}
          placeholder="e.g. minimalist, vintage, streetwear…"
        />
      </Section>

      <Section title="Likes" defaultOpen>
        <ChipInput
          values={prefs.likes ?? []}
          onChange={next => onPatch({ likes: next })}
          placeholder="Add a brand, material, or style…"
        />
      </Section>

      <Section title="Dislikes" defaultOpen>
        <ChipInput
          values={prefs.dislikes ?? []}
          onChange={next => onPatch({ dislikes: next })}
          placeholder="Add something to avoid…"
        />
      </Section>

      <Section title="Lifestyle">
        <Field label="Where you live">
          <input
            type="text"
            value={(lifestyle as Record<string, unknown>).area as string ?? ''}
            onChange={e => patchLifestyle({ area: e.target.value as MasonLifestyle['area'] || undefined })}
            placeholder="e.g. urban, suburban, rural city"
          />
        </Field>
        <Field label="Housing">
          <input
            type="text"
            value={(lifestyle as Record<string, unknown>).housing as string ?? ''}
            onChange={e => patchLifestyle({ housing: e.target.value as MasonLifestyle['housing'] || undefined })}
            placeholder="e.g. homeowner, renter, apartment"
          />
        </Field>
        <Field label="Work environment">
          <input
            type="text"
            value={(lifestyle as Record<string, unknown>).work_env as string ?? ''}
            onChange={e => patchLifestyle({ work_env: e.target.value as MasonLifestyle['work_env'] || undefined })}
            placeholder="e.g. WFH, office, hybrid, outdoor"
          />
        </Field>
        <Field label="Cooking habits">
          <input
            type="text"
            value={(lifestyle as Record<string, unknown>).cooking as string ?? ''}
            onChange={e => patchLifestyle({ cooking: e.target.value as MasonLifestyle['cooking'] || undefined })}
            placeholder="e.g. cook daily, rarely cook, meal prep on weekends"
          />
        </Field>
        <Field label="Travel">
          <input
            type="text"
            value={(lifestyle as Record<string, unknown>).travel as string ?? ''}
            onChange={e => patchLifestyle({ travel: e.target.value as MasonLifestyle['travel'] || undefined })}
            placeholder="e.g. travel monthly, a few times a year, rarely"
          />
        </Field>
        <Field label="Pets">
          <ChipInput
            values={lifestyle.pets ?? []}
            onChange={next => patchLifestyle({ pets: next })}
            placeholder="Add a pet (e.g. dog, cat)…"
          />
        </Field>
        <Field label="Pet notes">
          <input
            type="text"
            value={lifestyle.pets_notes ?? ''}
            onChange={e => patchLifestyle({ pets_notes: e.target.value })}
            placeholder="Breed, age, or other details…"
          />
        </Field>
        <Field label="Hobbies & activities">
          <ChipInput
            values={lifestyle.hobbies ?? []}
            onChange={next => patchLifestyle({ hobbies: next })}
            placeholder="Add a hobby or activity…"
          />
        </Field>
        <Field label="Fitness">
          <ChipInput
            values={lifestyle.fitness ?? []}
            onChange={next => patchLifestyle({ fitness: next })}
            placeholder="Add a fitness activity…"
          />
        </Field>
      </Section>

      <Section title="Sizes">
        <Row>
          <Field label="Shirt">
            <input
              type="text"
              value={prefs.sizes?.shirt ?? ''}
              onChange={e => onPatch({ sizes: { shirt: e.target.value } })}
              placeholder="e.g. M, L, XL"
            />
          </Field>
          <Field label="Dress">
            <input
              type="text"
              value={prefs.sizes?.dress ?? ''}
              onChange={e => onPatch({ sizes: { dress: e.target.value } })}
              placeholder="e.g. 6, 8, 10"
            />
          </Field>
        </Row>
        <Row>
          <Field label="Waist">
            <input
              type="text"
              value={prefs.sizes?.waist ?? ''}
              onChange={e => onPatch({ sizes: { waist: e.target.value } })}
              placeholder="e.g. 32"
            />
          </Field>
          <Field label="Inseam">
            <input
              type="text"
              value={prefs.sizes?.inseam ?? ''}
              onChange={e => onPatch({ sizes: { inseam: e.target.value } })}
              placeholder="e.g. 30"
            />
          </Field>
        </Row>
        <Row>
          <Field label="Shoe size">
            <input
              type="text"
              value={prefs.sizes?.shoe ?? ''}
              onChange={e => onPatch({ sizes: { shoe: e.target.value } })}
              placeholder="e.g. 10.5"
            />
          </Field>
          <Field label="Hat">
            <input
              type="text"
              value={prefs.sizes?.hat ?? ''}
              onChange={e => onPatch({ sizes: { hat: e.target.value } })}
              placeholder="e.g. L/XL"
            />
          </Field>
        </Row>
        <Field label="Ring">
          <input
            type="text"
            value={prefs.sizes?.ring ?? ''}
            onChange={e => onPatch({ sizes: { ring: e.target.value } })}
            placeholder="e.g. 7"
          />
        </Field>
        <Field label="Size notes">
          <input
            type="text"
            value={prefs.sizes?.freeform ?? ''}
            onChange={e => onPatch({ sizes: { freeform: e.target.value } })}
            placeholder="Anything else about fit or sizing…"
          />
        </Field>
      </Section>

      <Section title="Personal budget">
        <Field label="Max for a single item ($)">
          <input
            type="number"
            inputMode="numeric"
            value={prefs.personal_budget ?? ''}
            onChange={e => onPatch({ personal_budget: numOrNull(e.target.value) })}
            placeholder="e.g. 150"
          />
        </Field>
      </Section>

      <Section title="Gift budget">
        <Row>
          <Field label="Default ($)">
            <input
              type="number"
              value={gb.default ?? ''}
              onChange={e => patchGift({ default: numOrNull(e.target.value) ?? undefined })}
              placeholder="e.g. 50"
            />
          </Field>
          <Field label="Birthday ($)">
            <input
              type="number"
              value={gb.birthday ?? ''}
              onChange={e => patchGift({ birthday: numOrNull(e.target.value) ?? undefined })}
            />
          </Field>
        </Row>
        <Row>
          <Field label="Holiday ($)">
            <input
              type="number"
              value={gb.holiday ?? ''}
              onChange={e => patchGift({ holiday: numOrNull(e.target.value) ?? undefined })}
            />
          </Field>
          <Field label="Anniversary ($)">
            <input
              type="number"
              value={gb.anniversary ?? ''}
              onChange={e => patchGift({ anniversary: numOrNull(e.target.value) ?? undefined })}
            />
          </Field>
        </Row>
        <Field label="Notes">
          <input
            type="text"
            value={gb.freeform ?? ''}
            onChange={e => patchGift({ freeform: e.target.value })}
            placeholder="Any context on how you approach gift budgets…"
          />
        </Field>
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
