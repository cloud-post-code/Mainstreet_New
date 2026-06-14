import { useEffect, useRef, useState } from 'react'
import { MasonPrefsPatch } from '../api'
import styles from './MasonOnboarding.module.css'

interface Props {
  onComplete: (patch: MasonPrefsPatch) => void
  onSkip: () => void
}

// ─── Step types ────────────────────────────────────────────────────────────────

type StepKind = 'chips' | 'multi-chips' | 'text' | 'image-pick' | 'image-multi' | 'sizing-steps'

interface SizingStep {
  id: string
  label: string
  placeholder: string
}

interface Step {
  id: string
  message: string | string[] // array = Mason sends multiple bubbles
  kind: StepKind
  options?: string[]
  images?: Array<{ label: string; url: string; tags: string[] }>
  placeholder?: string
  sizingSteps?: SizingStep[]
  patchFn: (answer: string | string[]) => Partial<MasonPrefsPatch>
}

// ─── Mason personality helpers ─────────────────────────────────────────────────

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

const BRIDGE_LINES: Record<string, string[]> = {
  after_style: [
    "Love it — already getting a picture of your vibe.",
    "That's a solid start. I've got your aesthetic locked in.",
    "Good taste. I can work with this.",
  ],
  after_images: [
    "Yeah, those caught my eye too.",
    "Your taste is coming through loud and clear.",
    "Nice. The pattern here tells me a lot.",
  ],
  after_lifestyle: [
    "That's helpful — context matters a lot when I'm picking things for you.",
    "Good to know. I'll keep that in mind every time I shop for you.",
    "Perfect. That fills in a lot of gaps.",
  ],
  after_sizing: [
    "Got it — I'll keep your sizes on file so you never have to guess.",
    "Saved. That'll save you a lot of back and forth.",
    "Perfect. I'll use that whenever sizing matters.",
  ],
  after_gifts: [
    "Good to know. Gift shopping can be the hardest part.",
    "Noted — I'll be ready whenever an occasion comes up.",
  ],
  generic: [
    "Got it.",
    "Makes sense.",
    "Perfect.",
    "Noted.",
  ],
}

// ─── Steps definition ──────────────────────────────────────────────────────────

