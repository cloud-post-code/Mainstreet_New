import { useState } from 'react'
import { MasonPrefsPatch } from '../api'
import styles from './PrefsInterview.module.css'

interface Props {
  onComplete: (patch: MasonPrefsPatch) => void
  onSkip: () => void
}

interface Topic {
  id: string
  title: string
  statement: string
  questions: string[]
}

const TOPICS: Topic[] = [
  {
    id: 'style',
    title: 'Your Personal Style',
    statement: 'We want to understand how you show up in the world through what you wear and use.',
    questions: [
      'How would you describe the way you dress or style your space day to day?',
      'What words or feelings come to mind when you think about products you love?',
      'Are there any aesthetics or vibes you\'re drawn to that you find hard to put into words?',
    ],
  },
  {
    id: 'quality',
    title: 'Quality, Value & How You Shop',
    statement: 'Understanding how you make purchasing decisions helps Mason find the right fit.',
    questions: [
      'When you\'re about to buy something, what\'s going through your head?',
      'How do you typically think about price — do you anchor on a number, shop by feel, or compare options?',
      'Is there a category where you always splurge, and one where you always go budget?',
    ],
  },
  {
    id: 'discovery',
    title: 'Discovery vs. Familiarity',
    statement: 'Some people love finding new things; others know exactly what works and stick to it.',
    questions: [
      'How do you feel about trying new brands or styles you\'ve never heard of?',
      'When did you last buy something from a brand you\'d never tried — what prompted it?',
      'What would make you trust a new recommendation enough to actually buy it?',
    ],
  },
  {
    id: 'tastes',
    title: 'What You Love & What You Avoid',
    statement: 'The more Mason knows about your tastes, the better it can filter for you.',
    questions: [
      'What brands, materials, or products do you genuinely love and keep coming back to?',
      'What do you absolutely want to avoid — materials, styles, brands, anything at all?',
      'Is there something you used to like but have moved on from?',
    ],
  },
  {
    id: 'lifestyle',
    title: 'Your Lifestyle',
    statement: 'Context shapes what\'s actually useful in your life.',
    questions: [
      'Walk me through a typical week — where are you, what are you doing, what environments do you move through?',
      'What activities or hobbies take up real time in your life?',
      'How does your home life factor into what you buy?',
    ],
  },
  {
    id: 'gifting',
    title: 'How You Give Gifts',
    statement: 'Mason can help you find the perfect gift, but first it needs to understand how you think about giving.',
    questions: [
      'How do you approach buying a gift — do you go personal, practical, experiential?',
      'What\'s a gift you gave recently that felt really right? What made it work?',
      'How do you think about budget when it comes to gifts — does it change by person or occasion?',
    ],
  },
  {
    id: 'recipients',
    title: 'Gift Recipients & Occasions',
    statement: 'Knowing who you shop for helps Mason surface ideas at the right moments.',
    questions: [
      'Who are the people you most often buy gifts for?',
      'Are there any upcoming occasions you tend to plan ahead for?',
      'Is there anyone you find genuinely hard to shop for — and why?',
    ],
  },
]

// Stop words to filter out when extracting style tags / lifestyle words
const STOP_WORDS = new Set([
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'the', 'a', 'an', 'and', 'or', 'but',
  'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'is', 'are', 'was',
  'were', 'be', 'been', 'have', 'has', 'do', 'does', 'did', 'will', 'would', 'can',
  'could', 'should', 'that', 'this', 'these', 'those', 'it', 'its', 'so', 'as',
  'very', 'just', 'like', 'also', 'when', 'what', 'how', 'more', 'about', 'into',
  'up', 'out', 'not', 'no', 'if', 'then', 'than', 'too', 'any', 'all', 'they',
  'them', 'their', 'he', 'she', 'his', 'her', 'lot', 'things', 'something', 'anything',
  'find', 'feel', 'think', 'know', 'say', 'get', 'go', 'come', 'buy', 'love', 'really',
  'kind', 'sort', 'way', 'tend', 'bit', 'tend', 'hard', 'still', 'always', 'usually',
  'often', 'never', 'sometimes', 'much', 'many', 'most', 'some', 'new', 'old', 'good',
])

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .map(w => w.replace(/^[-']+|[-']+$/g, ''))
    .filter(w => w.length > 2 && !STOP_WORDS.has(w))
}

// Negation signals — text after these becomes a dislike
const NEGATION_PATTERNS = [
  /(?:hate[sd]?|can't stand|dislike[sd]?|avoid[s]?|never wear|never buy|don't like|not a fan of|stay away from|don't want|wouldn't wear|detest[s]?)\s+([^,.!?;]+)/gi,
]

// Positive signals — text after these becomes a like
const POSITIVE_PATTERNS = [
  /(?:love[sd]?|adore[sd]?|obsessed with|always (?:buy|wear|get)|really into|big fan of|prefer[s]?|go-to is|go-to are)\s+([^,.!?;]+)/gi,
]

