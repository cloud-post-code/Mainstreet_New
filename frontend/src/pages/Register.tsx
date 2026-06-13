import { useState, FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../hooks/useAuth'
import MainStLogo from '../components/MainStLogo'
import styles from './Auth.module.css'

function getPasswordStrength(pw: string): { label: string; color: string } | null {
  if (!pw) return null
  if (pw.length < 8) return { label: 'Too short', color: '#c0392b' }
  if (pw.length < 12) return { label: 'Almost there (need 12+ chars)', color: '#e67e22' }
  const hasUpper = /[A-Z]/.test(pw)
  const hasNumber = /[0-9]/.test(pw)
  const hasSpecial = /[^A-Za-z0-9]/.test(pw)
  const extras = [hasUpper, hasNumber, hasSpecial].filter(Boolean).length
  if (extras >= 2) return { label: 'Strong', color: '#27ae60' }
  return { label: 'Good', color: '#2980b9' }
}

export default function Register() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)

  function validate(): boolean {
    const errs: Record<string, string> = {}
    if (!email.trim()) errs.email = 'Email is required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = 'Enter a valid email address'
    if (!password) errs.password = 'Password is required'
    else if (password.length < 12) errs.password = 'Password must be at least 12 characters'
    setFieldErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!validate()) return
    setLoading(true)
    try {
      const data = await api.register(email.trim(), password, name.trim() || undefined)
      login(data.access_token, data.user)
      navigate('/')
    } catch (err: unknown) {
      const msg = (err as Error).message
      // Map server-side field errors back to field highlights where possible
      if (msg.includes('password:') || msg.includes('Password')) {
        setFieldErrors(prev => ({ ...prev, password: msg.replace(/^password:\s*/i, '') }))
      } else if (msg.includes('email:') || msg.includes('Email')) {
        setFieldErrors(prev => ({ ...prev, email: msg.replace(/^email:\s*/i, '') }))
      } else {
        setError(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  const strength = getPasswordStrength(password)

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <MainStLogo size="auth" />
        <h1 className={styles.title}>Join Main Street</h1>
        <p className={styles.subtitle}>Create your account to get started</p>
        <form onSubmit={handleSubmit} className={styles.form} noValidate>
          <div className={styles.fieldGroup}>
            <input
              className={`${styles.input}${fieldErrors.name ? ` ${styles.inputError}` : ''}`}
              type="text"
              placeholder="Display name (optional)"
              value={name}
              onChange={e => setName(e.target.value)}
              autoComplete="name"
              autoFocus
            />
          </div>

          <div className={styles.fieldGroup}>
            <input
              className={`${styles.input}${fieldErrors.email ? ` ${styles.inputError}` : ''}`}
              type="email"
              placeholder="Email address"
              value={email}
              onChange={e => { setEmail(e.target.value); setFieldErrors(prev => ({ ...prev, email: '' })) }}
              autoComplete="email"
              required
            />
            {fieldErrors.email && <p className={styles.fieldError}>{fieldErrors.email}</p>}
          </div>

          <div className={styles.fieldGroup}>
            <input
              className={`${styles.input}${fieldErrors.password ? ` ${styles.inputError}` : ''}`}
              type="password"
              placeholder="Password (min 12 characters)"
              value={password}
              onChange={e => { setPassword(e.target.value); setFieldErrors(prev => ({ ...prev, password: '' })) }}
              autoComplete="new-password"
              required
            />
            {password && strength && (
              <p className={styles.passwordHint} style={{ color: strength.color }}>
                {strength.label}
              </p>
            )}
            {fieldErrors.password && <p className={styles.fieldError}>{fieldErrors.password}</p>}
          </div>

          {error && (
            <div className={styles.errorBox}>
              <span className={styles.errorIcon}>!</span>
              {error}
            </div>
          )}

          <button className={styles.button} type="submit" disabled={loading}>
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>
        <p className={styles.link}>Already have an account? <Link to="/login">Sign in</Link></p>
      </div>
    </div>
  )
}
