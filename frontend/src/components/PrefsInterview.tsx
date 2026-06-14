import { useState } from 'react'
import { MasonPrefsPatch } from '../api'
import styles from './PrefsInterview.module.css'

interface Props {
  onComplete: (patch: MasonPrefsPatch) => void
  onSkip: () => void
}

interface Answer {
  text: string
}

const QUESTIONS = [
  {
    id: 'general_style',
    question: 'How would you describe your personal style when shopping for yourself?',
    hint: 'e.g. minimalist, classic, streetwear, vintage — whatever feels true to you',
  },
  {
    id: 'quality_vs_price',
    question: 'When buying something for yourself, what matters more to you — getting the best price or the best quality?',
    hint: 'Feel free to share how you think about that tradeoff',
  },
  {
    id: 'discovery',
    question: 'Do you love discovering new brands and products, or do you prefer sticking with things you already know and trust?',
    hint: 'No wrong answer — just helps Mason know how adventurous to get',
  },
  {
    id: 'personal_budget',
    question: 'What is the most you would typically spend on a single item for yourself?',
    hint: 'A rough range is totally fine, like "$50–$100" or "under $200"',
  },
  {
    id: 'likes_dislikes',
    question: 'Are there any brands, materials, or styles you particularly love — or ones you want to avoid?',
    hint: 'e.g. "love linen and merino wool, hate fast fashion, always buy Nike shoes"',
  },
  {
    id: 'lifestyle',
    question: 'Tell me a bit about your day-to-day life — where you live, your work setup, any hobbies or activities you are into.',
    hint: 'This helps Mason pick things that actually fit your life',
  },
  {
    id: 'gift_style',
    question: 'When you are shopping for a gift, what kind of gift-giver are you?',
    hint: 'e.g. thoughtful and personal, practical, experiential, last-minute, generous spender — whatever describes you best',
  },
  {
    id: 'gift_budget',
    question: 'What is your typical budget when buying a gift for someone — for a birthday, holiday, or special occasion?',
    hint: 'You can give different amounts for different occasions if that helps',
  },
  {
    id: 'gift_recipients',
    question: 'Who are the people you most often shop for as gifts — family, partner, friends, coworkers?',
    hint: 'Knowing who you shop for helps Mason make better gift suggestions',
  },
  {
    id: 'shopping_frustrations',
    question: 'What is the most frustrating part of shopping — either for yourself or for gifts?',
    hint: 'This is where Mason can help the most, so be honest',
  },
]

