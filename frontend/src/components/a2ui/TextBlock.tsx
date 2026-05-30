import styles from './A2ui.module.css'

interface Props {
  content: string
  tone?: 'primary' | 'muted'
}

export default function TextBlock({ content, tone }: Props) {
  return (
    <p className={`${styles.textBlock} ${tone === 'muted' ? styles.textBlockMuted : ''}`}>
      {content}
    </p>
  )
}
