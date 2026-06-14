import { useEffect, useRef, useState } from 'react'
import { MasonPrefsPatch } from '../api'
import styles from './MasonOnboarding.module.css'

interface Props {
  onComplete: (patch: MasonPrefsPatch) => void
  onSkip: () => void
}

// ─── Step types ────────────────────────────────────────────────────────────────

type StepKind = 'chips' | 'multi-chips' | 'text' | 'image-pick' | 'image-multi'

interface Step {
  id: string
  message: string
  kind: StepKind
  options?: string[]
  images?: Array<{ label: string; url: string; tags: string[] }>
  placeholder?: string
  patchFn: (answer: string | string[]) => Partial<MasonPrefsPatch>
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
    message: "Nice! Now — tap everything that catches your eye. Don't overthink it.",
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
  {
    id: 'loves',
    message: "Any brands or materials you absolutely love? I'll always keep them in mind. (Type anything, or skip!)",
    kind: 'text',
    placeholder: "e.g. Patagonia, merino wool, Japanese denim…",
    patchFn: (ans) => {
      const text = (ans as string).trim()
      if (!text) return {}
      const items = text.split(/[,;&\n]+/).map(s => s.trim()).filter(Boolean)
      return { likes: items }
    },
  },
  {
    id: 'avoids',
    message: "And anything you always want to avoid — brands, materials, styles?",
    kind: 'text',
    placeholder: "e.g. fast fashion, polyester, overly logo-heavy…",
    patchFn: (ans) => {
      const text = (ans as string).trim()
      if (!text) return {}
      const items = text.split(/[,;&\n]+/).map(s => s.trim()).filter(Boolean)
      return { dislikes: items }
    },
  },
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

// ─── Message types ─────────────────────────────────────────────────────────────

type Message =
  | { role: 'mason'; text: string; id: string }
  | { role: 'user'; text: string; id: string }
  | { role: 'typing'; id: string }

// ─── Component ─────────────────────────────────────────────────────────────────

export default function MasonOnboarding({ onComplete, onSkip }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [stepIdx, setStepIdx] = useState(-1) // -1 = intro not shown yet
  const [typing, setTyping] = useState(false)
  const [selectedChips, setSelectedChips] = useState<string[]>([])
  const [selectedImages, setSelectedImages] = useState<string[]>([])
  const [textVal, setTextVal] = useState('')
  const [patch, setPatch] = useState<MasonPrefsPatch>({})
  const [done, setDone] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  let msgCounter = useRef(0)

  function nextId() {
    msgCounter.current += 1
    return `msg-${msgCounter.current}`
  }

  function scrollToBottom() {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }

  // Show typing then add a mason message
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

  // Kick off the intro
  useEffect(() => {
    const run = async () => {
      await masonSays("Hey there! I'm Mason — your Main Street personal shopper. 👋", 400)
      await masonSays("I'd love to get to know you a little so I can show you things you'll actually love. It only takes a minute, and the more I know, the better I get!", 900)
      // Advance to first step
      setStepIdx(0)
    }
    run()
  }, [])

  // When stepIdx advances, show the step question
  const prevStepIdx = useRef(-1)
  useEffect(() => {
    if (stepIdx < 0 || stepIdx === prevStepIdx.current) return
    if (stepIdx >= STEPS.length) return
    prevStepIdx.current = stepIdx
    const step = STEPS[stepIdx]
    masonSays(step.message, 500).then(() => {
      setSelectedChips([])
      setSelectedImages([])
      setTextVal('')
    })
  }, [stepIdx])

  function mergedPatch(current: MasonPrefsPatch, next: Partial<MasonPrefsPatch>): MasonPrefsPatch {
    const merged = { ...current, ...next }
    // Merge arrays
    if (current.style_tags && next.style_tags) merged.style_tags = [...new Set([...current.style_tags, ...next.style_tags])]
    if (current.likes && next.likes) merged.likes = [...new Set([...current.likes, ...next.likes])]
    if (current.dislikes && next.dislikes) merged.dislikes = [...new Set([...current.dislikes, ...next.dislikes])]
    // Merge lifestyle
    if (current.lifestyle || next.lifestyle) merged.lifestyle = { ...(current.lifestyle ?? {}), ...(next.lifestyle ?? {}) } as MasonPrefsPatch['lifestyle']
    return merged
  }

  function advance(answer: string | string[]) {
    const step = STEPS[stepIdx]
    const answerText = Array.isArray(answer) ? answer.join(', ') : answer

    if (answerText.trim()) {
      userSays(answerText)
      const newPatch = step.patchFn(answer)
      setPatch(prev => mergedPatch(prev, newPatch))
    }

    const next = stepIdx + 1
    if (next >= STEPS.length) {
      // Wrap up
      setTimeout(async () => {
        await masonSays("You're all set! I've got a great sense of your style now.", 600)
        await masonSays("I'll use everything you shared to make every recommendation feel like it was made just for you. Let's go shopping! 🛍️", 1000)
        setTimeout(() => {
          // Build final merged patch
          setPatch(prev => {
            const finalPatch = mergedPatch(prev, step.patchFn(answer))
            onComplete(finalPatch)
            return finalPatch
          })
          setDone(true)
        }, 800)
      }, 300)
    } else {
      setTimeout(() => setStepIdx(next), 300)
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
    const val = textVal.trim()
    advance(val || '(skipped)')
  }

  function handleTextKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleTextSend()
    }
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
        </div>
      )}
    </div>
  )
}