const STEPS: Step[] = [
  {
    id: 'style',
    message: "First things first — how would you describe your style? Pick everything that feels like you.",
    kind: 'multi-chips',
    options: [
      'Minimalist', 'Classic', 'Streetwear', 'Bohemian', 'Preppy', 'Techwear',
      'Cottagecore', 'Old Money', 'Vintage', 'Athleisure', 'Maximalist', 'Dark Academia',
    ],
    patchFn: (ans) => ({ style_tags: (ans as string[]).map(s => s.toLowerCase()) }),
  },
  {
    id: 'vibe_images',
    message: "Now — tap everything that catches your eye. Go with your gut.",
    kind: 'image-multi',
    images: [
      { label: 'Clean & simple',   url: 'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?w=300&q=80', tags: ['minimalist', 'clean'] },
      { label: 'Warm & cozy',      url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300&q=80', tags: ['cozy', 'warm', 'natural'] },
      { label: 'Bold & graphic',   url: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=300&q=80', tags: ['bold', 'graphic', 'statement'] },
      { label: 'Natural & earthy', url: 'https://images.unsplash.com/photo-1490750967868-88df5691cc8a?w=300&q=80', tags: ['natural', 'earthy', 'organic'] },
      { label: 'Sleek & modern',   url: 'https://images.unsplash.com/photo-1511556532299-8f662fc26c06?w=300&q=80', tags: ['modern', 'sleek', 'contemporary'] },
      { label: 'Colorful & fun',   url: 'https://images.unsplash.com/photo-1549289524-06cf8837ace5?w=300&q=80', tags: ['colorful', 'playful', 'vibrant'] },
    ],
    patchFn: (ans) => {
      const selected = ans as string[]
      const VIBE_TAGS: Record<string, string[]> = {
        'Clean & simple':   ['minimalist', 'clean'],
        'Warm & cozy':      ['cozy', 'warm', 'natural'],
        'Bold & graphic':   ['bold', 'graphic', 'statement'],
        'Natural & earthy': ['natural', 'earthy', 'organic'],
        'Sleek & modern':   ['modern', 'sleek', 'contemporary'],
        'Colorful & fun':   ['colorful', 'playful', 'vibrant'],
      }
      const tagsFromImages = selected.flatMap(label => VIBE_TAGS[label] ?? [])
      return { style_tags: [...new Set(tagsFromImages)] }
    },
  },

  // ── Interior/home aesthetic ────────────────────────────────────────────────
  {
    id: 'home_aesthetic',
    message: "What about your home — which of these feels most like your space?",
    kind: 'image-multi',
    images: [
      { label: 'Warm & rustic',    url: 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=300&q=80', tags: ['rustic', 'warm', 'natural'] },
      { label: 'Modern & clean',   url: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=300&q=80', tags: ['modern', 'minimalist', 'clean'] },
      { label: 'Cozy & eclectic',  url: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=300&q=80', tags: ['cozy', 'eclectic', 'layered'] },
      { label: 'Bright & airy',    url: 'https://images.unsplash.com/photo-1484101403633-562f891dc89a?w=300&q=80', tags: ['bright', 'airy', 'open'] },
    ],
    patchFn: (ans) => {
      const HOME_TAGS: Record<string, string[]> = {
        'Warm & rustic':   ['rustic', 'warm', 'natural'],
        'Modern & clean':  ['modern', 'minimalist', 'clean'],
        'Cozy & eclectic': ['cozy', 'eclectic', 'layered'],
        'Bright & airy':   ['bright', 'airy', 'open'],
      }
      const tags = (ans as string[]).flatMap(l => HOME_TAGS[l] ?? [])
      return { lifestyle: { home_aesthetic: (ans as string[]).join(', ') } as MasonPrefsPatch['lifestyle'], style_tags: [...new Set(tags)] }
    },
  },

  // ── Shopping mode ──────────────────────────────────────────────────────────
  {
    id: 'shopping_vibe',
    message: "When you go shopping, what's your usual mode?",
    kind: 'chips',
    options: ['I know exactly what I want', 'I browse until something catches me', 'I love discovering new things', 'Depends on my mood'],
    patchFn: (ans) => {
      const a = ans as string
      const discover_known = a.includes('discovering') || a.includes('browse') ? 2 : a.includes('exactly') ? 4 : 3
      return { discover_known, lifestyle: { discovery_notes: a } as MasonPrefsPatch['lifestyle'] }
    },
  },

  // ── Price attitude ─────────────────────────────────────────────────────────
  {
    id: 'price_vibe',
    message: "How do you think about price when you're buying something for yourself?",
    kind: 'chips',
    options: ['Budget first, always', 'Balance of price & quality', 'Quality over price every time', 'Splurge on things I love, save on the rest'],
    patchFn: (ans) => {
      const a = ans as string
      let quality_price = 3
      if (a.includes('Budget')) quality_price = 1
      else if (a.includes('Quality over')) quality_price = 5
      else if (a.includes('Balance')) quality_price = 3
      else if (a.includes('Splurge')) quality_price = 4
      return { quality_price, lifestyle: { quality_notes: a } as MasonPrefsPatch['lifestyle'] }
    },
  },

  // ── Sizing (guided steps) ──────────────────────────────────────────────────
  {
    id: 'sizing',
    message: [
      "Quick one — let's get your sizing on file so I never have to guess.",
      "Pick what applies to you. You can skip anything that doesn't.",
    ],
    kind: 'sizing-steps',
    sizingSteps: [
      { id: 'shirt',  label: 'Shirt / Top',  placeholder: 'XS / S / M / L / XL / XXL' },
      { id: 'waist',  label: 'Pants waist',  placeholder: 'e.g. 32' },
      { id: 'inseam', label: 'Inseam',       placeholder: 'e.g. 30' },
      { id: 'shoe',   label: 'Shoe size',    placeholder: 'e.g. 10 (US mens)' },
      { id: 'dress',  label: 'Dress / Suit', placeholder: 'e.g. 6 or 38R' },
    ],
    patchFn: (ans) => {
      // ans is a JSON string: { shirt, waist, inseam, shoe, dress }
      try {
        const vals = JSON.parse(ans as string) as Record<string, string>
        const sizes: MasonPrefsPatch['sizes'] = {}
        if (vals.shirt)  sizes.shirt = vals.shirt
        if (vals.waist)  sizes.waist = vals.waist
        if (vals.inseam) sizes.inseam = vals.inseam
        if (vals.shoe)   sizes.shoe = vals.shoe
        if (vals.dress)  sizes.dress = vals.dress
        return { sizes }
      } catch { return {} }
    },
  },

  // ── Family & home ──────────────────────────────────────────────────────────
  {
    id: 'family',
    message: "Who's at home with you? (Helps me shop for the right people.)",
    kind: 'multi-chips',
    options: ['Live alone', 'Partner / spouse', 'Kids', 'Roommates', 'Parents / family'],
    patchFn: (ans) => {
      return { lifestyle: { family_notes: (ans as string[]).join(', ') } as MasonPrefsPatch['lifestyle'] }
    },
  },
  {
    id: 'homeowner',
    message: "Do you own your home or rent?",
    kind: 'chips',
    options: ['Own / homeowner', 'Renting', 'Other'],
    patchFn: (ans) => {
      const a = ans as string
      const housing: MasonLifestyleHousing = a.includes('Own') ? 'homeowner' : a.includes('Rent') ? 'renter' : 'renter'
      return { lifestyle: { housing } as MasonPrefsPatch['lifestyle'] }
    },
  },

  // ── Work & travel ──────────────────────────────────────────────────────────
  {
    id: 'work_env',
    message: "How do you work most days?",
    kind: 'chips',
    options: ['From home', 'Hybrid (office + home)', 'In the office', 'Outdoors / field work', 'Varies'],
    patchFn: (ans) => {
      const a = ans as string
      const work_env = a.includes('home') ? 'wfh' : a.includes('Hybrid') ? 'hybrid' : a.includes('office') ? 'office' : a.includes('Outdoor') ? 'outdoor' : 'hybrid'
      return { lifestyle: { work_env } as MasonPrefsPatch['lifestyle'] }
    },
  },
  {
    id: 'travel',
    message: "How much do you travel?",
    kind: 'chips',
    options: ['Rarely — I stay local', 'A few times a year', 'Monthly or so', 'Constantly on the go'],
    patchFn: (ans) => {
      const a = ans as string
      const travel = a.includes('Rarely') ? 'rarely' : a.includes('few') ? 'few_times_year' : a.includes('Monthly') ? 'monthly' : 'frequently'
      return { lifestyle: { travel } as MasonPrefsPatch['lifestyle'] }
    },
  },

  // ── Pets ───────────────────────────────────────────────────────────────────
  {
    id: 'pets',
    message: "Any pets?",
    kind: 'multi-chips',
    options: ['Dog', 'Cat', 'Other', 'No pets'],
    patchFn: (ans) => {
      const selected = (ans as string[]).filter(s => s !== 'No pets')
      if (selected.length === 0) return {}
      return { lifestyle: { pets: selected.map(s => s.toLowerCase()) } as MasonPrefsPatch['lifestyle'] }
    },
  },

  // ── Hobbies ────────────────────────────────────────────────────────────────
  {
    id: 'hobbies',
    message: "What takes up real time in your life outside of work? Pick anything that applies.",
    kind: 'multi-chips',
    options: [
      'Running / cycling', 'Gym / lifting', 'Yoga / pilates', 'Hiking / outdoors',
      'Cooking / baking', 'Reading', 'Gaming', 'Music', 'Travel', 'Art / crafts',
      'Golf', 'Team sports', 'Gardening', 'Photography',
    ],
    patchFn: (ans) => {
      const selected = ans as string[]
      const hobbies = selected.map(h => h.toLowerCase().split('/')[0].trim())
      return { lifestyle: { hobbies } as MasonPrefsPatch['lifestyle'] }
    },
  },

  // ── Brands / likes ─────────────────────────────────────────────────────────
  {
    id: 'loves',
    message: "Any brands or materials you absolutely love? I'll always keep them in mind.",
    kind: 'text',
    placeholder: "e.g. Patagonia, merino wool, Japanese denim… (or skip)",
    patchFn: (ans) => {
      const text = (ans as string).trim()
      if (!text || text === '(skipped)') return {}
      const items = text.split(/[,;&\n]+/).map(s => s.trim()).filter(Boolean)
      return { likes: items }
    },
  },
  {
    id: 'avoids',
    message: "And anything you always want to avoid — brands, materials, styles?",
    kind: 'text',
    placeholder: "e.g. fast fashion, polyester, overly logo-heavy… (or skip)",
    patchFn: (ans) => {
      const text = (ans as string).trim()
      if (!text || text === '(skipped)') return {}
      const items = text.split(/[,;&\n]+/).map(s => s.trim()).filter(Boolean)
      return { dislikes: items }
    },
  },

  // ── Gifting ────────────────────────────────────────────────────────────────
  {
    id: 'gifting',
    message: "Do you shop for gifts often?",
    kind: 'chips',
    options: ["All the time — it's my thing", 'Sometimes, for the people I love', 'Occasionally, when I have to', 'Rarely'],
    patchFn: (ans) => {
      const a = ans as string
      return { lifestyle: { freeform_notes: `Gifting: ${a}` } as MasonPrefsPatch['lifestyle'] }
    },
  },
  {
    id: 'budget',
    message: "What's a typical budget when you're buying a gift for someone?",
    kind: 'chips',
    options: ['Under $25', '$25–$50', '$50–$100', '$100–$200', '$200+'],
    patchFn: (ans) => {
      const a = ans as string
      const map: Record<string, number> = { 'Under $25': 20, '$25–$50': 40, '$50–$100': 75, '$100–$200': 150, '$200+': 250 }
      const def = map[a] ?? 50
      return { gift_budget: { default: def, freeform: a } as MasonPrefsPatch['gift_budget'] }
    },
  },
]

// Tiny alias so patchFn can reference the housing union without importing
type MasonLifestyleHousing = 'homeowner' | 'renter'

// Which step IDs get a bridge line before the NEXT step fires
const BRIDGE_AFTER: Record<string, keyof typeof BRIDGE_LINES> = {
  vibe_images:    'after_images',
  home_aesthetic: 'after_lifestyle',
  sizing:         'after_sizing',
  budget:         'after_gifts',
}

// ─── Message types ─────────────────────────────────────────────────────────────

type Message =
  | { role: 'mason'; text: string; id: string }
  | { role: 'user'; text: string; id: string }
  | { role: 'typing'; id: string }

// ─── Component ─────────────────────────────────────────────────────────────────

export default function MasonOnboarding({ onComplete, onSkip }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [stepIdx, setStepIdx] = useState(-1)
  const [typing, setTyping] = useState(false)
  const [selectedChips, setSelectedChips] = useState<string[]>([])
  const [selectedImages, setSelectedImages] = useState<string[]>([])
  const [textVal, setTextVal] = useState('')
  const [sizingVals, setSizingVals] = useState<Record<string, string>>({})
  const [patch, setPatch] = useState<MasonPrefsPatch>({})
  const [done, setDone] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const msgCounter = useRef(0)

  function nextId() {
    msgCounter.current += 1
    return `msg-${msgCounter.current}`
  }

  function scrollToBottom() {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }

  function masonSays(text: string, delay = 700): Promise<void> {
    return new Promise(resolve => {
      const typingId = nextId()
      setTyping(true)
      setMessages(prev => [...prev, { role: 'typing', id: typingId }])
      scrollToBottom()
      setTimeout(() => {
        setTyping(false)
        setMessages(prev => prev.filter(m => m.id !== typingId).concat({ role: 'mason', text, id: nextId() }))
        scrollToBottom()
        resolve()
      }, delay)
    })
  }

  function userSays(text: string) {
    setMessages(prev => [...prev, { role: 'user', text, id: nextId() }])
    scrollToBottom()
  }

  useEffect(() => {
    const run = async () => {
      const intro = pick([
        "Hey! I'm Mason — your personal shopper on Main Street. 👋",
        "Hey there! I'm Mason. Think of me as your shopping sidekick. 👋",
        "Hi! I'm Mason, your personal shopper here on Main Street. 👋",
      ])
      await masonSays(intro, 400)
      const sub = pick([
        "A few quick questions and I'll know exactly what to show you.",
        "Just a few questions so I can make every recommendation feel made for you.",
        "Let me get to know you a bit — then I'll only show you things you'll actually want.",
      ])
      await masonSays(sub, 900)
      setStepIdx(0)
    }
    run()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const prevStepIdx = useRef(-1)
  useEffect(() => {
    if (stepIdx < 0 || stepIdx === prevStepIdx.current) return
    if (stepIdx >= STEPS.length) return
    prevStepIdx.current = stepIdx
    const step = STEPS[stepIdx]
    const run = async () => {
      const msgs = Array.isArray(step.message) ? step.message : [step.message]
      for (let i = 0; i < msgs.length; i++) {
        await masonSays(msgs[i], i === 0 ? 500 : 600)
      }
      setSelectedChips([])
      setSelectedImages([])
      setTextVal('')
      setSizingVals({})
    }
    run()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIdx])

  function mergedPatch(current: MasonPrefsPatch, next: Partial<MasonPrefsPatch>): MasonPrefsPatch {
    const merged = { ...current, ...next }
    if (current.style_tags && next.style_tags) merged.style_tags = [...new Set([...current.style_tags, ...next.style_tags])]
    if (current.likes && next.likes) merged.likes = [...new Set([...current.likes, ...next.likes])]
    if (current.dislikes && next.dislikes) merged.dislikes = [...new Set([...current.dislikes, ...next.dislikes])]
    if (current.lifestyle || next.lifestyle) merged.lifestyle = { ...(current.lifestyle ?? {}), ...(next.lifestyle ?? {}) } as MasonPrefsPatch['lifestyle']
    if (current.sizes || next.sizes) merged.sizes = { ...(current.sizes ?? {}), ...(next.sizes ?? {}) } as MasonPrefsPatch['sizes']
    return merged
  }

  async function advance(answer: string | string[]) {
    const step = STEPS[stepIdx]
    const answerText = Array.isArray(answer) ? answer.join(', ') : answer

    if (answerText.trim() && answerText !== '(skipped)') {
      userSays(answerText)
    }

    const newPatch = step.patchFn(answer)
    setPatch(prev => mergedPatch(prev, newPatch))

    const bridgeKey = BRIDGE_AFTER[step.id]
    if (bridgeKey) {
      await masonSays(pick(BRIDGE_LINES[bridgeKey]), 400)
    }

    const next = stepIdx + 1
    if (next >= STEPS.length) {
      setPatch(prev => {
        const finalPatch = mergedPatch(prev, newPatch)
        // Slight delay so the bridge line reads before completion
        setTimeout(async () => {
          await masonSays(pick([
            "You're all set! I've got a clear picture of you now.",
            "Perfect — that's everything I need.",
            "Done! I've got a solid sense of your taste.",
          ]), 600)
          await masonSays(pick([
            "Every recommendation from here on is tailored just for you. Let's shop! 🛍️",
            "I'll put all of this to work. Let's find you something great. 🛍️",
            "Time to go find you some great things. 🛍️",
          ]), 1000)
          setTimeout(() => {
            onComplete(finalPatch)
            setDone(true)
          }, 800)
        }, 300)
        return finalPatch
      })
    } else {
      setStepIdx(next)
    }
  }

  function handleChipClick(option: string) {
    advance(option)
  }

  function handleMultiChipToggle(option: string) {
    setSelectedChips(prev =>
      prev.includes(option) ? prev.filter(c => c !== option) : [...prev, option]
    )
  }

  function handleMultiChipConfirm() {
    if (selectedChips.length === 0) return
    advance(selectedChips)
  }

  function handleImageToggle(label: string) {
    setSelectedImages(prev =>
      prev.includes(label) ? prev.filter(l => l !== label) : [...prev, label]
    )
  }

  function handleImageConfirm() {
    if (selectedImages.length === 0) return
    advance(selectedImages)
  }

  function handleTextSend() {
    advance(textVal.trim() || '(skipped)')
  }

  function handleTextKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleTextSend()
    }
  }

  function handleSizingConfirm() {
    advance(JSON.stringify(sizingVals))
  }

  const currentStep = stepIdx >= 0 && stepIdx < STEPS.length ? STEPS[stepIdx] : null
  const isInteractive = !typing && currentStep != null && !done

  if (done) {
    return (
      <div className={styles.wrap} style={{ justifyContent: 'center' }}>
        <div className={styles.doneWrap}>
          <div className={styles.doneCheck}>✓</div>
          <h2 className={styles.doneTitle}>You're all set!</h2>
          <p className={styles.doneSub}>Mason has got a good sense of your style. Every recommendation from here on is tailored to you.</p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      {/* Header */}
      <div className={styles.header}>
        <img className={styles.avatar} src="/mason/mason-1.png" alt="Mason" />
        <div className={styles.headerText}>
          <div className={styles.headerName}>Mason</div>
          <div className={styles.headerSub}>Your personal shopper</div>
        </div>
        <button className={styles.skipAll} onClick={onSkip}>Skip for now</button>
      </div>

      {/* Progress dots */}
      {stepIdx >= 0 && (
        <div className={styles.progressDots}>
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`${styles.dot} ${i === stepIdx ? styles.active : i < stepIdx ? styles.done : ''}`}
            />
          ))}
        </div>
      )}

      {/* Messages */}
      <div className={styles.messages}>
        {messages.map(msg => {
          if (msg.role === 'typing') {
            return (
              <div key={msg.id} className={styles.typing}>
                <img className={styles.bubbleAvatar} src="/mason/mason-1.png" alt="Mason" />
                <div className={styles.typingDots}>
                  <div className={styles.typingDot} />
                  <div className={styles.typingDot} />
                  <div className={styles.typingDot} />
                </div>
              </div>
            )
          }
          if (msg.role === 'mason') {
            return (
              <div key={msg.id} className={styles.masonBubble}>
                <img className={styles.bubbleAvatar} src="/mason/mason-1.png" alt="Mason" />
                <div className={styles.bubbleText}>{msg.text}</div>
              </div>
            )
          }
          return (
            <div key={msg.id} className={styles.userBubble}>{msg.text}</div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Interaction area */}
      {isInteractive && (
        <div className={styles.interactionArea}>
          {currentStep.kind === 'chips' && (
            <div className={styles.chipRow}>
              {currentStep.options!.map(opt => (
                <button key={opt} className={styles.chip} onClick={() => handleChipClick(opt)}>
                  {opt}
                </button>
              ))}
            </div>
          )}

          {currentStep.kind === 'multi-chips' && (
            <>
              <div className={styles.chipRow}>
                {currentStep.options!.map(opt => (
                  <button
                    key={opt}
                    className={`${styles.chip} ${selectedChips.includes(opt) ? styles.selected : ''}`}
                    onClick={() => handleMultiChipToggle(opt)}
                  >
                    {opt}
                  </button>
                ))}
              </div>
              {selectedChips.length > 0 && (
                <div className={styles.confirmRow}>
                  <button className={styles.confirmBtn} onClick={handleMultiChipConfirm}>
                    That's me →
                  </button>
                </div>
              )}
            </>
          )}

          {currentStep.kind === 'image-multi' && (
            <>
              <div className={styles.imageGrid}>
                {currentStep.images!.map(img => (
                  <div key={img.label} className={styles.imageOptionWrap}>
                    <button
                      className={`${styles.imageOption} ${selectedImages.includes(img.label) ? styles.selected : ''}`}
                      onClick={() => handleImageToggle(img.label)}
                    >
                      <img src={img.url} alt={img.label} />
                    </button>
                    <span className={styles.imageLabel}>{img.label}</span>
                  </div>
                ))}
              </div>
              {selectedImages.length > 0 && (
                <div className={styles.confirmRow}>
                  <button className={styles.confirmBtn} onClick={handleImageConfirm}>
                    Love these →
                  </button>
                </div>
              )}
            </>
          )}

          {currentStep.kind === 'image-pick' && (
            <div className={styles.imageGrid}>
              {currentStep.images!.map(img => (
                <div key={img.label} className={styles.imageOptionWrap}>
                  <button
                    className={styles.imageOption}
                    onClick={() => advance(img.label)}
                  >
                    <img src={img.url} alt={img.label} />
                  </button>
                  <span className={styles.imageLabel}>{img.label}</span>
                </div>
              ))}
            </div>
          )}

          {currentStep.kind === 'text' && (
            <>
              <div className={styles.textRow}>
                <textarea
                  ref={textRef}
                  className={styles.textInput}
                  placeholder={currentStep.placeholder ?? 'Type here…'}
                  value={textVal}
                  onChange={e => setTextVal(e.target.value)}
                  onKeyDown={handleTextKeyDown}
                  autoFocus
                  rows={1}
                />
                <button className={styles.sendBtn} onClick={handleTextSend}>
                  ↑
                </button>
              </div>
              <div className={styles.chipRow}>
                <button className={styles.chip} onClick={() => advance('(skipped)')}>Skip</button>
              </div>
            </>
          )}

          {currentStep.kind === 'sizing-steps' && (
            <>
              <div className={styles.sizingGrid}>
                {currentStep.sizingSteps!.map(s => (
                  <div key={s.id} className={styles.sizingRow}>
                    <label className={styles.sizingLabel}>{s.label}</label>
                    <input
                      className={styles.sizingInput}
                      placeholder={s.placeholder}
                      value={sizingVals[s.id] ?? ''}
                      onChange={e => setSizingVals(prev => ({ ...prev, [s.id]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
              <div className={styles.confirmRow}>
                <button className={styles.chip} onClick={() => advance('(skipped)')}>Skip sizing</button>
                <button className={styles.confirmBtn} onClick={handleSizingConfirm}>
                  Save sizes →
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
