import { useEffect, useRef, useState } from 'react'
import { MasonLifestyle, MasonPrefsPatch } from '../api'
import styles from './MasonOnboarding.module.css'

interface Props {
  onComplete: (patch: MasonPrefsPatch) => void
  onSkip: () => void
}

// ─── Image option type ────────────────────────────────────────────────────────

interface ImgOpt {
  value: string
  label: string
  url: string
  note: string            // 2–4 word descriptor composed into stored text
  tags?: string[]         // bonus style_tags
}

// ─── Step types ────────────────────────────────────────────────────────────────

type StepKind = 'image-multi' | 'image-pick' | 'sizing-steps' | 'text'

interface SizingField {
  id: string
  label: string
  placeholder: string
}

interface Step {
  id: string
  message: string | string[]
  kind: StepKind
  images?: ImgOpt[]
  sizingFields?: SizingField[]
  placeholder?: string
  patchFn: (answer: string | string[]) => Partial<MasonPrefsPatch>
}

// ─── Text helpers ─────────────────────────────────────────────────────────────

function joinNatural(items: string[]): string {
  if (!items.length) return ''
  if (items.length === 1) return items[0]
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1]
}

function buildNote(opts: ImgOpt[], selected: string[], template: (notes: string[]) => string): string {
  const notes = selected.map(v => opts.find(o => o.value === v)?.note ?? v).filter(Boolean)
  return notes.length ? template(notes) : ''
}

// ─── Image option sets ────────────────────────────────────────────────────────

