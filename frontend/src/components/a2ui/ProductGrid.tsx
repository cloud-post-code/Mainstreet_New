import { ReactNode } from 'react'
import styles from './A2ui.module.css'

type Layout = 'recommendation' | 'comparison' | 'curated'

interface Props {
  layout: Layout
  title: string
  subtitle?: string
  children?: ReactNode
}

export default function ProductGrid({ layout, title, subtitle, children }: Props) {
  const gridClass =
    layout === 'comparison' ? styles.gridComparison
      : layout === 'curated' ? styles.gridCurated
        : styles.gridRecommendation
  return (
    <div className={styles.gridWrapper}>
      <div className={styles.gridTitle}>{title}</div>
      {subtitle && <div className={styles.gridSubtitle}>{subtitle}</div>}
      <div className={gridClass}>{children}</div>
    </div>
  )
}