function parsePrefsFromAnswers(answers: Record<string, string>): MasonPrefsPatch {
  const patch: MasonPrefsPatch = {}

  // Style tags from general_style answer
  const styleText = (answers.general_style ?? '').toLowerCase()
  const STYLE_MAP: Record<string, string> = {
    minimalist: 'minimalist',
    classic: 'classic',
    streetwear: 'streetwear',
    preppy: 'preppy',
    athleisure: 'athleisure',
    bohemian: 'bohemian',
    vintage: 'vintage',
    technical: 'technical',
    rugged: 'rugged',
    modern: 'modern',
  }
  const matchedStyles: string[] = []
  for (const [keyword, tag] of Object.entries(STYLE_MAP)) {
    if (styleText.includes(keyword)) matchedStyles.push(tag)
  }
  if (matchedStyles.length > 0) patch.style_tags = matchedStyles

  // Quality vs price slider (1=budget, 5=premium)
  const qpText = (answers.quality_vs_price ?? '').toLowerCase()
  if (qpText.includes('quality') || qpText.includes('premium') || qpText.includes('best quality')) {
    patch.quality_price = 4
  } else if (qpText.includes('price') || qpText.includes('budget') || qpText.includes('cheap') || qpText.includes('deal')) {
    patch.quality_price = 2
  } else if (qpText.includes('balance') || qpText.includes('both') || qpText.includes('depends')) {
    patch.quality_price = 3
  }

  // Discover vs known slider (1=stick to known, 5=discover)
  const discoverText = (answers.discovery ?? '').toLowerCase()
  if (discoverText.includes('new') || discoverText.includes('discover') || discoverText.includes('adventur') || discoverText.includes('explore')) {
    patch.discover_known = 4
  } else if (discoverText.includes('known') || discoverText.includes('trust') || discoverText.includes('stick') || discoverText.includes('loyal')) {
    patch.discover_known = 2
  } else {
    patch.discover_known = 3
  }

  // Personal budget
  const budgetText = answers.personal_budget ?? ''
  const budgetNumbers = budgetText.match(/\d+/g)
  if (budgetNumbers && budgetNumbers.length > 0) {
    const nums = budgetNumbers.map(Number)
    patch.personal_budget = Math.max(...nums)
  }

  // Likes and dislikes
  const likesText = answers.likes_dislikes ?? ''
  const likes: string[] = []
  const dislikes: string[] = []

  const loveMatch = likesText.match(/love[sd]?\s+([^,.\n]+)/gi)
  const alwaysMatch = likesText.match(/always\s+buy\s+([^,.\n]+)/gi)
  const hateMatch = likesText.match(/hate[sd]?\s+([^,.\n]+)/gi)
  const avoidMatch = likesText.match(/avoid[sd]?\s+([^,.\n]+)/gi)
  const neverMatch = likesText.match(/never\s+(?:buy|wear)\s+([^,.\n]+)/gi)

  if (loveMatch) likes.push(...loveMatch.map(m => m.replace(/^loves?\s+/i, '').trim()))
  if (alwaysMatch) likes.push(...alwaysMatch.map(m => m.replace(/^always\s+buy\s+/i, '').trim()))
  if (hateMatch) dislikes.push(...hateMatch.map(m => m.replace(/^hates?\s+/i, '').trim()))
  if (avoidMatch) dislikes.push(...avoidMatch.map(m => m.replace(/^avoids?\s+/i, '').trim()))
  if (neverMatch) dislikes.push(...neverMatch.map(m => m.replace(/^never\s+(?:buy|wear)\s+/i, '').trim()))

  if (likes.length > 0) patch.likes = likes
  if (dislikes.length > 0) patch.dislikes = dislikes

  // Lifestyle
  const lifestyleText = (answers.lifestyle ?? '').toLowerCase()
  const lifestyle: MasonPrefsPatch['lifestyle'] = {}

  if (lifestyleText.includes('homeowner') || lifestyleText.includes('own home') || lifestyleText.includes('own a home')) {
    lifestyle.housing = 'homeowner'
  } else if (lifestyleText.includes('rent') || lifestyleText.includes('apartment') || lifestyleText.includes('renter')) {
    lifestyle.housing = 'renter'
  }

  if (lifestyleText.includes('urban') || lifestyleText.includes('city')) lifestyle.area = 'urban'
  else if (lifestyleText.includes('rural') || lifestyleText.includes('country')) lifestyle.area = 'rural'
  else if (lifestyleText.includes('suburb')) lifestyle.area = 'suburban'

  if (lifestyleText.includes('work from home') || lifestyleText.includes('wfh') || lifestyleText.includes('remote')) lifestyle.work_env = 'wfh'
  else if (lifestyleText.includes('hybrid')) lifestyle.work_env = 'hybrid'
  else if (lifestyleText.includes('office')) lifestyle.work_env = 'office'
  else if (lifestyleText.includes('outdoor') || lifestyleText.includes('outside')) lifestyle.work_env = 'outdoor'

  const hobbies: string[] = []
  const hobbyKeywords = ['running', 'hiking', 'cycling', 'yoga', 'lifting', 'gym', 'reading', 'cooking', 'gaming', 'photography', 'painting', 'music', 'travel', 'climbing', 'swimming', 'golf', 'tennis', 'skiing', 'surfing', 'fishing']
  for (const h of hobbyKeywords) {
    if (lifestyleText.includes(h)) hobbies.push(h.charAt(0).toUpperCase() + h.slice(1))
  }
  if (hobbies.length > 0) lifestyle.hobbies = hobbies

  if (Object.keys(lifestyle).length > 0) patch.lifestyle = lifestyle

  // Gift budget
  const giftBudgetText = answers.gift_budget ?? ''
  const giftNums = giftBudgetText.match(/\d+/g)
  if (giftNums && giftNums.length > 0) {
    const nums = giftNums.map(Number)
    const giftBudget: MasonPrefsPatch['gift_budget'] = {}
    if (nums.length === 1) {
      giftBudget.default = nums[0]
    } else {
      giftBudget.default = Math.round(nums.reduce((a, b) => a + b, 0) / nums.length)
      if (giftBudgetText.toLowerCase().includes('birthday')) giftBudget.birthday = nums[0]
      if (giftBudgetText.toLowerCase().includes('holiday') || giftBudgetText.toLowerCase().includes('christmas')) giftBudget.holiday = nums[nums.length > 1 ? 1 : 0]
    }
    patch.gift_budget = giftBudget
  }

  return patch
}

