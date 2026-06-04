import { useMason } from '../mason/MasonContext'
import styles from './MasonChip.module.css'

export default function MasonChip() {
  const { openDrawer, agentState } = useMason()
  return (
    <button
      type="button"
      className={styles.chip}
      onClick={openDrawer}
      aria-label="Open Mason"
    >
      <span className={`${styles.dot} ${styles[`dot_${agentState}`]}`} aria-hidden="true" />
      <span className={styles.name}>Mason</span>
    </button>
  )
}
