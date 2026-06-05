import { useEffect, useRef } from 'react'

type Props = {
  className?: string
  // Target brick size in CSS pixels. Rows/columns are derived from the viewport
  // and these targets so visual density stays consistent across screen sizes.
  targetBrickWidth?: number
  targetBrickHeight?: number
}

// Deterministic hash → [0, 1). Used so each brick gets stable noise/wear/color
// across redraws without persisting any per-brick state.
function hash2(x: number, y: number): number {
  let h = x * 374761393 + y * 668265263
  h = (h ^ (h >>> 13)) * 1274126177
  h = h ^ (h >>> 16)
  return ((h >>> 0) % 100000) / 100000
}

export default function BrickWallCanvas({
  className,
  targetBrickWidth = 110,
  targetBrickHeight = 42,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    if (!parent) return

    let raf = 0

    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const cssW = parent.clientWidth
      const cssH = parent.clientHeight
      if (cssW <= 0 || cssH <= 0) return

      canvas.width = Math.round(cssW * dpr)
      canvas.height = Math.round(cssH * dpr)
      canvas.style.width = cssW + 'px'
      canvas.style.height = cssH + 'px'

      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      // Derive columns/rows from the viewport so the grid divides cleanly into
      // full bricks on all sides — no clipping at the edges. Recomputing the
      // brick size from rounded counts is what keeps the outer edges flush.
      const cols = Math.max(1, Math.round(cssW / targetBrickWidth))
      const rows = Math.max(1, Math.round(cssH / targetBrickHeight))
      const bw = cssW / cols
      const bh = cssH / rows

      // Mortar color (cream-tinted gray to sit on the page background).
      ctx.fillStyle = '#d8cdb4'
      ctx.fillRect(0, 0, cssW, cssH)

      const mortar = Math.max(1, Math.min(2, Math.round(bh * 0.06)))

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          // Running-bond look without shifting bricks off-canvas: alternate the
          // tonal "stagger" by row+col parity. Edges stay full bricks because
          // no row is physically offset.
          const stagger = (r + (r % 2 === 0 ? 0 : 1)) % 2
          const tone = (c + stagger) % 2

          const x = Math.round(c * bw)
          const y = Math.round(r * bh)
          const w = Math.round((c + 1) * bw) - x
          const h = Math.round((r + 1) * bh) - y

          const n = hash2(c, r)
          // Base palette — warm terracotta/clay reds with slight per-brick drift.
          const baseHue = 14 + (n - 0.5) * 6
          const baseSat = 38 + (hash2(c + 7, r + 3) - 0.5) * 10
          const baseLight = (tone === 0 ? 46 : 41) + (hash2(c + 11, r + 5) - 0.5) * 6

          // Brick fill
          ctx.fillStyle = `hsl(${baseHue.toFixed(1)}, ${baseSat.toFixed(1)}%, ${baseLight.toFixed(1)}%)`
          ctx.fillRect(x + mortar, y + mortar, Math.max(0, w - mortar * 2), Math.max(0, h - mortar * 2))

          // Subtle per-brick texture noise: a handful of low-alpha specks.
          const speckCount = 8 + Math.floor(hash2(c + 23, r + 17) * 6)
          for (let i = 0; i < speckCount; i++) {
            const sn = hash2(c * 31 + i, r * 17 + i * 3)
            const sx = x + mortar + sn * Math.max(0, w - mortar * 2)
            const sy = y + mortar + hash2(c * 13 + i * 7, r * 19 + i) * Math.max(0, h - mortar * 2)
            const dark = hash2(c + i, r - i) > 0.5
            ctx.fillStyle = dark
              ? `rgba(40, 18, 10, ${0.05 + sn * 0.06})`
              : `rgba(255, 230, 200, ${0.04 + sn * 0.05})`
            ctx.fillRect(sx, sy, 1.2, 1.2)
          }

          // Edge wear: lighten top-left, darken bottom-right slightly.
          const wear = 0.08 + hash2(c + 3, r + 9) * 0.06
          ctx.fillStyle = `rgba(255, 240, 220, ${wear})`
          ctx.fillRect(x + mortar, y + mortar, Math.max(0, w - mortar * 2), 1)
          ctx.fillStyle = `rgba(30, 12, 6, ${wear * 0.9})`
          ctx.fillRect(x + mortar, y + h - mortar - 1, Math.max(0, w - mortar * 2), 1)

          // Occasional chip on a corner.
          if (hash2(c + 41, r + 29) > 0.86) {
            const corner = Math.floor(hash2(c + 53, r + 31) * 4)
            const chip = Math.max(2, Math.min(bh * 0.35, 4 + hash2(c, r + 1) * 4))
            ctx.fillStyle = '#d8cdb4'
            let cx = x + mortar
            let cy = y + mortar
            if (corner === 1) cx = x + w - mortar - chip
            else if (corner === 2) { cx = x + w - mortar - chip; cy = y + h - mortar - chip }
            else if (corner === 3) cy = y + h - mortar - chip
            ctx.beginPath()
            ctx.moveTo(cx, cy)
            ctx.lineTo(cx + chip, cy)
            ctx.lineTo(cx, cy + chip)
            ctx.closePath()
            ctx.fill()
          }
        }
      }
    }

    const schedule = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(draw)
    }

    schedule()

    const ro = new ResizeObserver(schedule)
    ro.observe(parent)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [targetBrickWidth, targetBrickHeight])

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />
}
