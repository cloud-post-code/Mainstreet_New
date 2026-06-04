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
      <span className={styles.avatar}>
        <img src="/mason/mason-1.png" alt="" />
        <span className={`${styles.dot} ${styles[`dot_${agentState}`]}`} />
      </span>
      <span className={styles.name}>Mason</span>
    </button>
  )
}