export default function PrefsInterview({ onComplete, onSkip }: Props) {
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [current, setCurrent] = useState('')
  const [done, setDone] = useState(false)

  const q = QUESTIONS[step]
  const isLast = step === QUESTIONS.length - 1
  const progress = ((step) / QUESTIONS.length) * 100

  function handleNext() {
    const trimmed = current.trim()
    const next = { ...answers, [q.id]: trimmed }
    setAnswers(next)
    setCurrent('')

    if (isLast) {
      const patch = parsePrefsFromAnswers(next)
      onComplete(patch)
      setDone(true)
    } else {
      setStep(s => s + 1)
    }
  }

  function handleBack() {
    if (step === 0) return
    setCurrent(answers[QUESTIONS[step - 1].id] ?? '')
    setStep(s => s - 1)
  }

  if (done) {
    return (
      <div className={styles.wrap}>
        <div className={styles.doneCard}>
          <div className={styles.doneIcon}>✓</div>
          <h2 className={styles.doneTitle}>You are all set!</h2>
          <p className={styles.doneSub}>
            Mason has built your preferences based on your answers. You can always fine-tune them below.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <div className={styles.progressBar}>
          <div className={styles.progressFill} style={{ width: `${progress}%` }} />
        </div>
        <div className={styles.stepCount}>{step + 1} of {QUESTIONS.length}</div>
      </div>

      <div className={styles.card}>
        <p className={styles.questionText}>{q.question}</p>
        {q.hint && <p className={styles.hint}>{q.hint}</p>}

        <textarea
          className={styles.textarea}
          placeholder="Type your answer here…"
          value={current}
          onChange={e => setCurrent(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              if (current.trim() || answers[q.id]) handleNext()
            }
          }}
          autoFocus
          rows={4}
        />

        <div className={styles.actions}>
          <div className={styles.leftActions}>
            {step > 0 && (
              <button type="button" className={styles.backBtn} onClick={handleBack}>
                ← Back
              </button>
            )}
            <button type="button" className={styles.skipQBtn} onClick={() => {
              if (isLast) {
                const patch = parsePrefsFromAnswers(answers)
                onComplete(patch)
                setDone(true)
              } else {
                setCurrent('')
                setStep(s => s + 1)
              }
            }}>
              Skip this
            </button>
          </div>
          <button
            type="button"
            className={styles.nextBtn}
            onClick={handleNext}
            disabled={!current.trim() && !answers[q.id]}
          >
            {isLast ? 'Finish' : 'Next →'}
          </button>
        </div>
      </div>

      <button type="button" className={styles.exitBtn} onClick={onSkip}>
        Skip interview — I'll fill it in myself
      </button>
    </div>
  )
}
