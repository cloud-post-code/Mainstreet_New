import { ReactNode } from 'react'
import { MasonLifestyle, MasonPrefs, MasonPrefsPatch } from '../api'
import ChipInput from './ChipInput'
import styles from './PrefsForm.module.css'

interface PrefsFormProps {
  prefs: MasonPrefs
  onPatch: (patch: MasonPrefsPatch) => void
}

// ─── Image-pick UI component ──────────────────────────────────────────────────

interface ImageOption {
  value: string
  label: string
  img: string
  note: string           // human sentence fragment written to _notes when selected
  style_tags?: string[]  // bonus style tags to inject
}

function ImagePick({
  options,
  selected,
  onToggle,
  cols = 3,
}: {
  options: ImageOption[]
  selected: string[]
  onToggle: (value: string) => void
  cols?: 2 | 3 | 4
}) {
  return (
    <div className={styles.imagePick} data-cols={cols}>
      {options.map(opt => {
        const on = selected.includes(opt.value)
        return (
          <button
            key={opt.value}
            type="button"
            className={`${styles.imagePickBtn} ${on ? styles.imagePickBtnOn : ''}`}
            onClick={() => onToggle(opt.value)}
          >
            <img src={opt.img} alt={opt.label} className={styles.imagePickImg} />
            <span className={styles.imagePickLabel}>{opt.label}</span>
            {on && <span className={styles.imagePickCheck}>✓</span>}
          </button>
        )
      })}
    </div>
  )
}

// ─── Note builder ─────────────────────────────────────────────────────────────
// Takes the selected option values and composes a natural-language sentence.

function buildNotes(options: ImageOption[], selected: string[], template: (labels: string[]) => string): string {
  const labels = selected.map(v => options.find(o => o.value === v)?.note ?? v).filter(Boolean)
  if (!labels.length) return ''
  return template(labels)
}

// ─── Option sets ──────────────────────────────────────────────────────────────

