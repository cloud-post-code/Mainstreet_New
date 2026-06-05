import { useState } from 'react'
import { useMason } from '../mason/MasonContext'
import styles from './MasonChip.module.css'

const MASON_IMAGES = Array.from({ length: 10 }, (_, i) => `/mason/mason-${i + 1}.png`)

export default function MasonChip() {
  const { openDrawer } = useMason()
  const [idx] = useState(() => Math.floor(Math.random() * MASON_IMAGES.length))

  return (
    <button
      type="button"
      className={styles.bubble}
      onClick={openDrawer}
      aria-label="Open Mason"
    >
      <img
        src={MASON_IMAGES[idx]}
        alt=""
        className={styles.img}
      />
    </button>
  )
}
