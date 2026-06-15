import { ReactNode } from 'react'
import { MasonPrefs, MasonPrefsPatch } from '../api'
import ChipInput from './ChipInput'
import styles from './PrefsForm.module.css'

interface PrefsFormProps {
  prefs: MasonPrefs
  onPatch: (patch: MasonPrefsPatch) => void
}

// ─── Tag category definitions ─────────────────────────────────────────────────
// Each category has a pool of known words (from what onboarding images would produce).
// These appear as quick-add suggestions in the tag editor.

const STYLE_WORDS = [
  'minimalist', 'clean', 'simple', 'classic', 'refined', 'tailored',
  'streetwear', 'urban', 'edgy', 'bohemian', 'eclectic', 'earthy',
  'preppy', 'put-together', 'outdoorsy', 'functional', 'rugged',
  'luxury', 'elevated', 'understated', 'creative', 'artsy', 'expressive',
  'athletic', 'sporty', 'performance',
]

const COLOR_WORDS = [
  'whites', 'creams', 'earth tones', 'terracotta', 'bold colors',
  'pastels', 'navy', 'forest green', 'monochrome', 'black & white',
]

const HOME_WORDS = [
  'modern', 'sleek', 'coastal', 'relaxed', 'natural', 'rustic', 'cozy',
  'industrial', 'architectural', 'warm', 'eclectic', 'bright', 'airy',
  'layered', 'european',
]

const SCENE_WORDS = [
  'adventurous', 'outdoorsy', 'city energy', 'mountain person', 'beach life',
  'cozy evenings', 'food lover', 'artsy', 'road trips',
]

const WEEKEND_WORDS = [
  'hiking', 'camping', 'farmers markets', 'hosting', 'galleries', 'museums',
  'fitness', 'live music', 'thrifting', 'antiques', 'cooking', 'baking',
  'road trips', 'coffee shops', 'reading', 'beach', 'shopping', 'exploring',
]

const CAR_WORDS = [
  'classic', 'bold', 'collector', 'premium', 'practical', 'family-oriented',
  'tech-forward', 'performance', 'timeless', 'romantic', 'rugged', 'utility-first',
  'refined', 'sophisticated',
]

const GIFTING_WORDS = [
  'sentimental', 'luxury', 'practical', 'playful', 'experiences over things',
  'artisan finds', 'thoughtful', 'small-batch',
]

const LIVING_WORDS = [
  'city life', 'suburbs', 'small town', 'rural', 'homeowner', 'renter',
]

const MATERIAL_WORDS = [
  'cashmere', 'wool', 'leather', 'linen', 'cotton', 'denim', 'silk', 'satin',
  'technical fabrics', 'performance', 'canvas', 'velvet', 'wood', 'ceramic',
  'cozy', 'breathable', 'durable', 'artisan', 'handmade',
]

const WORK_WORDS = [
  'home office', 'remote', 'corporate', 'coworking', 'creative studio',
  'outdoors', 'on-site', 'always traveling', 'hybrid',
]

const FAMILY_WORDS = [
  'young kids', 'teens', 'partner', 'solo living', 'multigenerational',
  'empty nester', 'roommates', 'newborn',
]

// ─── Helper ───────────────────────────────────────────────────────────────────

function tagsInPool(all: string[], pool: string[]): string[] {
  const lp = pool.map(w => w.toLowerCase())
  return all.filter(t => lp.includes(t.toLowerCase()))
}

function tagsNotInPools(all: string[], pools: string[][]): string[] {
  const allPoolWords = pools.flat().map(w => w.toLowerCase())
  return all.filter(t => !allPoolWords.includes(t.toLowerCase()))
}

// ─── TagSection ───────────────────────────────────────────────────────────────

