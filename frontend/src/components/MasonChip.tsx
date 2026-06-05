import { useEffect, useState } from 'react'
import { useMason } from '../mason/MasonContext'
import styles from './MasonChip.module.css'

const MASON_IMAGES = Array.from({ length: 10 }, (_, i) => `/mason/mason-${i + 1}.png`)

export default function MasonChip() {
  const { openDrawer, agentState } = useMason()
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * MASON_IMAGES.length))

  useEffect(() => {
    const id = window.setInterval(() => {
      setIdx(i => (i + 1) % MASON_IMAGES.length)
    }, 2200)
    return () => window.clearInterval(id)
  }, [])

  return (
    <button
      type="button"
      className={styles.bubble}
      onClick={openDrawer}
      aria-label="Open Mason"
    >
      <img
        key={idx}
        src={MASON_IMAGES[idx]}
        alt=""
        className={styles.img}
      />
      <span className={`${styles.dot} ${styles[`dot_${agentState}`]}`} aria-hidden="true" />
    </button>
  )
}
