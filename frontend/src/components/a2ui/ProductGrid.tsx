import { ReactNode } from 'react'
import styles from './A2ui.module.css'

type Layout = 'recommendation' | 'comparison' | 'curated' | 'hero' | 'trio' | 'showcase'

interface Props {
  layout: Layout
  title: string
  subtitle?: string
  children?: ReactNode
}

const LAYOUT_CLASS: Record<Layout, string> = {
  recommendation: styles.gridRecommendation,
  comparison: styles.gridComparison,
  curated: styles.gridCurated,
  hero: styles.gridHero,
  trio: styles.gridTrio,
  showcase: styles.gridShowcase,
}

export default function ProductGrid({ layout, title, subtitle, children }: Props) {
  const gridClass = LAYOUT_CLASS[layout] ?? styles.gridRecommendation
  return (
    <div className={styles.gridWrapper} data-layout={layout}>
      <div className={styles.gridTitle}>{title}</div>
      {subtitle && <div className={styles.gridSubtitle}>{subtitle}</div>}
      <div className={gridClass}>{children}</div>
    </div>
  )
}
