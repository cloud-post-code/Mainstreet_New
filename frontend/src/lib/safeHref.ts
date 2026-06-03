// Reject any URL whose protocol isn't http/https — defuses javascript:, data:,
// and other script-execution vectors when rendering LLM- or user-supplied URLs.
export function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  try {
    const u = new URL(url, window.location.origin)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : undefined
  } catch {
    return undefined
  }
}