const STYLE_OPTS: ImgOpt[] = [
  { value: 'minimalist',  label: 'Clean & minimal',    url: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&q=60&fit=crop', note: 'clean and minimal',            tags: ['minimalist', 'clean', 'simple'] },
  { value: 'classic',     label: 'Timeless classic',   url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&q=60&fit=crop', note: 'timeless and classic',        tags: ['classic', 'refined', 'tailored'] },
  { value: 'streetwear',  label: 'Street cool',        url: 'https://images.unsplash.com/photo-1523398002811-999ca8dec234?w=400&q=60&fit=crop', note: 'street-influenced',           tags: ['streetwear', 'urban', 'edgy'] },
  { value: 'bohemian',    label: 'Free spirit',        url: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=400&q=60&fit=crop', note: 'bohemian and free-spirited',  tags: ['bohemian', 'eclectic', 'earthy'] },
  { value: 'preppy',      label: 'Polished preppy',    url: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=400&q=60&fit=crop', note: 'polished and preppy',         tags: ['preppy', 'classic', 'put-together'] },
  { value: 'outdoorsy',   label: 'Outdoorsy',          url: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=400&q=60&fit=crop', note: 'outdoorsy and functional',    tags: ['outdoorsy', 'functional', 'rugged'] },
  { value: 'luxury',      label: 'Quiet luxury',       url: 'https://images.unsplash.com/photo-1445205170230-053b83016050?w=400&q=60&fit=crop', note: 'quietly luxurious',           tags: ['luxury', 'elevated', 'understated'] },
  { value: 'artsy',       label: 'Creative & artsy',   url: 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=400&q=60&fit=crop', note: 'creative and expressive',     tags: ['creative', 'artsy', 'expressive'] },
  { value: 'athletic',    label: 'Athletic / Sport',   url: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=400&q=60&fit=crop', note: 'athletic and performance-driven', tags: ['athletic', 'sporty', 'performance'] },
]

const VIBE_OPTS: ImgOpt[] = [
  { value: 'clean_simple',   label: 'Clean & simple',   url: 'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?w=300&q=80', note: 'clean and simple',   tags: ['minimalist', 'clean'] },
  { value: 'warm_cozy',      label: 'Warm & cozy',      url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300&q=80', note: 'warm and cozy',     tags: ['cozy', 'warm', 'natural'] },
  { value: 'bold_graphic',   label: 'Bold & graphic',   url: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=300&q=80', note: 'bold and graphic',  tags: ['bold', 'graphic', 'statement'] },
  { value: 'natural_earthy', label: 'Natural & earthy', url: 'https://images.unsplash.com/photo-1490750967868-88df5691cc8a?w=300&q=80', note: 'natural and earthy', tags: ['natural', 'earthy', 'organic'] },
  { value: 'sleek_modern',   label: 'Sleek & modern',   url: 'https://images.unsplash.com/photo-1511556532299-8f662fc26c06?w=300&q=80', note: 'sleek and modern',   tags: ['modern', 'sleek', 'contemporary'] },
  { value: 'colorful_fun',   label: 'Colorful & fun',   url: 'https://images.unsplash.com/photo-1549289524-06cf8837ace5?w=300&q=80', note: 'colorful and fun',   tags: ['colorful', 'playful', 'vibrant'] },
]

const HOME_OPTS: ImgOpt[] = [
  { value: 'warm_rustic',   label: 'Warm & rustic',   url: 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=300&q=80', note: 'warm and rustic',   tags: ['rustic', 'warm', 'natural'] },
  { value: 'modern_clean',  label: 'Modern & clean',  url: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=300&q=80', note: 'modern and clean',  tags: ['modern', 'minimalist', 'clean'] },
  { value: 'cozy_eclectic', label: 'Cozy & eclectic', url: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=300&q=80', note: 'cozy and eclectic',  tags: ['cozy', 'eclectic', 'layered'] },
  { value: 'bright_airy',   label: 'Bright & airy',   url: 'https://images.unsplash.com/photo-1484101403633-562f891dc89a?w=300&q=80', note: 'bright and airy',   tags: ['bright', 'airy', 'open'] },
]

const SHOPPING_OPTS: ImgOpt[] = [
  { value: 'know_exactly',  label: 'I know what I want',     url: 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=300&q=80', note: 'purposeful and decisive' },
  { value: 'browse',        label: 'I browse till it clicks', url: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=300&q=80', note: 'a relaxed browser' },
  { value: 'discover',      label: 'I love discovering',     url: 'https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=300&q=80', note: 'discovery-oriented' },
  { value: 'mood',          label: 'Depends on my mood',     url: 'https://images.unsplash.com/photo-1521791136064-7986c2920216?w=300&q=80', note: 'mood-driven' },
]

const PRICE_OPTS: ImgOpt[] = [
  { value: 'budget_first',  label: 'Budget first',         url: 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=300&q=80', note: 'budget-conscious and value-focused' },
  { value: 'balanced',      label: 'Balance of price & quality', url: 'https://images.unsplash.com/photo-1472851294608-062f824d29cc?w=300&q=80', note: 'balanced on price and quality' },
  { value: 'quality_over',  label: 'Quality over price',   url: 'https://images.unsplash.com/photo-1445205170230-053b83016050?w=300&q=80', note: 'quality-first and willing to invest' },
  { value: 'splurge',       label: 'Splurge on things I love', url: 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=300&q=80', note: 'selectively splurging on what matters' },
]

const FAMILY_OPTS: ImgOpt[] = [
  { value: 'solo',          label: 'Flying solo',          url: 'https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=300&q=80', note: 'living solo and independently' },
  { value: 'partner',       label: 'Partner / spouse',     url: 'https://images.unsplash.com/photo-1522673607200-164d1b6ce486?w=300&q=80', note: 'with a partner' },
  { value: 'kids',          label: 'Kids at home',         url: 'https://images.unsplash.com/photo-1536640712-4d4c36ff0e4e?w=300&q=80', note: 'kids at home' },
  { value: 'roommates',     label: 'Roommates',            url: 'https://images.unsplash.com/photo-1529543544282-ea669407fca3?w=300&q=80', note: 'living with roommates' },
  { value: 'family',        label: 'Parents / extended family', url: 'https://images.unsplash.com/photo-1581579438747-1dc8d17bbce4?w=300&q=80', note: 'with extended family nearby' },
]

const HOMEOWNER_OPTS: ImgOpt[] = [
  { value: 'own', label: 'Own / homeowner', url: 'https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=300&q=80', note: 'a homeowner' },
  { value: 'rent', label: 'Renting', url: 'https://images.unsplash.com/photo-1502672023488-70e25813eb80?w=300&q=80', note: 'renting their space' },
]

const WORK_OPTS: ImgOpt[] = [
  { value: 'home_office',      label: 'Home office',         url: 'https://images.unsplash.com/photo-1593642632559-0c6d3fc62b89?w=300&q=80', note: 'from a home office' },
  { value: 'kitchen_table',    label: 'Kitchen table WFH',   url: 'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=300&q=80', note: 'from wherever at home' },
  { value: 'corporate_office', label: 'Corporate office',    url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=300&q=80', note: 'from a corporate office' },
  { value: 'coworking',        label: 'Coworking / café',    url: 'https://images.unsplash.com/photo-1521791136064-7986c2920216?w=300&q=80', note: 'from coworking spaces and cafés' },
  { value: 'creative_studio',  label: 'Creative studio',     url: 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=300&q=80', note: 'from a creative studio' },
  { value: 'outdoors_field',   label: 'Outdoors / On-site',  url: 'https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?w=300&q=80', note: 'outdoors or on-site' },
  { value: 'always_traveling', label: 'Always traveling',    url: 'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=300&q=80', note: 'constantly on the road' },
]

const TRAVEL_OPTS: ImgOpt[] = [
  { value: 'rarely',          label: 'Rarely — I stay local', url: 'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=300&q=80', note: 'mostly local' },
  { value: 'few_times_year',  label: 'A few times a year',    url: 'https://images.unsplash.com/photo-1488085061387-422e29b40080?w=300&q=80', note: 'traveling a few times a year' },
  { value: 'monthly',         label: 'Monthly or so',         url: 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=300&q=80', note: 'traveling monthly' },
  { value: 'frequently',      label: 'Constantly on the go',  url: 'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=300&q=80', note: 'constantly traveling' },
]

const PETS_OPTS: ImgOpt[] = [
  { value: 'dog',    label: 'Dog',     url: 'https://images.unsplash.com/photo-1543466835-00a7907e9de1?w=300&q=80', note: 'a dog' },
  { value: 'cat',    label: 'Cat',     url: 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=300&q=80', note: 'a cat' },
  { value: 'other',  label: 'Other',   url: 'https://images.unsplash.com/photo-1425082661705-1834bfd09dca?w=300&q=80', note: 'other pets' },
  { value: 'no_pets',label: 'No pets', url: 'https://images.unsplash.com/photo-1554995207-c18c203602cb?w=300&q=80', note: '' },
]

const HOBBIES_OPTS: ImgOpt[] = [
  { value: 'hiking',         label: 'Hiking or camping',    url: 'https://images.unsplash.com/photo-1551632811-561732d1e306?w=300&q=80', note: 'hiking and camping', tags: ['outdoorsy'] },
  { value: 'farmers_market', label: 'Farmers markets',      url: 'https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=300&q=80', note: 'farmers markets', tags: ['local', 'artisan'] },
  { value: 'hosting',        label: 'Hosting dinners',      url: 'https://images.unsplash.com/photo-1529543544282-ea669407fca3?w=300&q=80', note: 'hosting dinners', tags: ['entertaining'] },
  { value: 'gallery',        label: 'Galleries & museums',  url: 'https://images.unsplash.com/photo-1531058020387-3be344556be6?w=300&q=80', note: 'galleries and museums', tags: ['artsy', 'cultural'] },
  { value: 'gym_wellness',   label: 'Gym or wellness',      url: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=300&q=80', note: 'gym and wellness routines', tags: ['fitness', 'health'] },
  { value: 'live_music',     label: 'Live music',           url: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=300&q=80', note: 'live music and festivals', tags: ['music'] },
  { value: 'thrifting',      label: 'Thrifting & antiques', url: 'https://images.unsplash.com/photo-1558171813-7c1df82c0b27?w=300&q=80', note: 'thrifting and antiques', tags: ['vintage'] },
  { value: 'cooking',        label: 'Cooking or baking',    url: 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=300&q=80', note: 'cooking and baking', tags: ['culinary'] },
  { value: 'road_trip',      label: 'Road trips',           url: 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=300&q=80', note: 'spontaneous road trips', tags: ['adventure'] },
  { value: 'reading_cafe',   label: 'Coffee & reading',     url: 'https://images.unsplash.com/photo-1442512595331-e89e73853f31?w=300&q=80', note: 'reading at coffee shops', tags: ['bookish'] },
  { value: 'beach_park',     label: 'Beach or park',        url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=300&q=80', note: 'beach and park time', tags: ['relaxed', 'outdoor'] },
  { value: 'shopping',       label: 'Shopping & exploring', url: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=300&q=80', note: 'shopping and exploring', tags: ['fashion'] },
]

const GIFTING_OPTS: ImgOpt[] = [
  { value: 'sentimental',    label: 'Sentimental keepsake', url: 'https://images.unsplash.com/photo-1512909006721-3d6018887383?w=300&q=80', note: 'sentimental keepsakes' },
  { value: 'luxury_splurge', label: 'Luxury splurge',       url: 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=300&q=80', note: 'luxury splurges' },
  { value: 'useful',         label: 'Useful & practical',   url: 'https://images.unsplash.com/photo-1491553895911-0055eca6402d?w=300&q=80', note: 'useful and practical gifts' },
  { value: 'funny',          label: 'Funny & playful',      url: 'https://images.unsplash.com/photo-1513151233558-d860c5398176?w=300&q=80', note: 'funny and playful gifts' },
  { value: 'experience',     label: 'An experience',        url: 'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=300&q=80', note: 'experiences over objects' },
  { value: 'artisan',        label: 'Local or artisan',     url: 'https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=300&q=80', note: 'local and artisan finds' },
]

const BUDGET_OPTS: ImgOpt[] = [
  { value: 'under_25',   label: 'Under $25',   url: 'https://images.unsplash.com/photo-1607082349566-187342175e2f?w=300&q=80', note: 'under $25' },
  { value: '25_50',      label: '$25–$50',      url: 'https://images.unsplash.com/photo-1472851294608-062f824d29cc?w=300&q=80', note: '$25 to $50' },
  { value: '50_100',     label: '$50–$100',     url: 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=300&q=80', note: '$50 to $100' },
  { value: '100_200',    label: '$100–$200',    url: 'https://images.unsplash.com/photo-1512909006721-3d6018887383?w=300&q=80', note: '$100 to $200' },
  { value: '200_plus',   label: '$200+',        url: 'https://images.unsplash.com/photo-1445205170230-053b83016050?w=300&q=80', note: '$200 or more' },
]

// ─── Note composers ───────────────────────────────────────────────────────────

function composeProfileText(notes: Record<string, string>): string {
  const NOTE_KEYS = [
    'style_notes', 'vibe_notes', 'home_aesthetic_notes',
    'shopping_vibe_notes', 'price_vibe_notes',
    'family_notes', 'homeowner_notes', 'work_setup_notes',
    'travel_notes', 'pets_notes_text', 'weekend_notes',
    'gifting_notes', 'budget_notes',
  ]
  return NOTE_KEYS.map(k => notes[k] ?? '').filter(Boolean).join(' ')
}

// ─── Mason personality helpers ────────────────────────────────────────────────

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

const BRIDGE_LINES: Record<string, string[]> = {
  after_style: [
    "Love it — already getting a picture of your vibe.",
    "That's a solid aesthetic. I've got you.",
    "Good taste. I can work with this.",
  ],
  after_images: [
    "Yeah, those caught my eye too.",
    "Your taste is coming through loud and clear.",
    "Nice. The pattern here tells me a lot.",
  ],
  after_lifestyle: [
    "That's helpful — context matters when I'm picking things for you.",
    "Good to know. I'll keep that in mind.",
    "Perfect. That fills in a lot of gaps.",
  ],
  after_sizing: [
    "Got it — I'll keep your sizes on file.",
    "Saved. That'll save you a lot of back and forth.",
    "Perfect. I'll use that whenever sizing matters.",
  ],
  after_gifts: [
    "Good to know. Gift shopping can be the hardest part.",
    "Noted — I'll be ready whenever an occasion comes up.",
  ],
  generic: ["Got it.", "Makes sense.", "Perfect.", "Noted."],
}

// ─── Steps ────────────────────────────────────────────────────────────────────

const STEPS: Step[] = [
  {
    id: 'style',
    message: "First things first — which of these feels like your style energy? Pick everything that fits.",
    kind: 'image-multi',
    images: STYLE_OPTS,
    patchFn: (ans) => {
      const selected = ans as string[]
      const tags = selected.flatMap(v => STYLE_OPTS.find(o => o.value === v)?.tags ?? [])
      const note = buildNote(STYLE_OPTS, selected, ls => `Their style is ${joinNatural(ls)}.`)
      return {
        style_tags: [...new Set([...selected, ...tags])],
        lifestyle: { style_selections: selected, style_notes: note } as Partial<MasonLifestyle>,
      }
    },
  },
  {
    id: 'vibe_images',
    message: "Now — tap everything that catches your eye. Go with your gut.",
    kind: 'image-multi',
    images: VIBE_OPTS,
    patchFn: (ans) => {
      const selected = ans as string[]
      const tags = selected.flatMap(v => VIBE_OPTS.find(o => o.value === v)?.tags ?? [])
      const note = buildNote(VIBE_OPTS, selected, ls => `They are drawn to ${joinNatural(ls)} aesthetics.`)
      return {
        style_tags: [...new Set(tags)],
        lifestyle: { vibe_notes: note } as Partial<MasonLifestyle>,
      }
    },
  },
  {
    id: 'home_aesthetic',
    message: "What about your home — which of these feels most like your space?",
    kind: 'image-multi',
    images: HOME_OPTS,
    patchFn: (ans) => {
      const selected = ans as string[]
      const tags = selected.flatMap(v => HOME_OPTS.find(o => o.value === v)?.tags ?? [])
      const note = buildNote(HOME_OPTS, selected, ls => `Their home aesthetic is ${joinNatural(ls)}.`)
      return {
        style_tags: [...new Set(tags)],
        lifestyle: {
          home_aesthetic: selected.join(', '),
          home_aesthetic_notes: note,
        } as Partial<MasonLifestyle>,
      }
    },
  },
  {
    id: 'shopping_vibe',
    message: "When you go shopping, what's your usual mode?",
    kind: 'image-multi',
    images: SHOPPING_OPTS,
    patchFn: (ans) => {
      const selected = ans as string[]
      const val = selected[0] ?? ''
      const discover_known = val === 'discover' ? 2 : val === 'browse' ? 3 : val === 'know_exactly' ? 5 : 3
      const note = buildNote(SHOPPING_OPTS, selected, ls => `When shopping they tend to be ${joinNatural(ls)}.`)
      return {
        discover_known,
        lifestyle: {
          shopping_vibe_selections: selected,
          shopping_vibe_notes: note,
          discovery_notes: note,
        } as Partial<MasonLifestyle>,
      }
    },
  },
  {
    id: 'price_vibe',
    message: "How do you think about price when buying something for yourself?",
    kind: 'image-multi',
    images: PRICE_OPTS,
    patchFn: (ans) => {
      const selected = ans as string[]
      const val = selected[0] ?? ''
      const quality_price = val === 'budget_first' ? 1 : val === 'balanced' ? 3 : val === 'quality_over' ? 5 : val === 'splurge' ? 4 : 3
      const note = buildNote(PRICE_OPTS, selected, ls => `On price they are ${joinNatural(ls)}.`)
      return {
        quality_price,
        lifestyle: {
          price_vibe_selections: selected,
          price_vibe_notes: note,
          quality_notes: note,
        } as Partial<MasonLifestyle>,
      }
    },
  },
  {
    id: 'sizing',
    message: [
      "Quick one — let's get your sizing on file so I never have to guess.",
      "Fill in what applies. Skip anything that doesn't.",
    ],
    kind: 'sizing-steps',
    sizingFields: [
      { id: 'shirt',  label: 'Shirt / Top',  placeholder: 'XS / S / M / L / XL / XXL' },
      { id: 'waist',  label: 'Pants waist',  placeholder: 'e.g. 32' },
      { id: 'inseam', label: 'Inseam',       placeholder: 'e.g. 30' },
      { id: 'shoe',   label: 'Shoe size',    placeholder: 'e.g. 10 (US mens)' },
      { id: 'dress',  label: 'Dress / Suit', placeholder: 'e.g. 6 or 38R' },
    ],
    patchFn: (ans) => {
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
  {
    id: 'family',
    message: "Who's at home with you?",
    kind: 'image-multi',
    images: FAMILY_OPTS,
    patchFn: (ans) => {
      const selected = ans as string[]
      const note = buildNote(FAMILY_OPTS, selected, ls => `At home they live ${joinNatural(ls)}.`)
      return {
        lifestyle: {
          family_life_selections: selected,
          family_life_notes: note,
          family_notes: note,
        } as Partial<MasonLifestyle>,
      }
    },
  },
  {
    id: 'homeowner',
    message: "Do you own your home or rent?",
    kind: 'image-pick',
    images: HOMEOWNER_OPTS,
    patchFn: (ans) => {
      const val = (ans as string[])[0] ?? ans as string
      const housing: 'homeowner' | 'renter' = val === 'own' ? 'homeowner' : 'renter'
      const note = buildNote(HOMEOWNER_OPTS, [val], ls => `They are ${joinNatural(ls)}.`)
      return {
        lifestyle: {
          housing,
          homeowner_selection: val,
          homeowner_notes: note,
        } as Partial<MasonLifestyle>,
      }
    },
  },
  {
    id: 'work_env',
    message: "How do you work most days?",
    kind: 'image-multi',
    images: WORK_OPTS,
    patchFn: (ans) => {
      const selected = ans as string[]
      const val = selected[0] ?? ''
      const work_env = val === 'home_office' || val === 'kitchen_table' ? 'wfh'
        : val === 'corporate_office' ? 'office'
        : val === 'coworking' ? 'hybrid'
        : val === 'outdoors_field' ? 'outdoor'
        : 'hybrid'
      const note = buildNote(WORK_OPTS, selected, ls => `They work ${joinNatural(ls)}.`)
      return {
        lifestyle: {
          work_setup_selections: selected,
          work_setup_notes: note,
          work_env,
        } as Partial<MasonLifestyle>,
      }
    },
  },
  {
    id: 'travel',
    message: "How much do you travel?",
    kind: 'image-multi',
    images: TRAVEL_OPTS,
    patchFn: (ans) => {
      const selected = ans as string[]
      const val = selected[0] ?? ''
      const travel = val === 'rarely' ? 'rarely' : val === 'few_times_year' ? 'few_times_year' : val === 'monthly' ? 'monthly' : 'frequently'
      const note = buildNote(TRAVEL_OPTS, selected, ls => `They travel ${joinNatural(ls)}.`)
      return {
        lifestyle: {
          travel_selections: selected,
          travel_notes: note,
          travel,
        } as Partial<MasonLifestyle>,
      }
    },
  },
  {
    id: 'pets',
    message: "Any pets?",
    kind: 'image-multi',
    images: PETS_OPTS,
    patchFn: (ans) => {
      const selected = (ans as string[]).filter(s => s !== 'no_pets')
      if (!selected.length) return {}
      const pets = selected.map(s => s)
      const note = buildNote(PETS_OPTS, selected, ls => `They have ${joinNatural(ls)} at home.`)
      return {
        lifestyle: {
          pets,
          pets_selections: selected,
          pets_notes_text: note,
        } as Partial<MasonLifestyle>,
      }
    },
  },
  {
    id: 'hobbies',
    message: "What takes up real time in your life outside of work? Pick anything that applies.",
    kind: 'image-multi',
    images: HOBBIES_OPTS,
    patchFn: (ans) => {
      const selected = ans as string[]
      const hobbies = selected.map(v => HOBBIES_OPTS.find(o => o.value === v)?.note ?? v)
      const tags = selected.flatMap(v => HOBBIES_OPTS.find(o => o.value === v)?.tags ?? [])
      const note = buildNote(HOBBIES_OPTS, selected, ls => `On weekends they enjoy ${joinNatural(ls)}.`)
      return {
        style_tags: [...new Set(tags)],
        lifestyle: {
          weekend_selections: selected,
          weekend_notes: note,
          hobbies,
        } as Partial<MasonLifestyle>,
      }
    },
  },
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
  {
    id: 'gifting',
    message: "When giving a gift, what's your move?",
    kind: 'image-multi',
    images: GIFTING_OPTS,
    patchFn: (ans) => {
      const selected = ans as string[]
      const note = buildNote(GIFTING_OPTS, selected, ls => `When giving gifts they gravitate toward ${joinNatural(ls)}.`)
      return {
        lifestyle: {
          gifting_selections: selected,
          gifting_notes: note,
          gift_mood_selections: selected,
          gift_mood_notes: note,
        } as Partial<MasonLifestyle>,
      }
    },
  },
  {
    id: 'budget',
    message: "What's a typical budget when you're buying a gift for someone?",
    kind: 'image-pick',
    images: BUDGET_OPTS,
    patchFn: (ans) => {
      const val = (ans as string[])[0] ?? ans as string
      const map: Record<string, number> = { under_25: 20, '25_50': 40, '50_100': 75, '100_200': 150, '200_plus': 250 }
      const def = map[val] ?? 50
      const note = buildNote(BUDGET_OPTS, [val], ls => `Their typical gift budget is ${joinNatural(ls)}.`)
      return {
        gift_budget: { default: def, freeform: note } as MasonPrefsPatch['gift_budget'],
        lifestyle: {
          budget_selection: val,
          budget_notes: note,
        } as Partial<MasonLifestyle>,
      }
    },
  },
]

// Which step IDs get a bridge line before the NEXT step
const BRIDGE_AFTER: Record<string, keyof typeof BRIDGE_LINES> = {
  vibe_images:    'after_images',
  home_aesthetic: 'after_lifestyle',
  sizing:         'after_sizing',
  budget:         'after_gifts',
}

// ─── Message types ─────────────────────────────────────────────────────────────

type Msg =
  | { role: 'mason'; text: string; id: string }
  | { role: 'user'; text: string; id: string }
  | { role: 'typing'; id: string }

// ─── Component ─────────────────────────────────────────────────────────────────

export default function MasonOnboarding({ onComplete, onSkip }: Props) {
  const [messages, setMessages] = useState<Msg[]>([])
  const [stepIdx, setStepIdx] = useState(-1)
  const [typing, setTyping] = useState(false)
  const [selectedImages, setSelectedImages] = useState<string[]>([])
  const [textVal, setTextVal] = useState('')
  const [sizingVals, setSizingVals] = useState<Record<string, string>>({})
  const [patch, setPatch] = useState<MasonPrefsPatch>({})
  const [done, setDone] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const msgCounter = useRef(0)
  const prevStepIdx = useRef(-1)

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
      // Show labels not raw values in the user bubble
      const step_ = STEPS[stepIdx]
      if (step_.images) {
        const selectedVals = Array.isArray(answer) ? answer : [answer]
        const labels = selectedVals.map(v => step_.images!.find(o => o.value === v)?.label ?? v)
        userSays(labels.join(', '))
      } else {
        userSays(answerText)
      }
    }

    const newPatch = step.patchFn(answer)
    const nextPatch = mergedPatch(patch, newPatch)
    setPatch(nextPatch)

    const bridgeKey = BRIDGE_AFTER[step.id]
    if (bridgeKey) {
      await masonSays(pick(BRIDGE_LINES[bridgeKey]), 400)
    }

    const next = stepIdx + 1
    if (next >= STEPS.length) {
      // Compose profile_text from all lifestyle notes
      const ls = (nextPatch.lifestyle ?? {}) as Record<string, string>
      const noteKeys = [
        'style_notes', 'vibe_notes', 'home_aesthetic_notes',
        'shopping_vibe_notes', 'price_vibe_notes',
        'family_notes', 'homeowner_notes', 'work_setup_notes',
        'travel_notes', 'pets_notes_text', 'weekend_notes',
        'gifting_notes', 'budget_notes',
      ]
      const profile_text = noteKeys.map(k => ls[k] ?? '').filter(Boolean).join(' ')
      const finalPatch = mergedPatch(nextPatch, { lifestyle: { profile_text } as Partial<MasonLifestyle> })

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
    } else {
      setStepIdx(next)
    }
  }

  function handleImageToggle(value: string) {
    setSelectedImages(prev =>
      prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]
    )
  }

  function handleImageConfirm() {
    if (!selectedImages.length) return
    advance(selectedImages)
  }

  function handleImagePick(value: string) {
    advance([value])
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
      <div className={styles.header}>
        <img className={styles.avatar} src="/mason/mason-1.png" alt="Mason" />
        <div className={styles.headerText}>
          <div className={styles.headerName}>Mason</div>
          <div className={styles.headerSub}>Your personal shopper</div>
        </div>
        <button className={styles.skipAll} onClick={onSkip}>Skip for now</button>
      </div>

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
          return <div key={msg.id} className={styles.userBubble}>{msg.text}</div>
        })}
        <div ref={bottomRef} />
      </div>

      {isInteractive && (
        <div className={styles.interactionArea}>
          {currentStep.kind === 'image-multi' && (
            <>
              <div className={styles.imageGrid}>
                {currentStep.images!.map(img => (
                  <div key={img.value} className={styles.imageOptionWrap}>
                    <button
                      className={`${styles.imageOption} ${selectedImages.includes(img.value) ? styles.selected : ''}`}
                      onClick={() => handleImageToggle(img.value)}
                    >
                      <img src={img.url} alt={img.label} />
                      {selectedImages.includes(img.value) && <span className={styles.imageCheck}>✓</span>}
                    </button>
                    <span className={styles.imageLabel}>{img.label}</span>
                  </div>
                ))}
              </div>
              {selectedImages.length > 0 && (
                <div className={styles.confirmRow}>
                  <button className={styles.confirmBtn} onClick={handleImageConfirm}>
                    {currentStep.id === 'vibe_images' ? 'These are me →' : "That's me →"}
                  </button>
                </div>
              )}
            </>
          )}

          {currentStep.kind === 'image-pick' && (
            <div className={styles.imageGrid}>
              {currentStep.images!.map(img => (
                <div key={img.value} className={styles.imageOptionWrap}>
                  <button
                    className={styles.imageOption}
                    onClick={() => handleImagePick(img.value)}
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
                <button className={styles.sendBtn} onClick={handleTextSend}>↑</button>
              </div>
              <div className={styles.chipRow}>
                <button className={styles.chip} onClick={() => advance('(skipped)')}>Skip</button>
              </div>
            </>
          )}

          {currentStep.kind === 'sizing-steps' && (
            <>
              <div className={styles.sizingGrid}>
                {currentStep.sizingFields!.map(s => (
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
                <button className={styles.confirmBtn} onClick={handleSizingConfirm}>Save sizes →</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