function extractPhrases(text: string, patterns: RegExp[]): string[] {
  const results: string[] = []
  for (const pattern of patterns) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(text)) !== null) {
      const phrase = match[1].trim().replace(/\s+/g, ' ')
      if (phrase.length > 1 && phrase.length < 60) results.push(phrase)
    }
  }
  // Also split on commas/semicolons at the top level for list-style answers
  return results
}

function parsePrefsFromAnswers(answers: Record<string, string>): MasonPrefsPatch {
  const patch: MasonPrefsPatch = {}

  // --- Style tags: tokenize the style answer ---
  const styleRaw = answers.style ?? ''
  const styleTokens = tokenize(styleRaw)
  // Dedupe while preserving order
  const styleTagsSet = new Set<string>()
  for (const t of styleTokens) styleTagsSet.add(t)
  if (styleTagsSet.size > 0) patch.style_tags = Array.from(styleTagsSet)

  // --- Likes & Dislikes from the tastes topic ---
  const tastesRaw = answers.tastes ?? ''

  // Positive mentions
  const extractedLikes = extractPhrases(tastesRaw, POSITIVE_PATTERNS)
  // Fallback: split on commas/and for the "love" sentences
  const loveIdx = tastesRaw.toLowerCase().indexOf('love')
  const avoidIdx = tastesRaw.toLowerCase().search(/avoid|hate|don't|never/)
  const positiveSection = loveIdx >= 0
    ? tastesRaw.slice(loveIdx, avoidIdx > loveIdx ? avoidIdx : undefined)
    : ''
  const commaSplitLikes = positiveSection
    .split(/,|\band\b/)
    .map(s => s.replace(/love[sd]?\s*/i, '').trim())
    .filter(s => s.length > 1 && s.length < 60)

  const allLikes = [...new Set([...extractedLikes, ...commaSplitLikes].map(s => s.trim()).filter(Boolean))]
  if (allLikes.length > 0) patch.likes = allLikes

  // Negative mentions
  const extractedDislikes = extractPhrases(tastesRaw, NEGATION_PATTERNS)
  const negativeSection = avoidIdx >= 0 ? tastesRaw.slice(avoidIdx) : ''
  const commaSplitDislikes = negativeSection
    .split(/,|\band\b/)
    .map(s => s.replace(/(?:avoid|hate|don't like|never)\s*/i, '').trim())
    .filter(s => s.length > 1 && s.length < 60)

  const allDislikes = [...new Set([...extractedDislikes, ...commaSplitDislikes].map(s => s.trim()).filter(Boolean))]
  if (allDislikes.length > 0) patch.dislikes = allDislikes

  // --- Lifestyle: tokenize + keyword detect ---
  const lifestyleRaw = answers.lifestyle ?? ''
  const lifestyleLower = lifestyleRaw.toLowerCase()
  const lifestyle: Record<string, unknown> = {}

  if (lifestyleLower.includes('homeowner') || lifestyleLower.includes('own home') || lifestyleLower.includes('own a home') || lifestyleLower.includes('bought a house')) {
    lifestyle.housing = 'homeowner'
  } else if (lifestyleLower.includes('rent') || lifestyleLower.includes('apartment') || lifestyleLower.includes('lease')) {
    lifestyle.housing = 'renter'
  }

  if (lifestyleLower.includes('city') || lifestyleLower.includes('urban') || lifestyleLower.includes('downtown') || lifestyleLower.includes('manhattan') || lifestyleLower.includes('brooklyn')) {
    lifestyle.area = 'urban'
  } else if (lifestyleLower.includes('rural') || lifestyleLower.includes('countryside') || lifestyleLower.includes('farm')) {
    lifestyle.area = 'rural'
  } else if (lifestyleLower.includes('suburb')) {
    lifestyle.area = 'suburban'
  }

  if (lifestyleLower.includes('work from home') || lifestyleLower.includes('wfh') || lifestyleLower.includes('remote work') || lifestyleLower.includes('working from home')) {
    lifestyle.work_env = 'wfh'
  } else if (lifestyleLower.includes('hybrid')) {
    lifestyle.work_env = 'hybrid'
  } else if (lifestyleLower.includes('office')) {
    lifestyle.work_env = 'office'
  } else if (lifestyleLower.includes('outdoor') || lifestyleLower.includes('outside work') || lifestyleLower.includes('field work')) {
    lifestyle.work_env = 'outdoor'
  }

  // Hobbies: extract meaningful words from both lifestyle and quality answers
  const hobbySource = `${answers.lifestyle ?? ''} ${answers.quality ?? ''}`
  const hobbyTokens = tokenize(hobbySource)
  const HOBBY_WORDS = new Set([
    'running', 'hiking', 'cycling', 'yoga', 'lifting', 'gym', 'reading', 'cooking',
    'gaming', 'photography', 'painting', 'music', 'travel', 'climbing', 'swimming',
    'golf', 'tennis', 'skiing', 'surfing', 'fishing', 'biking', 'crossfit', 'pilates',
    'gardening', 'woodworking', 'crafting', 'knitting', 'sewing', 'baking', 'dancing',
    'volleyball', 'basketball', 'soccer', 'football', 'hockey', 'boxing', 'martial',
  ])
  const hobbies = hobbyTokens.filter(t => HOBBY_WORDS.has(t)).map(t => t.charAt(0).toUpperCase() + t.slice(1))
  if (hobbies.length > 0) lifestyle.hobbies = [...new Set(hobbies)]

  // Store raw freeform lifestyle notes for Mason context
  if (lifestyleRaw.trim()) lifestyle.freeform_notes = lifestyleRaw.trim()

  if (Object.keys(lifestyle).length > 0) patch.lifestyle = lifestyle as MasonPrefsPatch['lifestyle']

  // --- Gift budget: extract numbers from gifting answer ---
  const giftingRaw = answers.gifting ?? ''
  const giftNums = giftingRaw.match(/\$?\d+/g)
  if (giftNums && giftNums.length > 0) {
    const nums = giftNums.map(n => parseInt(n.replace('$', ''), 10)).filter(n => !isNaN(n))
    const giftBudget: Record<string, unknown> = { freeform: giftingRaw.trim() }
    if (nums.length === 1) {
      giftBudget.default = nums[0]
    } else {
      giftBudget.default = Math.round(nums.reduce((a, b) => a + b, 0) / nums.length)
      const gl = giftingRaw.toLowerCase()
      if (gl.includes('birthday') && nums[0]) giftBudget.birthday = nums[0]
      if ((gl.includes('holiday') || gl.includes('christmas')) && nums[1]) giftBudget.holiday = nums[1]
    }
    patch.gift_budget = giftBudget as MasonPrefsPatch['gift_budget']
  } else if (giftingRaw.trim()) {
    patch.gift_budget = { freeform: giftingRaw.trim() } as MasonPrefsPatch['gift_budget']
  }

  // Store quality/discovery raw answers in lifestyle freeform for Mason context
  const qualityRaw = answers.quality ?? ''
  const discoveryRaw = answers.discovery ?? ''
  if (qualityRaw.trim() || discoveryRaw.trim()) {
    const existing = (patch.lifestyle ?? {}) as Record<string, unknown>
    if (qualityRaw.trim()) existing.quality_notes = qualityRaw.trim()
    if (discoveryRaw.trim()) existing.discovery_notes = discoveryRaw.trim()
    patch.lifestyle = existing as MasonPrefsPatch['lifestyle']
  }

  return patch
}

export default function PrefsInterview({ onComplete, onSkip }: Props) {
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [current, setCurrent] = useState('')
  const [done, setDone] = useState(false)

  const topic = TOPICS[step]
  const isLast = step === TOPICS.length - 1
  const progress = (step / TOPICS.length) * 100

  function handleNext() {
    const next = { ...answers, [topic.id]: current.trim() }
    setAnswers(next)
    setCurrent('')

    if (isLast) {
      onComplete(parsePrefsFromAnswers(next))
      setDone(true)
    } else {
      setStep(s => s + 1)
    }
  }

  function handleBack() {
    if (step === 0) return
    const prevId = TOPICS[step - 1].id
    setCurrent(answers[prevId] ?? '')
    setStep(s => s - 1)
  }

  function handleSkipTopic() {
    setCurrent('')
    if (isLast) {
      onComplete(parsePrefsFromAnswers(answers))
      setDone(true)
    } else {
      setStep(s => s + 1)
    }
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
        <div className={styles.stepCount}>{step + 1} / {TOPICS.length}</div>
      </div>

      <div className={styles.card}>
        <div className={styles.topicLabel}>{topic.title}</div>
        <p className={styles.statement}>{topic.statement}</p>

        <ul className={styles.questionList}>
          {topic.questions.map((q, i) => (
            <li key={i} className={styles.questionItem}>{q}</li>
          ))}
        </ul>

        <textarea
          className={styles.textarea}
          placeholder="Share your thoughts here — write as much or as little as you'd like…"
          value={current}
          onChange={e => setCurrent(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              handleNext()
            }
          }}
          autoFocus
          rows={5}
        />

        <div className={styles.actions}>
          <div className={styles.leftActions}>
            {step > 0 && (
              <button type="button" className={styles.backBtn} onClick={handleBack}>
                ← Back
              </button>
            )}
            <button type="button" className={styles.skipQBtn} onClick={handleSkipTopic}>
              Skip
            </button>
          </div>
          <button
            type="button"
            className={styles.nextBtn}
            onClick={handleNext}
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
