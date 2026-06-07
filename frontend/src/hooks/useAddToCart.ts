import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCart } from '../cart/CartContext'
import { useAuth } from './useAuth'

type Status = 'idle' | 'loading' | 'success' | 'error'

interface AddArg {
  variantId?: number
  productId?: number
  quantity?: number
}

interface Options {
  successMs?: number
  errorMs?: number
}

export function useAddToCart(opts: Options = {}) {
  const cart = useCart()
  const { token } = useAuth()
  const navigate = useNavigate()
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)

  const successMs = opts.successMs ?? 1500
  const errorMs = opts.errorMs ?? 3500

  const add = async (arg: AddArg): Promise<boolean> => {
    if (!token) {
      navigate('/login')
      return false
    }
    setStatus('loading')
    setError(null)
    const qty = arg.quantity ?? 1
    const res = await cart.addItem(
      arg.variantId != null
        ? { variantId: arg.variantId, quantity: qty }
        : { productId: arg.productId!, quantity: qty },
    )
    if (res.ok) {
      setStatus('success')
      setTimeout(() => setStatus('idle'), successMs)
      return true
    }
    setStatus('error')
    setError(res.error ?? 'Could not add to cart')
    setTimeout(() => { setStatus('idle'); setError(null) }, errorMs)
    return false
  }

  return {
    status,
    error,
    add,
    busy: status === 'loading',
    added: status === 'success',
  }
}
