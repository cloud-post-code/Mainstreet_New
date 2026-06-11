import posthog from 'posthog-js'

let initialized = false

const apiKey =
  (import.meta.env.VITE_POSTHOG_KEY as string | undefined) ||
  (import.meta.env.VITE_PUBLIC_POSTHOG_KEY as string | undefined) ||
  ''

const apiHost =
  (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ||
  'https://us.i.posthog.com'

export function initPostHog() {
  if (initialized || !apiKey) return
  posthog.init(apiKey, {
    api_host: apiHost,
    capture_pageview: true,
    capture_pageleave: true,
    persistence: 'localStorage+cookie',
    autocapture: true,
  })
  posthog.register({ mason_version: 'v1' })
  initialized = true
}

export function identify(userId: string | number, props?: Record<string, unknown>) {
  if (!initialized) return
  posthog.identify(String(userId), props)
}

export function reset() {
  if (!initialized) return
  posthog.reset()
}

export function track(event: string, props?: Record<string, unknown>) {
  if (!initialized) return
  posthog.capture(event, props)
}

export { posthog }
