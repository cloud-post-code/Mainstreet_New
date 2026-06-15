import { ReactNode } from 'react'
import { MasonLifestyle, MasonPrefs, MasonPrefsPatch } from '../api'
import ChipInput from './ChipInput'
import styles from './PrefsForm.module.css'

interface PrefsFormProps {
  prefs: MasonPrefs
  onPatch: (patch: MasonPrefsPatch) => void
}

// ─── Image-pick component ─────────────────────────────────────────────────────

interface ImageOption {
  value: string
  label: string
  img: string
  // tags to extract into various pref fields when selected
  tags?: string[]
  style_tags?: string[]
  likes?: string[]
}

function ImagePick({
  options,
  value,
  onChange,
  multi,
  cols,
}: {
  options: ImageOption[]
  value: string | string[]
  onChange: (v: string | string[]) => void
  multi?: boolean
  cols?: 2 | 3 | 4
}) {
  const selected = Array.isArray(value) ? value : value ? [value] : []

  function toggle(v: string) {
    if (multi) {
      const next = selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]
      onChange(next)
    } else {
      onChange(selected[0] === v ? '' : v)
    }
  }

  return (
    <div className={styles.imagePick} data-cols={cols ?? 3}>
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          className={`${styles.imagePickBtn} ${selected.includes(opt.value) ? styles.imagePickBtnOn : ''}`}
          onClick={() => toggle(opt.value)}
        >
          <img src={opt.img} alt={opt.label} className={styles.imagePickImg} />
          <span className={styles.imagePickLabel}>{opt.label}</span>
          {selected.includes(opt.value) && <span className={styles.imagePickCheck}>✓</span>}
        </button>
      ))}
    </div>
  )
}

// ─── Question definitions ─────────────────────────────────────────────────────