const STYLE_OPTIONS: ImageOption[] = [
  { value: 'minimalist',  label: 'Clean & minimal',    img: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&q=60&fit=crop', note: 'clean and minimal',       style_tags: ['minimalist', 'clean', 'simple'] },
  { value: 'classic',     label: 'Timeless classic',   img: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&q=60&fit=crop', note: 'timeless and classic',   style_tags: ['classic', 'refined', 'tailored'] },
  { value: 'streetwear',  label: 'Street cool',        img: 'https://images.unsplash.com/photo-1523398002811-999ca8dec234?w=400&q=60&fit=crop', note: 'street-influenced',      style_tags: ['streetwear', 'urban', 'edgy'] },
  { value: 'bohemian',    label: 'Free spirit',        img: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=400&q=60&fit=crop', note: 'bohemian and free-spirited', style_tags: ['bohemian', 'eclectic', 'earthy'] },
  { value: 'preppy',      label: 'Polished preppy',    img: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=400&q=60&fit=crop', note: 'polished and preppy',    style_tags: ['preppy', 'classic', 'put-together'] },
  { value: 'outdoorsy',   label: 'Outdoorsy',          img: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=400&q=60&fit=crop', note: 'outdoorsy and functional', style_tags: ['outdoorsy', 'functional', 'rugged'] },
  { value: 'luxury',      label: 'Quiet luxury',       img: 'https://images.unsplash.com/photo-1445205170230-053b83016050?w=400&q=60&fit=crop', note: 'quietly luxurious and elevated', style_tags: ['luxury', 'elevated', 'understated'] },
  { value: 'artsy',       label: 'Creative & artsy',   img: 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=400&q=60&fit=crop', note: 'creative and expressive', style_tags: ['creative', 'artsy', 'expressive'] },
  { value: 'athletic',    label: 'Athletic / Sport',   img: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=400&q=60&fit=crop', note: 'athletic and performance-driven', style_tags: ['athletic', 'sporty', 'performance'] },
]

const COLOR_OPTIONS: ImageOption[] = [
  { value: 'neutrals',    label: 'Whites & creams',    img: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=400&q=60&fit=crop', note: 'whites and creams' },
  { value: 'earth',       label: 'Earth & terracotta', img: 'https://images.unsplash.com/photo-1600080972464-8e5f35f63d08?w=400&q=60&fit=crop', note: 'earthy terracotta and brown tones' },
  { value: 'bold',        label: 'Bold & saturated',   img: 'https://images.unsplash.com/photo-1582201942988-13e60e4556ee?w=400&q=60&fit=crop', note: 'bold saturated colors' },
  { value: 'pastels',     label: 'Soft pastels',       img: 'https://images.unsplash.com/photo-1520981825232-ece5fae45120?w=400&q=60&fit=crop', note: 'soft pastel tones' },
  { value: 'navy_forest', label: 'Navy & forest',      img: 'https://images.unsplash.com/photo-1509631179647-0177331693ae?w=400&q=60&fit=crop', note: 'deep navy and forest greens' },
  { value: 'monochrome',  label: 'Black & white',      img: 'https://images.unsplash.com/photo-1594938298603-c8148c4b4cce?w=400&q=60&fit=crop', note: 'black and white monochrome' },
]

const DREAM_HOME_OPTIONS: ImageOption[] = [
  { value: 'modern_penthouse', label: 'Modern penthouse',  img: 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=400&q=60&fit=crop', note: 'a modern city penthouse with sleek lines and urban energy', style_tags: ['modern', 'urban', 'sleek'] },
  { value: 'coastal_cottage',  label: 'Coastal cottage',   img: 'https://images.unsplash.com/photo-1499793983690-e29da59ef1c2?w=400&q=60&fit=crop', note: 'a relaxed coastal cottage with natural textures and sea air', style_tags: ['coastal', 'relaxed', 'natural'] },
  { value: 'mountain_cabin',   label: 'Mountain cabin',    img: 'https://images.unsplash.com/photo-1510798831971-661eb04b3739?w=400&q=60&fit=crop', note: 'a cozy mountain cabin surrounded by nature', style_tags: ['rustic', 'cozy', 'natural'] },
  { value: 'tuscan_villa',     label: 'Tuscan villa',      img: 'https://images.unsplash.com/photo-1523531294919-4bcd7c65e216?w=400&q=60&fit=crop', note: 'a classic Tuscan villa with old-world refinement', style_tags: ['classic', 'european', 'refined'] },
  { value: 'nyc_loft',         label: 'NYC loft',          img: 'https://images.unsplash.com/photo-1502672023488-70e25813eb80?w=400&q=60&fit=crop', note: 'an industrial NYC loft with raw character and urban edge', style_tags: ['industrial', 'urban', 'edgy'] },
  { value: 'desert_compound',  label: 'Desert compound',   img: 'https://images.unsplash.com/photo-1573055418049-c8e0b7e3a7a6?w=400&q=60&fit=crop', note: 'a minimalist desert compound that is architectural and earthy', style_tags: ['minimal', 'architectural', 'earthy'] },
]

const DREAM_SCENE_OPTIONS: ImageOption[] = [
  { value: 'waterfall',      label: 'Jungle waterfall',          img: 'https://images.unsplash.com/photo-1455218873509-8097305ee378?w=400&q=60&fit=crop', note: 'an adventurous jungle waterfall' },
  { value: 'city_rooftop',   label: 'City rooftop at dusk',      img: 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=400&q=60&fit=crop', note: 'a city rooftop at dusk surrounded by people and energy' },
  { value: 'mountain_peak',  label: 'Mountain summit',           img: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=400&q=60&fit=crop', note: 'a mountain summit after a hard climb' },
  { value: 'beach_sunset',   label: 'Beach at sunset',           img: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=400&q=60&fit=crop', note: 'a quiet beach at golden hour' },
  { value: 'cozy_cabin',     label: 'Cozy cabin evening',        img: 'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=400&q=60&fit=crop', note: 'a cozy cabin evening by the fire' },
  { value: 'french_market',  label: 'French countryside market', img: 'https://images.unsplash.com/photo-1533900298318-6b8da08a523e?w=400&q=60&fit=crop', note: 'a French countryside market full of food and artisan finds' },
  { value: 'gallery_opening',label: 'Gallery opening night',     img: 'https://images.unsplash.com/photo-1531058020387-3be344556be6?w=400&q=60&fit=crop', note: 'a gallery opening night among creative people' },
  { value: 'road_trip',      label: 'Open road road trip',       img: 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=400&q=60&fit=crop', note: 'an open road with nowhere to be and everywhere to go' },
]

const WEEKEND_OPTIONS: ImageOption[] = [
  { value: 'hiking',         label: 'Hiking or camping',      img: 'https://images.unsplash.com/photo-1551632811-561732d1e306?w=400&q=60&fit=crop', note: 'hiking or camping in nature' },
  { value: 'farmers_market', label: 'Farmers market',         img: 'https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=400&q=60&fit=crop', note: 'visiting farmers markets' },
  { value: 'hosting',        label: 'Hosting dinner',         img: 'https://images.unsplash.com/photo-1529543544282-ea669407fca3?w=400&q=60&fit=crop', note: 'hosting dinners and entertaining at home' },
  { value: 'gallery',        label: 'Gallery or museum',      img: 'https://images.unsplash.com/photo-1531058020387-3be344556be6?w=400&q=60&fit=crop', note: 'visiting galleries and museums' },
  { value: 'gym_wellness',   label: 'Gym or wellness',        img: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=400&q=60&fit=crop', note: 'gym sessions and wellness routines' },
  { value: 'live_music',     label: 'Live music or festival', img: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=400&q=60&fit=crop', note: 'live music and festivals' },
  { value: 'thrift_antiques',label: 'Thrifting or antiques',  img: 'https://images.unsplash.com/photo-1558171813-7c1df82c0b27?w=400&q=60&fit=crop', note: 'thrifting and hunting for antiques' },
  { value: 'cooking',        label: 'Cooking or baking',      img: 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=400&q=60&fit=crop', note: 'cooking and baking at home' },
  { value: 'road_trip_wknd', label: 'Spontaneous road trip',  img: 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=400&q=60&fit=crop', note: 'spontaneous road trips' },
  { value: 'reading_cafe',   label: 'Coffee shop / reading',  img: 'https://images.unsplash.com/photo-1442512595331-e89e73853f31?w=400&q=60&fit=crop', note: 'reading at coffee shops' },
  { value: 'beach_park',     label: 'Beach or park',          img: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=400&q=60&fit=crop', note: 'relaxing at the beach or park' },
  { value: 'shopping',       label: 'Shopping & exploring',   img: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=400&q=60&fit=crop', note: 'shopping and exploring new neighborhoods' },
]

const DREAM_CAR_OPTIONS: ImageOption[] = [
  { value: 'vintage_muscle',    label: 'Vintage muscle car',     img: 'https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=400&q=60&fit=crop', note: 'a vintage muscle car — nostalgic, bold, and collector-minded', style_tags: ['classic', 'bold'] },
  { value: 'luxury_suv',        label: 'Luxury SUV',             img: 'https://images.unsplash.com/photo-1519641471654-76ce0107ad1b?w=400&q=60&fit=crop', note: 'a luxury SUV — premium, family-oriented, and quality-first', style_tags: ['premium', 'practical'] },
  { value: 'electric_sports',   label: 'Electric sports car',    img: 'https://images.unsplash.com/photo-1560958089-b8a1929cea89?w=400&q=60&fit=crop', note: 'an electric sports car — tech-forward and performance-driven', style_tags: ['modern', 'innovative'] },
  { value: 'classic_convertible',label: 'Classic convertible',   img: 'https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?w=400&q=60&fit=crop', note: 'a classic convertible — lifestyle-driven with timeless romance', style_tags: ['timeless', 'romantic'] },
  { value: 'offroad_truck',     label: 'Off-road truck',         img: 'https://images.unsplash.com/photo-1519641471654-76ce0107ad1b?w=400&q=60&fit=crop', note: 'an off-road truck — rugged, utility-first, built for the outdoors', style_tags: ['rugged', 'functional'] },
  { value: 'sleek_sedan',       label: 'Sleek European sedan',   img: 'https://images.unsplash.com/photo-1542362567-b07e54358753?w=400&q=60&fit=crop', note: 'a sleek European sedan — understated luxury with attention to detail', style_tags: ['refined', 'sophisticated'] },
]

const GIFT_MOOD_OPTIONS: ImageOption[] = [
  { value: 'sentimental',    label: 'Sentimental keepsake', img: 'https://images.unsplash.com/photo-1512909006721-3d6018887383?w=400&q=60&fit=crop', note: 'sentimental keepsakes with personal meaning' },
  { value: 'luxury_splurge', label: 'Luxury splurge',       img: 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=400&q=60&fit=crop', note: 'luxury splurges that feel special and elevated' },
  { value: 'useful',         label: 'Useful & practical',   img: 'https://images.unsplash.com/photo-1491553895911-0055eca6402d?w=400&q=60&fit=crop', note: 'useful and practical things people will actually use' },
  { value: 'funny',          label: 'Funny & playful',      img: 'https://images.unsplash.com/photo-1513151233558-d860c5398176?w=400&q=60&fit=crop', note: 'funny and playful gifts that make people laugh' },
  { value: 'experience',     label: 'An experience',        img: 'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=400&q=60&fit=crop', note: 'experiences rather than things — memories over objects' },
  { value: 'artisan',        label: 'Local or artisan find', img: 'https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=400&q=60&fit=crop', note: 'local or artisan finds — small-batch and thoughtfully sourced' },
]

const AREA_OPTIONS: ImageOption[] = [
  { value: 'urban',    label: 'City life',           img: 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=400&q=60&fit=crop', note: 'a city or urban environment' },
  { value: 'suburban', label: 'Suburbs',             img: 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=400&q=60&fit=crop', note: 'a suburban neighborhood' },
  { value: 'rural',    label: 'Small town / Rural',  img: 'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=400&q=60&fit=crop', note: 'a small town or rural area' },
]

const MATERIAL_OPTIONS: ImageOption[] = [
  { value: 'cashmere_wool',  label: 'Cashmere & wool',          img: 'https://images.unsplash.com/photo-1580310614729-ccd69652491d?w=400&q=60&fit=crop', note: 'cashmere and wool', style_tags: ['cozy', 'premium', 'soft'] },
  { value: 'leather',        label: 'Leather',                  img: 'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=400&q=60&fit=crop', note: 'leather', style_tags: ['leather', 'durable', 'classic'] },
  { value: 'linen_cotton',   label: 'Linen & cotton',           img: 'https://images.unsplash.com/photo-1558769132-cb1aea458c5e?w=400&q=60&fit=crop', note: 'linen and cotton', style_tags: ['breathable', 'natural', 'relaxed'] },
  { value: 'denim',          label: 'Denim',                    img: 'https://images.unsplash.com/photo-1542272604-787c3835535d?w=400&q=60&fit=crop', note: 'denim', style_tags: ['denim', 'casual', 'americana'] },
  { value: 'silk_satin',     label: 'Silk & satin',             img: 'https://images.unsplash.com/photo-1519415510236-718bdfcd89c8?w=400&q=60&fit=crop', note: 'silk and satin', style_tags: ['luxe', 'silk', 'refined'] },
  { value: 'technical',      label: 'Technical / Performance',  img: 'https://images.unsplash.com/photo-1539185441755-769473a23570?w=400&q=60&fit=crop', note: 'technical and performance fabrics', style_tags: ['technical', 'performance', 'functional'] },
  { value: 'canvas_waxed',   label: 'Canvas & waxed cotton',    img: 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=400&q=60&fit=crop', note: 'canvas and waxed cotton', style_tags: ['rugged', 'workwear', 'utilitarian'] },
  { value: 'velvet_brocade', label: 'Velvet & brocade',         img: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&q=60&fit=crop', note: 'velvet and brocade', style_tags: ['maximalist', 'rich', 'bold'] },
  { value: 'wood_ceramic',   label: 'Wood & ceramic',           img: 'https://images.unsplash.com/photo-1565193566173-7a0ee3dbe261?w=400&q=60&fit=crop', note: 'wood and ceramic materials', style_tags: ['artisan', 'handmade', 'natural'] },
]

const WORK_SETUP_OPTIONS: ImageOption[] = [
  { value: 'home_office',       label: 'Dedicated home office',  img: 'https://images.unsplash.com/photo-1593642632559-0c6d3fc62b89?w=400&q=60&fit=crop', note: 'a dedicated home office setup' },
  { value: 'kitchen_table',     label: 'Kitchen table WFH',      img: 'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=400&q=60&fit=crop', note: 'working from the kitchen table or couch' },
  { value: 'corporate_office',  label: 'Corporate office',       img: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=400&q=60&fit=crop', note: 'a corporate or traditional office' },
  { value: 'coworking',         label: 'Coworking / café',       img: 'https://images.unsplash.com/photo-1521791136064-7986c2920216?w=400&q=60&fit=crop', note: 'coworking spaces and cafés' },
  { value: 'creative_studio',   label: 'Creative studio',        img: 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=400&q=60&fit=crop', note: 'a creative studio or maker space' },
  { value: 'outdoors_field',    label: 'Outdoors / On-site',     img: 'https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?w=400&q=60&fit=crop', note: 'outdoors or on-site field work' },
  { value: 'retail_hospitality',label: 'Retail or hospitality',  img: 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=400&q=60&fit=crop', note: 'retail or hospitality on their feet' },
  { value: 'travel_constant',   label: 'Always traveling',       img: 'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=400&q=60&fit=crop', note: 'constantly traveling for work' },
]

const FAMILY_LIFE_OPTIONS: ImageOption[] = [
  { value: 'young_kids',        label: 'Young kids at home',      img: 'https://images.unsplash.com/photo-1536640712-4d4c36ff0e4e?w=400&q=60&fit=crop', note: 'young children at home' },
  { value: 'older_kids',        label: 'Older kids / Teens',      img: 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=400&q=60&fit=crop', note: 'older kids or teenagers in the house' },
  { value: 'partner_no_kids',   label: 'Partner, no kids',        img: 'https://images.unsplash.com/photo-1522673607200-164d1b6ce486?w=400&q=60&fit=crop', note: 'living with a partner, no children' },
  { value: 'solo_living',       label: 'Flying solo',             img: 'https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=400&q=60&fit=crop', note: 'living solo and independently' },
  { value: 'multigenerational', label: 'Multigenerational home',  img: 'https://images.unsplash.com/photo-1581579438747-1dc8d17bbce4?w=400&q=60&fit=crop', note: 'a multigenerational or extended family household' },
  { value: 'empty_nester',      label: 'Empty nester',            img: 'https://images.unsplash.com/photo-1471560090527-d1af5e4e6eb6?w=400&q=60&fit=crop', note: 'an empty nester rediscovering personal freedom' },
  { value: 'roommates',         label: 'Living with roommates',   img: 'https://images.unsplash.com/photo-1529543544282-ea669407fca3?w=400&q=60&fit=crop', note: 'living with roommates in a shared space' },
  { value: 'newborn',           label: 'Newborn or expecting',    img: 'https://images.unsplash.com/photo-1492725764893-90b379c2b6e7?w=400&q=60&fit=crop', note: 'a newborn or expecting a baby' },
]

// ─── Note templates ───────────────────────────────────────────────────────────
// These produce the human-readable strings Mason actually reads.

function joinNatural(items: string[]): string {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1]
}

const TEMPLATES: Record<string, (labels: string[]) => string> = {
  style:      ls => `Their style is ${joinNatural(ls)}.`,
  color:      ls => `They gravitate toward ${joinNatural(ls)} in their wardrobe and home.`,
  dream_home: ls => `Their dream home would be ${joinNatural(ls)}.`,
  dream_scene:ls => `They feel most alive in scenes like ${joinNatural(ls)}.`,
  weekend:    ls => `On weekends they love ${joinNatural(ls)}.`,
  dream_car:  ls => `Their dream car would be ${joinNatural(ls)}.`,
  gift_mood:  ls => `When giving gifts they gravitate toward ${joinNatural(ls)}.`,
  area:       ls => `They live in ${joinNatural(ls)}.`,
  material:   ls => `They are drawn to ${joinNatural(ls)} in clothing and goods.`,
  work_setup: ls => `They work from ${joinNatural(ls)}.`,
  family_life:ls => `Their home life includes ${joinNatural(ls)}.`,
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PrefsForm({ prefs, onPatch }: PrefsFormProps) {
  const lifestyle = (prefs.lifestyle ?? {}) as MasonLifestyle

  function patchLifestyle(patch: Partial<MasonLifestyle>) {
    onPatch({ lifestyle: patch as Partial<MasonLifestyle> })
  }

  // Derive UI selection state from stored _selections fields
  const sel = {
    style:       lifestyle.style_selections ?? [],
    color:       lifestyle.color_selections ?? [],
    dream_home:  lifestyle.dream_home_selections ?? [],
    dream_scene: lifestyle.dream_scene_selections ?? [],
    weekend:     lifestyle.weekend_selections ?? [],
    dream_car:   lifestyle.dream_car_selections ?? [],
    gift_mood:   lifestyle.gift_mood_selections ?? [],
    area:        lifestyle.area_selections ?? [],
    material:    lifestyle.material_selections ?? [],
    work_setup:  lifestyle.work_setup_selections ?? [],
    family_life: lifestyle.family_life_selections ?? [],
  }

  // Generic handler: toggles a value in a selection list, rebuilds the note, writes both
  function makeToggle(
    key: keyof typeof sel,
    options: ImageOption[],
    onWrite: (selections: string[], note: string) => void,
  ) {
    return (value: string) => {
      const current = sel[key]
      const next = current.includes(value)
        ? current.filter(v => v !== value)
        : [...current, value]
      const note = buildNotes(options, next, TEMPLATES[key])
      onWrite(next, note)
    }
  }

  const toggleStyle = makeToggle('style', STYLE_OPTIONS, (sels, note) => {
    const bonusTags = sels.flatMap(v => STYLE_OPTIONS.find(o => o.value === v)?.style_tags ?? [])
    const existingOther = (prefs.style_tags ?? []).filter(t =>
      !STYLE_OPTIONS.flatMap(o => o.style_tags ?? []).includes(t)
    )
    onPatch({
      style_tags: [...new Set([...existingOther, ...sels, ...bonusTags])],
      lifestyle: { style_selections: sels, style_notes: note } as Partial<MasonLifestyle>,
    })
  })

  const toggleColor = makeToggle('color', COLOR_OPTIONS, (sels, note) =>
    patchLifestyle({ color_selections: sels, color_notes: note })
  )

  const toggleDreamHome = makeToggle('dream_home', DREAM_HOME_OPTIONS, (sels, note) => {
    const bonusTags = sels.flatMap(v => DREAM_HOME_OPTIONS.find(o => o.value === v)?.style_tags ?? [])
    const existingOther = (prefs.style_tags ?? []).filter(t =>
      !DREAM_HOME_OPTIONS.flatMap(o => o.style_tags ?? []).includes(t)
    )
    onPatch({
      style_tags: [...new Set([...existingOther, ...bonusTags])],
      lifestyle: { dream_home_selections: sels, dream_home_notes: note } as Partial<MasonLifestyle>,
    })
  })

  const toggleDreamScene = makeToggle('dream_scene', DREAM_SCENE_OPTIONS, (sels, note) =>
    patchLifestyle({ dream_scene_selections: sels, dream_scene_notes: note })
  )

  const toggleWeekend = makeToggle('weekend', WEEKEND_OPTIONS, (sels, note) =>
    patchLifestyle({ weekend_selections: sels, weekend_notes: note })
  )

  const toggleDreamCar = makeToggle('dream_car', DREAM_CAR_OPTIONS, (sels, note) => {
    const bonusTags = sels.flatMap(v => DREAM_CAR_OPTIONS.find(o => o.value === v)?.style_tags ?? [])
    const existingOther = (prefs.style_tags ?? []).filter(t =>
      !DREAM_CAR_OPTIONS.flatMap(o => o.style_tags ?? []).includes(t)
    )
    onPatch({
      style_tags: [...new Set([...existingOther, ...bonusTags])],
      lifestyle: { dream_car_selections: sels, dream_car_notes: note } as Partial<MasonLifestyle>,
    })
  })

  const toggleGiftMood = makeToggle('gift_mood', GIFT_MOOD_OPTIONS, (sels, note) =>
    patchLifestyle({ gift_mood_selections: sels, gift_mood_notes: note })
  )

  const toggleArea = makeToggle('area', AREA_OPTIONS, (sels, note) =>
    patchLifestyle({ area_selections: sels, area_notes: note })
  )

  const toggleMaterial = makeToggle('material', MATERIAL_OPTIONS, (sels, note) => {
    const bonusTags = sels.flatMap(v => MATERIAL_OPTIONS.find(o => o.value === v)?.style_tags ?? [])
    const existingOther = (prefs.style_tags ?? []).filter(t =>
      !MATERIAL_OPTIONS.flatMap(o => o.style_tags ?? []).includes(t)
    )
    onPatch({
      style_tags: [...new Set([...existingOther, ...bonusTags])],
      lifestyle: { material_selections: sels, material_notes: note } as Partial<MasonLifestyle>,
    })
  })

  const toggleWorkSetup = makeToggle('work_setup', WORK_SETUP_OPTIONS, (sels, note) =>
    patchLifestyle({ work_setup_selections: sels, work_setup_notes: note })
  )

  const toggleFamilyLife = makeToggle('family_life', FAMILY_LIFE_OPTIONS, (sels, note) =>
    patchLifestyle({ family_life_selections: sels, family_life_notes: note })
  )

  return (
    <div className={styles.form}>
      <p className={styles.helpText}>
        Pick images that feel like you — Mason reads between the lines to personalize every recommendation.
      </p>

      <Section title="What's your style energy?" defaultOpen>
        <p className={styles.sectionHint}>Pick all that fit — you can wear more than one vibe.</p>
        <ImagePick options={STYLE_OPTIONS} selected={sel.style} onToggle={toggleStyle} cols={3} />
      </Section>

      <Section title="What's your color world?">
        <p className={styles.sectionHint}>Which palette shows up most in your wardrobe or home?</p>
        <ImagePick options={COLOR_OPTIONS} selected={sel.color} onToggle={toggleColor} cols={3} />
      </Section>

      <Section title="What's the vibe of your dream home?">
        <p className={styles.sectionHint}>Pick all that speak to you.</p>
        <ImagePick options={DREAM_HOME_OPTIONS} selected={sel.dream_home} onToggle={toggleDreamHome} cols={3} />
      </Section>

      <Section title="Which scene would you most want to be in right now?">
        <p className={styles.sectionHint}>Pick as many as you want.</p>
        <ImagePick options={DREAM_SCENE_OPTIONS} selected={sel.dream_scene} onToggle={toggleDreamScene} cols={4} />
      </Section>

      <Section title="How do you spend your free time?">
        <p className={styles.sectionHint}>Pick everything that sounds like a good weekend.</p>
        <ImagePick options={WEEKEND_OPTIONS} selected={sel.weekend} onToggle={toggleWeekend} cols={3} />
      </Section>

      <Section title="What's your dream car?">
        <p className={styles.sectionHint}>Says a lot about someone. Pick all that feel right.</p>
        <ImagePick options={DREAM_CAR_OPTIONS} selected={sel.dream_car} onToggle={toggleDreamCar} cols={3} />
      </Section>

      <Section title="When giving a gift, what's the move?">
        <p className={styles.sectionHint}>Pick everything that sounds like you.</p>
        <ImagePick options={GIFT_MOOD_OPTIONS} selected={sel.gift_mood} onToggle={toggleGiftMood} cols={3} />
      </Section>

      <Section title="Where do you live?">
        <ImagePick options={AREA_OPTIONS} selected={sel.area} onToggle={toggleArea} cols={3} />
      </Section>

      <Section title="What materials are you drawn to?">
        <p className={styles.sectionHint}>Pick everything you love — in clothing, accessories, or home goods.</p>
        <ImagePick options={MATERIAL_OPTIONS} selected={sel.material} onToggle={toggleMaterial} cols={3} />
      </Section>

      <Section title="What does your work setup look like?">
        <p className={styles.sectionHint}>Pick all that apply — some people have more than one.</p>
        <ImagePick options={WORK_SETUP_OPTIONS} selected={sel.work_setup} onToggle={toggleWorkSetup} cols={4} />
      </Section>

      <Section title="What does your home life look like?">
        <p className={styles.sectionHint}>Pick everything that fits — life is layered.</p>
        <ImagePick options={FAMILY_LIFE_OPTIONS} selected={sel.family_life} onToggle={toggleFamilyLife} cols={4} />
      </Section>

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

      <Section title="Brands & things you love">
        <ChipInput
          values={prefs.likes ?? []}
          onChange={next => onPatch({ likes: next })}
          placeholder="Add a brand, material, or style…"
        />
      </Section>

      <Section title="Things to avoid">
        <ChipInput
          values={prefs.dislikes ?? []}
          onChange={next => onPatch({ dislikes: next })}
          placeholder="Add something you never want to see…"
        />
      </Section>

      <Section title="Anything else Mason should know">
        <p className={styles.sectionHint}>Free-form notes about your life, routines, or context.</p>
        <Field label="Notes">
          <textarea
            className={styles.textarea}
            value={lifestyle.freeform_notes ?? ''}
            onChange={e => patchLifestyle({ freeform_notes: e.target.value })}
            placeholder="e.g. I travel for work, host dinner parties monthly, have a toddler at home…"
            rows={3}
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
