import { ReactNode } from 'react'
import styles from './A2ui.module.css'

interface Props {
  gap?: string
  children?: ReactNode
}

export default function Stack({ gap, children }: Props) {
  return (
    <div className={styles.stack} style={gap ? { gap } : undefined}>
      {children}
    </div>
  )
}
