import { useMemo, useState } from 'react'

export interface VariantLike {
  variant_id: number
  option_names?: string[]
  option_values?: string[]
  variant_label?: string | null
  price: number
  quantity: number
  image_url?: string | null
}

export interface OptionAxis {
  name: string
  values: string[]
}

export interface VariantSelector<V extends VariantLike> {
  selectedVariantId: number | undefined
  selectedVariant: V | undefined
  optionAxes: OptionAxis[]
  selectedValues: Record<string, string | undefined>
  pickValue: (axisName: string, value: string) => void
  setSelectedVariantId: (id: number | undefined) => void
  isReachable: (axisName: string, value: string) => boolean
}

export function useVariantSelector<V extends VariantLike>(
  variants: V[],
  initialVariantId?: number,
): VariantSelector<V> {
  const [selectedVariantId, setSelectedVariantId] = useState<number | undefined>(initialVariantId)
  const selectedVariant = variants.find(v => v.variant_id === selectedVariantId)

  const optionAxes = useMemo<OptionAxis[]>(() => {
    const axes: OptionAxis[] = []
    const seen = new Map<string, Set<string>>()
    for (const v of variants) {
      const names = v.option_names ?? []
      const values = v.option_values ?? []
      for (let i = 0; i < names.length; i++) {
        const name = names[i]
        const value = values[i]
        if (!name || value == null) continue
        if (!seen.has(name)) {
          seen.set(name, new Set())
          axes.push({ name, values: [] })
        }
        const set = seen.get(name)!
        if (!set.has(value)) {
          set.add(value)
          axes.find(a => a.name === name)!.values.push(value)
        }
      }
    }
    return axes
  }, [variants])

  const selectedValues: Record<string, string | undefined> = {}
  if (selectedVariant) {
    const names = selectedVariant.option_names ?? []
    const values = selectedVariant.option_values ?? []
    for (let i = 0; i < names.length; i++) selectedValues[names[i]] = values[i]
  }

  const pickValue = (axisName: string, value: string) => {
    const target = { ...selectedValues, [axisName]: value }
    let match = variants.find(v => {
      const names = v.option_names ?? []
      const values = v.option_values ?? []
      return Object.entries(target).every(([n, val]) => {
        const idx = names.indexOf(n)
        return idx >= 0 && values[idx] === val
      })
    })
    if (!match) {
      match = variants.find(v => {
        const names = v.option_names ?? []
        const values = v.option_values ?? []
        const idx = names.indexOf(axisName)
        return idx >= 0 && values[idx] === value
      })
    }
    if (match) setSelectedVariantId(match.variant_id)
  }

  const isReachable = (axisName: string, value: string): boolean => {
    return variants.some(v => {
      const names = v.option_names ?? []
      const values = v.option_values ?? []
      const idx = names.indexOf(axisName)
      if (idx < 0 || values[idx] !== value) return false
      return Object.entries(selectedValues).every(([n, val]) => {
        if (n === axisName) return true
        const i = names.indexOf(n)
        return i < 0 || values[i] === val
      })
    })
  }

  return {
    selectedVariantId,
    selectedVariant,
    optionAxes,
    selectedValues,
    pickValue,
    setSelectedVariantId,
    isReachable,
  }
}
