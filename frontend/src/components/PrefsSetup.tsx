import { useState } from 'react'
import { MasonPrefs, MasonPrefsPatch } from '../api'
import PrefsForm from './PrefsForm'
import MasonOnboarding from './MasonOnboarding'
import styles from './PrefsInterview.module.css'

interface Props {
  prefs: MasonPrefs
  onPatch: (patch: MasonPrefsPatch) => void
}

type View = 'cta' | 'interview' | 'form'

function isPrefsEmpty(prefs: MasonPrefs): boolean {
  return (
    (prefs.style_tags ?? []).length === 0 &&
    prefs.quality_price == null &&
    prefs.bulk_individual == null &&
    prefs.discover_known == null &&
    (prefs.likes ?? []).length === 0 &&
    (prefs.dislikes ?? []).length === 0 &&
    Object.keys(prefs.lifestyle ?? {}).length === 0
  )
}

export default function PrefsSetup({ prefs, onPatch }: Props) {
  const firstTime = isPrefsEmpty(prefs)
  const [view, setView] = useState<View>(firstTime ? 'cta' : 'form')

  function handleInterviewComplete(patch: MasonPrefsPatch) {
    onPatch(patch)
    // Brief delay so the done screen shows, then switch to the form
    setTimeout(() => setView('form'), 2000)
  }

  if (view === 'form') {
    return (
      <>
        {!firstTime && (
          <div style={{ marginBottom: 12 }}>
            <button
              type="button"
              onClick={() => setView('interview')}
              style={{
                appearance: 'none',
                background: 'transparent',
                border: '1px dashed rgba(15,24,5,0.25)',
                color: '#6a604f',
                padding: '6px 12px',
                borderRadius: '8px',
                fontFamily: 'Lora, serif',
                fontSize: '12px',
                cursor: 'pointer',
              }}
            >
              Re-run setup interview
            </button>
          </div>
        )}
        <PrefsForm prefs={prefs} onPatch={onPatch} />
      </>
    )
  }

  if (view === 'interview') {
    return (
      <MasonOnboarding
        onComplete={handleInterviewComplete}
        onSkip={() => setView('form')}
      />
    )
  }

  // CTA view — first time only
  return (
    <div className={styles.setupWrap}>
      <div className={styles.setupIcon}>
        <img src="/mason/mason-1.png" alt="Mason" />
      </div>
      <h2 className={styles.setupTitle}>Let's chat for a minute</h2>
      <p className={styles.setupDesc}>
        Mason wants to get to know your style — tap through a few quick questions and every recommendation becomes yours.
      </p>
      <button
        type="button"
        className={styles.setupBtn}
        onClick={() => setView('interview')}
      >
        Let's do it →
      </button>
      <button
        type="button"
        className={styles.setupSkip}
        onClick={() => setView('form')}
      >
        Skip — I'll set it up myself
      </button>
    </div>
  )
}
