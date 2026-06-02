import styles from './MainStLogo.module.css'

const LOGO_SRC = '/main-st-logo.png'

type Props = {
  className?: string
  size?: 'nav' | 'auth'
}

export default function MainStLogo({ className, size = 'nav' }: Props) {
  return (
    <img
      src={LOGO_SRC}
      alt="Main St."
      className={[styles.logo, styles[size], className].filter(Boolean).join(' ')}
    />
  )
}