function TagSection({
  title,
  pool,
  allTags,
  onChange,
  defaultOpen,
  children,
}: {
  title: string
  pool: string[]
  allTags: string[]
  onChange: (next: string[]) => void
  defaultOpen?: boolean
  children?: ReactNode
}) {
  const sectionTags = tagsInPool(allTags, pool)

  function handleChange(next: string[]) {
    // Rebuild full tag list: keep tags outside this pool, replace this pool's tags
    const outside = allTags.filter(t => !pool.map(w => w.toLowerCase()).includes(t.toLowerCase()))
    onChange([...outside, ...next])
  }

  return (
    <details className={styles.section} open={defaultOpen}>
      <summary className={styles.sectionSummary}>{title}</summary>
      <div className={styles.sectionBody}>
        {children}
        <ChipInput
          values={sectionTags}
          onChange={handleChange}
          suggestions={pool.filter(w => !sectionTags.map(t => t.toLowerCase()).includes(w.toLowerCase()))}
          placeholder="Add a word…"
        />
      </div>
    </details>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

const ALL_POOLS = [
  STYLE_WORDS, COLOR_WORDS, HOME_WORDS, SCENE_WORDS, WEEKEND_WORDS,
  CAR_WORDS, GIFTING_WORDS, LIVING_WORDS, MATERIAL_WORDS, WORK_WORDS, FAMILY_WORDS,
]

export default function PrefsForm({ prefs, onPatch }: PrefsFormProps) {
  const lifestyle = (prefs.lifestyle ?? {}) as Record<string, unknown>
  const allTags = prefs.style_tags ?? []
  const miscTags = tagsNotInPools(allTags, ALL_POOLS)

  function patchTags(next: string[]) {
    onPatch({ style_tags: next })
  }

  function patchLifestyle(patch: Record<string, unknown>) {
    onPatch({ lifestyle: patch as MasonPrefsPatch['lifestyle'] })
  }

  return (
    <div className={styles.form}>
      <p className={styles.helpText}>
        These words describe you — Mason uses them to personalize every recommendation. Add or remove anything.
      </p>

      <TagSection
        title="Style"
        pool={STYLE_WORDS}
        allTags={allTags}
        onChange={patchTags}
        defaultOpen
      />

      <TagSection
        title="Colors & palette"
        pool={COLOR_WORDS}
        allTags={allTags}
        onChange={patchTags}
      />

      <TagSection
        title="Home aesthetic"
        pool={HOME_WORDS}
        allTags={allTags}
        onChange={patchTags}
      />

      <TagSection
        title="Scenes & settings"
        pool={SCENE_WORDS}
        allTags={allTags}
        onChange={patchTags}
      />

      <TagSection
        title="Weekends & hobbies"
        pool={WEEKEND_WORDS}
        allTags={allTags}
        onChange={patchTags}
      />

      <TagSection
        title="Materials"
        pool={MATERIAL_WORDS}
        allTags={allTags}
        onChange={patchTags}
      />

      <TagSection
        title="Work setup"
        pool={WORK_WORDS}
        allTags={allTags}
        onChange={patchTags}
      />

      <TagSection
        title="Home life"
        pool={FAMILY_WORDS}
        allTags={allTags}
        onChange={patchTags}
      />

      <TagSection
        title="Where you live"
        pool={LIVING_WORDS}
        allTags={allTags}
        onChange={patchTags}
      />

      <TagSection
        title="Gifting style"
        pool={GIFTING_WORDS}
        allTags={allTags}
        onChange={patchTags}
      />

      <TagSection
        title="Dream car vibe"
        pool={CAR_WORDS}
        allTags={allTags}
        onChange={patchTags}
      />

      {miscTags.length > 0 && (
        <details className={styles.section}>
          <summary className={styles.sectionSummary}>Other words</summary>
          <div className={styles.sectionBody}>
            <ChipInput
              values={miscTags}
              onChange={next => {
                const poolTags = allTags.filter(t =>
                  ALL_POOLS.flat().map(w => w.toLowerCase()).includes(t.toLowerCase())
                )
                patchTags([...poolTags, ...next])
              }}
              placeholder="Add a word…"
            />
          </div>
        </details>
      )}

      <details className={styles.section}>
        <summary className={styles.sectionSummary}>Pets</summary>
        <div className={styles.sectionBody}>
          <ChipInput
            values={(lifestyle.pets as string[]) ?? []}
            onChange={next => patchLifestyle({ pets: next })}
            placeholder="e.g. dog, cat…"
            suggestions={['dog', 'cat', 'fish', 'bird', 'rabbit']}
          />
        </div>
      </details>

      <details className={styles.section}>
        <summary className={styles.sectionSummary}>Brands & things you love</summary>
        <div className={styles.sectionBody}>
          <ChipInput
            values={prefs.likes ?? []}
            onChange={next => onPatch({ likes: next })}
            placeholder="Add a brand, material, or style…"
          />
        </div>
      </details>

      <details className={styles.section}>
        <summary className={styles.sectionSummary}>Things to avoid</summary>
        <div className={styles.sectionBody}>
          <ChipInput
            values={prefs.dislikes ?? []}
            onChange={next => onPatch({ dislikes: next })}
            placeholder="Add something you never want to see…"
          />
        </div>
      </details>

      <details className={styles.section}>
        <summary className={styles.sectionSummary}>Anything else</summary>
        <div className={styles.sectionBody}>
          <p className={styles.sectionHint}>Free-form notes about your life, routines, or context.</p>
          <textarea
            className={styles.textarea}
            value={(lifestyle.freeform_notes as string) ?? ''}
            onChange={e => patchLifestyle({ freeform_notes: e.target.value })}
            placeholder="e.g. I travel for work, host dinner parties monthly, have a toddler at home…"
            rows={3}
          />
        </div>
      </details>
    </div>
  )
}