const STYLE_OPTIONS: ImageOption[] = [
  { value: 'minimalist', label: 'Clean & minimal', img: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&q=60&fit=crop', style_tags: ['minimalist', 'clean', 'simple'] },
  { value: 'classic', label: 'Timeless classic', img: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&q=60&fit=crop', style_tags: ['classic', 'refined', 'tailored'] },
  { value: 'streetwear', label: 'Street cool', img: 'https://images.unsplash.com/photo-1523398002811-999ca8dec234?w=400&q=60&fit=crop', style_tags: ['streetwear', 'urban', 'edgy'] },
  { value: 'bohemian', label: 'Free spirit', img: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=400&q=60&fit=crop', style_tags: ['bohemian', 'eclectic', 'earthy'] },
  { value: 'preppy', label: 'Polished preppy', img: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=400&q=60&fit=crop', style_tags: ['preppy', 'classic', 'put-together'] },
  { value: 'outdoorsy', label: 'Outdoorsy', img: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=400&q=60&fit=crop', style_tags: ['outdoorsy', 'functional', 'rugged'] },
  { value: 'luxury', label: 'Quiet luxury', img: 'https://images.unsplash.com/photo-1445205170230-053b83016050?w=400&q=60&fit=crop', style_tags: ['luxury', 'elevated', 'understated'] },
  { value: 'artsy', label: 'Creative & artsy', img: 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=400&q=60&fit=crop', style_tags: ['creative', 'artsy', 'expressive'] },
  { value: 'athletic', label: 'Athletic / Sport', img: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=400&q=60&fit=crop', style_tags: ['athletic', 'sporty', 'performance'] },
]

const COLOR_OPTIONS: ImageOption[] = [
  { value: 'neutrals', label: 'Whites & creams', img: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=400&q=60&fit=crop' },
  { value: 'earth', label: 'Earth & terracotta', img: 'https://images.unsplash.com/photo-1600080972464-8e5f35f63d08?w=400&q=60&fit=crop' },
  { value: 'bold', label: 'Bold & saturated', img: 'https://images.unsplash.com/photo-1582201942988-13e60e4556ee?w=400&q=60&fit=crop' },
  { value: 'pastels', label: 'Soft pastels', img: 'https://images.unsplash.com/photo-1520981825232-ece5fae45120?w=400&q=60&fit=crop' },
  { value: 'navy_forest', label: 'Navy & forest', img: 'https://images.unsplash.com/photo-1509631179647-0177331693ae?w=400&q=60&fit=crop' },
  { value: 'monochrome', label: 'Black & white', img: 'https://images.unsplash.com/photo-1594938298603-c8148c4b4cce?w=400&q=60&fit=crop' },
]

const DREAM_HOME_OPTIONS: ImageOption[] = [
  { value: 'modern_penthouse', label: 'Modern penthouse', img: 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=400&q=60&fit=crop', style_tags: ['modern', 'urban', 'sleek'], tags: ['city dweller', 'modern design'] },
  { value: 'coastal_cottage', label: 'Coastal cottage', img: 'https://images.unsplash.com/photo-1499793983690-e29da59ef1c2?w=400&q=60&fit=crop', style_tags: ['coastal', 'relaxed', 'natural'], tags: ['beach lifestyle', 'laid-back'] },
  { value: 'mountain_cabin', label: 'Mountain cabin', img: 'https://images.unsplash.com/photo-1510798831971-661eb04b3739?w=400&q=60&fit=crop', style_tags: ['rustic', 'cozy', 'natural'], tags: ['outdoors', 'nature lover'] },
  { value: 'tuscan_villa', label: 'Tuscan villa', img: 'https://images.unsplash.com/photo-1523531294919-4bcd7c65e216?w=400&q=60&fit=crop', style_tags: ['classic', 'european', 'refined'], tags: ['old world', 'classic elegance'] },
  { value: 'nyc_loft', label: 'NYC loft', img: 'https://images.unsplash.com/photo-1502672023488-70e25813eb80?w=400&q=60&fit=crop', style_tags: ['industrial', 'urban', 'edgy'], tags: ['urban creative', 'art world'] },
  { value: 'desert_compound', label: 'Desert compound', img: 'https://images.unsplash.com/photo-1573055418049-c8e0b7e3a7a6?w=400&q=60&fit=crop', style_tags: ['minimal', 'architectural', 'earthy'], tags: ['design-forward', 'solitude'] },
]

const DREAM_SCENE_OPTIONS: ImageOption[] = [
  { value: 'waterfall', label: 'Jungle waterfall', img: 'https://images.unsplash.com/photo-1455218873509-8097305ee378?w=400&q=60&fit=crop', tags: ['adventure', 'nature', 'explorer'] },
  { value: 'city_rooftop', label: 'City rooftop at dusk', img: 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=400&q=60&fit=crop', tags: ['urban', 'social', 'nightlife'] },
  { value: 'mountain_peak', label: 'Mountain summit', img: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=400&q=60&fit=crop', tags: ['outdoors', 'achiever', 'adventurous'] },
  { value: 'beach_sunset', label: 'Beach at sunset', img: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=400&q=60&fit=crop', tags: ['relaxed', 'coastal', 'laid-back'] },
  { value: 'cozy_cabin', label: 'Cozy cabin evening', img: 'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=400&q=60&fit=crop', tags: ['homebody', 'cozy', 'intimate'] },
  { value: 'french_market', label: 'French countryside market', img: 'https://images.unsplash.com/photo-1533900298318-6b8da08a523e?w=400&q=60&fit=crop', tags: ['foodie', 'artisan', 'European taste'] },
  { value: 'gallery_opening', label: 'Gallery opening night', img: 'https://images.unsplash.com/photo-1531058020387-3be344556be6?w=400&q=60&fit=crop', tags: ['creative', 'art lover', 'cultured'] },
  { value: 'road_trip', label: 'Open road road trip', img: 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=400&q=60&fit=crop', tags: ['freedom', 'wanderlust', 'spontaneous'] },
]

const WEEKEND_OPTIONS: ImageOption[] = [
  { value: 'hiking', label: 'Hiking or camping', img: 'https://images.unsplash.com/photo-1551632811-561732d1e306?w=400&q=60&fit=crop', tags: ['outdoorsy', 'active'] },
  { value: 'farmers_market', label: 'Farmers market', img: 'https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=400&q=60&fit=crop', tags: ['foodie', 'local', 'community'] },
  { value: 'hosting', label: 'Hosting dinner', img: 'https://images.unsplash.com/photo-1529543544282-ea669407fca3?w=400&q=60&fit=crop', tags: ['host', 'social', 'entertainer'] },
  { value: 'gallery', label: 'Gallery or museum', img: 'https://images.unsplash.com/photo-1531058020387-3be344556be6?w=400&q=60&fit=crop', tags: ['art lover', 'cultured'] },
  { value: 'gym_wellness', label: 'Gym or wellness', img: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=400&q=60&fit=crop', tags: ['health-focused', 'discipline'] },
  { value: 'live_music', label: 'Live music or festival', img: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=400&q=60&fit=crop', tags: ['music lover', 'social', 'experience seeker'] },
  { value: 'thrift_antiques', label: 'Thrifting or antiques', img: 'https://images.unsplash.com/photo-1558171813-7c1df82c0b27?w=400&q=60&fit=crop', tags: ['vintage', 'treasure hunter', 'eclectic'] },
  { value: 'cooking', label: 'Cooking or baking', img: 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=400&q=60&fit=crop', tags: ['homebody', 'foodie', 'creative'] },
  { value: 'road_trip_wknd', label: 'Spontaneous road trip', img: 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=400&q=60&fit=crop', tags: ['adventurous', 'spontaneous'] },
  { value: 'reading_cafe', label: 'Coffee shop / reading', img: 'https://images.unsplash.com/photo-1442512595331-e89e73853f31?w=400&q=60&fit=crop', tags: ['introverted', 'intellectual'] },
  { value: 'beach_park', label: 'Beach or park', img: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=400&q=60&fit=crop', tags: ['outdoors', 'relaxed'] },
  { value: 'shopping', label: 'Shopping & exploring', img: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=400&q=60&fit=crop', tags: ['shopper', 'trend-aware', 'social'] },
]

const DREAM_CAR_OPTIONS: ImageOption[] = [
  { value: 'vintage_muscle', label: 'Vintage muscle car', img: 'https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=400&q=60&fit=crop', style_tags: ['classic', 'bold'], tags: ['nostalgic', 'collector mindset'] },
  { value: 'luxury_suv', label: 'Luxury SUV', img: 'https://images.unsplash.com/photo-1519641471654-76ce0107ad1b?w=400&q=60&fit=crop', style_tags: ['premium', 'practical'], tags: ['family-oriented', 'quality-first'] },
  { value: 'electric_sports', label: 'Electric sports car', img: 'https://images.unsplash.com/photo-1560958089-b8a1929cea89?w=400&q=60&fit=crop', style_tags: ['modern', 'innovative'], tags: ['tech-forward', 'performance'] },
  { value: 'classic_convertible', label: 'Classic convertible', img: 'https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?w=400&q=60&fit=crop', style_tags: ['timeless', 'romantic'], tags: ['lifestyle-driven', 'classic taste'] },
  { value: 'offroad_truck', label: 'Off-road truck', img: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&q=60&fit=crop', style_tags: ['rugged', 'functional'], tags: ['outdoors', 'utility-first'] },
  { value: 'sleek_sedan', label: 'Sleek European sedan', img: 'https://images.unsplash.com/photo-1542362567-b07e54358753?w=400&q=60&fit=crop', style_tags: ['refined', 'sophisticated'], tags: ['understated luxury', 'detail-oriented'] },
]

const GIFT_MOOD_OPTIONS: ImageOption[] = [
  { value: 'sentimental', label: 'Sentimental keepsake', img: 'https://images.unsplash.com/photo-1512909006721-3d6018887383?w=400&q=60&fit=crop', tags: ['sentimental gifter', 'personal touch'] },
  { value: 'luxury_splurge', label: 'Luxury splurge', img: 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=400&q=60&fit=crop', tags: ['luxury gifter', 'quality over quantity'] },
  { value: 'useful', label: 'Useful & practical', img: 'https://images.unsplash.com/photo-1491553895911-0055eca6402d?w=400&q=60&fit=crop', tags: ['practical gifter', 'thoughtful utility'] },
  { value: 'funny', label: 'Funny & playful', img: 'https://images.unsplash.com/photo-1513151233558-d860c5398176?w=400&q=60&fit=crop', tags: ['humorous gifter', 'fun-first'] },
  { value: 'experience', label: 'An experience', img: 'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=400&q=60&fit=crop', tags: ['experience gifter', 'memories over things'] },
  { value: 'artisan', label: 'Local or artisan find', img: 'https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=400&q=60&fit=crop', tags: ['artisan gifter', 'small batch', 'local-first'] },
]

const AREA_OPTIONS: ImageOption[] = [
  { value: 'urban', label: 'City life', img: 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=400&q=60&fit=crop' },
  { value: 'suburban', label: 'Suburbs', img: 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=400&q=60&fit=crop' },
  { value: 'rural', label: 'Small town / Rural', img: 'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=400&q=60&fit=crop' },
]

const MATERIAL_OPTIONS: ImageOption[] = [
  { value: 'cashmere_wool', label: 'Cashmere & wool', img: 'https://images.unsplash.com/photo-1580310614729-ccd69652491d?w=400&q=60&fit=crop', style_tags: ['cozy', 'premium', 'soft'] },
  { value: 'leather', label: 'Leather', img: 'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=400&q=60&fit=crop', style_tags: ['leather', 'durable', 'classic'] },
  { value: 'linen_cotton', label: 'Linen & cotton', img: 'https://images.unsplash.com/photo-1558769132-cb1aea458c5e?w=400&q=60&fit=crop', style_tags: ['breathable', 'natural', 'relaxed'] },
  { value: 'denim', label: 'Denim', img: 'https://images.unsplash.com/photo-1542272604-787c3835535d?w=400&q=60&fit=crop', style_tags: ['denim', 'casual', 'americana'] },
  { value: 'silk_satin', label: 'Silk & satin', img: 'https://images.unsplash.com/photo-1519415510236-718bdfcd89c8?w=400&q=60&fit=crop', style_tags: ['luxe', 'silk', 'refined'] },
  { value: 'technical', label: 'Technical / Performance', img: 'https://images.unsplash.com/photo-1539185441755-769473a23570?w=400&q=60&fit=crop', style_tags: ['technical', 'performance', 'functional'] },
  { value: 'canvas_canvas', label: 'Canvas & waxed cotton', img: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=400&q=60&fit=crop', style_tags: ['rugged', 'workwear', 'utilitarian'] },
  { value: 'velvet_brocade', label: 'Velvet & brocade', img: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&q=60&fit=crop', style_tags: ['maximalist', 'rich', 'bold'] },
  { value: 'wood_ceramic', label: 'Wood & ceramic', img: 'https://images.unsplash.com/photo-1565193566173-7a0ee3dbe261?w=400&q=60&fit=crop', style_tags: ['artisan', 'handmade', 'natural'] },
]

const WORK_SETUP_OPTIONS: ImageOption[] = [
  { value: 'home_office', label: 'Dedicated home office', img: 'https://images.unsplash.com/photo-1593642632559-0c6d3fc62b89?w=400&q=60&fit=crop', tags: ['remote', 'home worker', 'desk setup'] },
  { value: 'kitchen_table', label: 'Kitchen table WFH', img: 'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=400&q=60&fit=crop', tags: ['flexible', 'casual WFH'] },
  { value: 'corporate_office', label: 'Corporate office', img: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=400&q=60&fit=crop', tags: ['office worker', 'professional environment'] },
  { value: 'coworking', label: 'Coworking / café', img: 'https://images.unsplash.com/photo-1521791136064-7986c2920216?w=400&q=60&fit=crop', tags: ['nomadic worker', 'flexible schedule'] },
  { value: 'creative_studio', label: 'Creative studio', img: 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=400&q=60&fit=crop', tags: ['creative professional', 'maker', 'studio space'] },
  { value: 'outdoors_field', label: 'Outdoors / On-site', img: 'https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?w=400&q=60&fit=crop', tags: ['field work', 'active job', 'outdoors'] },
  { value: 'retail_hospitality', label: 'Retail or hospitality', img: 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=400&q=60&fit=crop', tags: ['customer-facing', 'on your feet'] },
  { value: 'travel_constant', label: 'Always traveling', img: 'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=400&q=60&fit=crop', tags: ['frequent traveler', 'business travel', 'on the road'] },
]

const FAMILY_LIFE_OPTIONS: ImageOption[] = [
  { value: 'young_kids', label: 'Young kids at home', img: 'https://images.unsplash.com/photo-1536640712-4d4c36ff0e4e?w=400&q=60&fit=crop', tags: ['parent', 'young children', 'family-first'] },
  { value: 'older_kids', label: 'Older kids / Teens', img: 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=400&q=60&fit=crop', tags: ['parent', 'teenagers', 'active family'] },
  { value: 'partner_no_kids', label: 'Partner, no kids', img: 'https://images.unsplash.com/photo-1522673607200-164d1b6ce486?w=400&q=60&fit=crop', tags: ['couple', 'DINK', 'two-income'] },
  { value: 'solo_living', label: 'Flying solo', img: 'https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=400&q=60&fit=crop', tags: ['single', 'independent', 'solo lifestyle'] },
  { value: 'multigenerational', label: 'Multigenerational home', img: 'https://images.unsplash.com/photo-1581579438747-1dc8d17bbce4?w=400&q=60&fit=crop', tags: ['multigenerational', 'extended family'] },
  { value: 'empty_nester', label: 'Empty nester', img: 'https://images.unsplash.com/photo-1471560090527-d1af5e4e6eb6?w=400&q=60&fit=crop', tags: ['empty nester', 'rediscovering freedom'] },
  { value: 'roommates', label: 'Living with roommates', img: 'https://images.unsplash.com/photo-1529543544282-ea669407fca3?w=400&q=60&fit=crop', tags: ['shared living', 'communal', 'young adult'] },
  { value: 'newborn', label: 'Newborn or expecting', img: 'https://images.unsplash.com/photo-1492725764893-90b379c2b6e7?w=400&q=60&fit=crop', tags: ['new parent', 'expecting', 'baby gear'] },
]

// ─── Extraction: turn image picks into structured notes ───────────────────────

function buildVibeNotes(lifestyle: MasonLifestyle): string {
  const parts: string[] = []
  if (lifestyle.dream_home) parts.push(`Dream home: ${lifestyle.dream_home.replace(/_/g, ' ')}`)
  if (lifestyle.dream_scene) parts.push(`Dream scene: ${lifestyle.dream_scene.replace(/_/g, ' ')}`)
  if (lifestyle.dream_car) parts.push(`Dream car: ${lifestyle.dream_car.replace(/_/g, ' ')}`)
  if (lifestyle.gift_mood) parts.push(`Gift style: ${lifestyle.gift_mood.replace(/_/g, ' ')}`)
  if ((lifestyle.weekend_vibes ?? []).length) parts.push(`Weekend: ${lifestyle.weekend_vibes!.join(', ')}`)
  if ((lifestyle.color_palette ?? []).length) parts.push(`Colors: ${lifestyle.color_palette!.join(', ')}`)
  if ((lifestyle.materials ?? []).length) parts.push(`Materials: ${lifestyle.materials!.join(', ')}`)
  if ((lifestyle.work_setup ?? []).length) parts.push(`Work: ${lifestyle.work_setup!.join(', ')}`)
  if ((lifestyle.family_life ?? []).length) parts.push(`Family: ${lifestyle.family_life!.join(', ')}`)
  return parts.join(' · ')
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PrefsForm({ prefs, onPatch }: PrefsFormProps) {
  const lifestyle = prefs.lifestyle ?? {}

  function patchLifestyle(patch: Partial<MasonLifestyle>) {
    onPatch({ lifestyle: patch as Partial<MasonLifestyle> })
  }

  // Style vibes (multi) — keep image-selected values separate from free-typed ones
  const styleSelected = (prefs.style_tags ?? []).filter(t =>
    STYLE_OPTIONS.some(o => o.value === t)
  )
  const styleOther = (prefs.style_tags ?? []).filter(t =>
    !STYLE_OPTIONS.some(o => o.value === t)
  )

  function onStyleChange(next: string | string[]) {
    const picked = next as string[]
    // also pull in any style_tags from those options
    const bonus = picked.flatMap(v => STYLE_OPTIONS.find(o => o.value === v)?.style_tags ?? [])
    const merged = [...new Set([...styleOther, ...picked, ...bonus])]
    onPatch({ style_tags: merged })
  }

  function onDreamHomeChange(next: string | string[]) {
    const picked = next as string[]
    const bonusTags = picked.flatMap(v => DREAM_HOME_OPTIONS.find(o => o.value === v)?.style_tags ?? [])
    const existing = (prefs.style_tags ?? []).filter(t => !DREAM_HOME_OPTIONS.flatMap(o => o.style_tags ?? []).includes(t))
    const newVibe = buildVibeNotes({ ...lifestyle, dream_home: picked[0] })
    onPatch({
      style_tags: [...new Set([...existing, ...bonusTags])],
      lifestyle: { dream_home: picked[0] || undefined, vibe_notes: newVibe } as Partial<MasonLifestyle>,
    })
  }

  function onDreamSceneChange(next: string | string[]) {
    const picked = next as string[]
    const newVibe = buildVibeNotes({ ...lifestyle, dream_scene: picked[0] })
    patchLifestyle({ dream_scene: picked[0] || undefined, vibe_notes: newVibe })
  }

  function onDreamCarChange(next: string | string[]) {
    const picked = next as string[]
    const bonusTags = picked.flatMap(v => DREAM_CAR_OPTIONS.find(o => o.value === v)?.style_tags ?? [])
    const existing = (prefs.style_tags ?? []).filter(t => !DREAM_CAR_OPTIONS.flatMap(o => o.style_tags ?? []).includes(t))
    const newVibe = buildVibeNotes({ ...lifestyle, dream_car: picked[0] })
    onPatch({
      style_tags: [...new Set([...existing, ...bonusTags])],
      lifestyle: { dream_car: picked[0] || undefined, vibe_notes: newVibe } as Partial<MasonLifestyle>,
    })
  }

  function onGiftMoodChange(next: string | string[]) {
    const picked = next as string[]
    const newVibe = buildVibeNotes({ ...lifestyle, gift_mood: picked[0] })
    patchLifestyle({ gift_mood: picked[0] || undefined, vibe_notes: newVibe })
  }

  function onWeekendChange(next: string | string[]) {
    const picked = next as string[]
    const newVibe = buildVibeNotes({ ...lifestyle, weekend_vibes: picked })
    patchLifestyle({ weekend_vibes: picked, vibe_notes: newVibe })
  }

  return (
    <div className={styles.form}>
      <p className={styles.helpText}>
        Pick images that feel like you — Mason reads between the lines to personalize every recommendation.
      </p>

      {/* ── 1. Style aesthetic ── */}
      <Section title="What's your style energy?" defaultOpen>
        <p className={styles.sectionHint}>Pick all that fit — you can wear more than one vibe.</p>
        <ImagePick options={STYLE_OPTIONS} value={styleSelected} onChange={onStyleChange} multi cols={3} />
      </Section>

      {/* ── 2. Color world ── */}
      <Section title="What's your color world?">
        <p className={styles.sectionHint}>Which palette shows up most in your closet or home?</p>
        <ImagePick
          options={COLOR_OPTIONS}
          value={lifestyle.color_palette ?? []}
          onChange={next => {
            const newVibe = buildVibeNotes({ ...lifestyle, color_palette: next as string[] })
            patchLifestyle({ color_palette: next as string[], vibe_notes: newVibe })
          }}
          multi
          cols={3}
        />
      </Section>

      {/* ── 3. Dream home ── */}
      <Section title="What's the vibe of your dream home?">
        <p className={styles.sectionHint}>Pick all that speak to you.</p>
        <ImagePick options={DREAM_HOME_OPTIONS} value={lifestyle.dream_home ? [lifestyle.dream_home] : []} onChange={onDreamHomeChange} multi cols={3} />
      </Section>

      {/* ── 4. Dream scene ── */}
      <Section title="Which scene would you most want to be in right now?">
        <p className={styles.sectionHint}>Pick as many as you want.</p>
        <ImagePick options={DREAM_SCENE_OPTIONS} value={lifestyle.dream_scene ? [lifestyle.dream_scene] : []} onChange={onDreamSceneChange} multi cols={4} />
      </Section>

      {/* ── 5. Weekend energy ── */}
      <Section title="How do you spend your free time?">
        <p className={styles.sectionHint}>Pick everything that sounds like a good weekend.</p>
        <ImagePick options={WEEKEND_OPTIONS} value={lifestyle.weekend_vibes ?? []} onChange={onWeekendChange} multi cols={3} />
      </Section>

      {/* ── 6. Dream car ── */}
      <Section title="What's your dream car?">
        <p className={styles.sectionHint}>Says a lot about someone. Pick all that feel right.</p>
        <ImagePick options={DREAM_CAR_OPTIONS} value={lifestyle.dream_car ? [lifestyle.dream_car] : []} onChange={onDreamCarChange} multi cols={3} />
      </Section>

      {/* ── 7. Gift mood ── */}
      <Section title="When giving a gift, what's the move?">
        <p className={styles.sectionHint}>Pick everything that sounds like you.</p>
        <ImagePick options={GIFT_MOOD_OPTIONS} value={lifestyle.gift_mood ? [lifestyle.gift_mood] : []} onChange={onGiftMoodChange} multi cols={3} />
      </Section>

      {/* ── 8. Where you are ── */}
      <Section title="Where do you live?">
        <ImagePick
          options={AREA_OPTIONS}
          value={lifestyle.area ? [lifestyle.area] : []}
          onChange={next => {
            const picked = next as string[]
            patchLifestyle({ area: picked[0] as MasonLifestyle['area'] || undefined })
          }}
          multi
          cols={3}
        />
      </Section>

      {/* ── 9. Materials ── */}
      <Section title="What materials are you drawn to?">
        <p className={styles.sectionHint}>Pick everything you love the feel of — in clothing, accessories, or home goods.</p>
        <ImagePick
          options={MATERIAL_OPTIONS}
          value={lifestyle.materials ?? []}
          onChange={next => {
            const picked = next as string[]
            const bonusTags = picked.flatMap(v => MATERIAL_OPTIONS.find(o => o.value === v)?.style_tags ?? [])
            const existingNonMaterial = (prefs.style_tags ?? []).filter(t => !MATERIAL_OPTIONS.flatMap(o => o.style_tags ?? []).includes(t))
            const newVibe = buildVibeNotes({ ...lifestyle, materials: picked })
            onPatch({
              style_tags: [...new Set([...existingNonMaterial, ...bonusTags])],
              lifestyle: { materials: picked, vibe_notes: newVibe } as Partial<MasonLifestyle>,
            })
          }}
          multi
          cols={3}
        />
      </Section>

      {/* ── 10. Work setup ── */}
      <Section title="What does your work setup look like?">
        <p className={styles.sectionHint}>Pick all that apply — some people have more than one.</p>
        <ImagePick
          options={WORK_SETUP_OPTIONS}
          value={lifestyle.work_setup ?? []}
          onChange={next => {
            const picked = next as string[]
            const newVibe = buildVibeNotes({ ...lifestyle, work_setup: picked })
            patchLifestyle({ work_setup: picked, vibe_notes: newVibe })
          }}
          multi
          cols={4}
        />
      </Section>

      {/* ── 11. Family life ── */}
      <Section title="What does your home life look like?">
        <p className={styles.sectionHint}>Pick everything that fits — life is layered.</p>
        <ImagePick
          options={FAMILY_LIFE_OPTIONS}
          value={lifestyle.family_life ?? []}
          onChange={next => {
            const picked = next as string[]
            const newVibe = buildVibeNotes({ ...lifestyle, family_life: picked })
            patchLifestyle({ family_life: picked, vibe_notes: newVibe })
          }}
          multi
          cols={4}
        />
      </Section>

      {/* ── Pets ── */}
      <Section title="Pets">
        <Field label="Any pets?">
          <ChipInput
            values={lifestyle.pets ?? []}
            onChange={next => patchLifestyle({ pets: next })}
            placeholder="Add a pet (e.g. dog, cat)…"
          />
        </Field>
        <Field label="Details">
          <input
            type="text"
            value={lifestyle.pets_notes ?? ''}
            onChange={e => patchLifestyle({ pets_notes: e.target.value })}
            placeholder="Breed, age, or other details…"
          />
        </Field>
      </Section>

      {/* ── Brands & Dislikes ── */}
      <Section title="Brands & things you love">
        <ChipInput
          values={prefs.likes ?? []}
          onChange={next => onPatch({ likes: next })}
          placeholder="Add a brand, material, or style…"
        />
        <Field label="Notes">
          <textarea
            className={styles.textarea}
            value={lifestyle.likes_notes ?? ''}
            onChange={e => patchLifestyle({ likes_notes: e.target.value })}
            placeholder="Anything else you love — notes from past conversations, past purchases…"
            rows={2}
          />
        </Field>
      </Section>

      <Section title="Things to avoid">
        <ChipInput
          values={prefs.dislikes ?? []}
          onChange={next => onPatch({ dislikes: next })}
          placeholder="Add something you never want to see…"
        />
        <Field label="Notes">
          <textarea
            className={styles.textarea}
            value={lifestyle.dislikes_notes ?? ''}
            onChange={e => patchLifestyle({ dislikes_notes: e.target.value })}
            placeholder="Anything else to steer clear of — notes from past conversations."
            rows={2}
          />
        </Field>
      </Section>

      {/* ── Lifestyle notes ── */}
      <Section title="Lifestyle notes">
        <p className={styles.sectionHint}>Free-form notes about your life, routines, or context — Mason uses this alongside your image picks.</p>
        <Field label="Anything else Mason should know">
          <textarea
            className={styles.textarea}
            value={lifestyle.freeform_notes ?? ''}
            onChange={e => patchLifestyle({ freeform_notes: e.target.value })}
            placeholder="e.g. I travel for work a few times a year, host dinner parties, have a toddler…"
            rows={3}
          />
        </Field>
      </Section>

      {/* ── Personal Budget ── */}
      <Section title="Personal budget">
        <p className={styles.sectionHint}>How much do you typically spend per item on yourself?</p>
        <div className={styles.row}>
          <Field label="Typical per-item budget ($)">
            <input
              type="number"
              min={0}
              value={prefs.personal_budget ?? ''}
              onChange={e =>
                onPatch({ personal_budget: e.target.value === '' ? null : Number(e.target.value) })
              }
              placeholder="e.g. 100"
            />
          </Field>
        </div>
        <Field label="Budget notes">
          <textarea
            className={styles.textarea}
            value={lifestyle.quality_notes ?? ''}
            onChange={e => patchLifestyle({ quality_notes: e.target.value })}
            placeholder="Splurge categories, value rules, when you spend more…"
            rows={2}
          />
        </Field>
      </Section>

      {/* ── Gift Budget ── */}
      <Section title="Gift budget">
        <p className={styles.sectionHint}>How much do you typically spend on gifts per occasion?</p>
        <div className={styles.row}>
          <Field label="Default ($)">
            <input
              type="number"
              min={0}
              value={prefs.gift_budget?.default ?? ''}
              onChange={e =>
                onPatch({ gift_budget: { default: e.target.value === '' ? undefined : Number(e.target.value) } })
              }
              placeholder="e.g. 50"
            />
          </Field>
          <Field label="Birthday ($)">
            <input
              type="number"
              min={0}
              value={prefs.gift_budget?.birthday ?? ''}
              onChange={e =>
                onPatch({ gift_budget: { birthday: e.target.value === '' ? undefined : Number(e.target.value) } })
              }
              placeholder="e.g. 75"
            />
          </Field>
        </div>
        <div className={styles.row}>
          <Field label="Holiday ($)">
            <input
              type="number"
              min={0}
              value={prefs.gift_budget?.holiday ?? ''}
              onChange={e =>
                onPatch({ gift_budget: { holiday: e.target.value === '' ? undefined : Number(e.target.value) } })
              }
              placeholder="e.g. 100"
            />
          </Field>
          <Field label="Anniversary ($)">
            <input
              type="number"
              min={0}
              value={prefs.gift_budget?.anniversary ?? ''}
              onChange={e =>
                onPatch({ gift_budget: { anniversary: e.target.value === '' ? undefined : Number(e.target.value) } })
              }
              placeholder="e.g. 150"
            />
          </Field>
        </div>
        <Field label="Gift budget notes">
          <textarea
            className={styles.textarea}
            value={prefs.gift_budget?.freeform ?? ''}
            onChange={e => onPatch({ gift_budget: { freeform: e.target.value } })}
            placeholder="Who you shop for, occasions you prioritize, gift-giving style…"
            rows={2}
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
    </label>
  )
}
