import { useCallback, useEffect, useRef, useState } from 'react'
import { api, BoardDetail, BoardNote } from '../api'
import { MasonMemory } from './useMasonMemory'

export interface BoardsState {
  // board detail
  selectedBoardId: number | null
  boardDetail: BoardDetail | null
  boardTab: 'saved' | 'notes' | 'vibes'
  detailLoading: boolean
  uploadingCover: boolean
  coverInputRef: React.RefObject<HTMLInputElement>
  // new board form
  showAddBoard: boolean
  newBoardName: string
  newBoardDesc: string
  newBoardImage: File | null
  newBoardImagePreview: string | null
  addingBoard: boolean
  newBoardImageRef: React.RefObject<HTMLInputElement>
  // notes
  newNoteText: string
  addingNote: boolean
  // actions
  setSelectedBoardId: (id: number | null) => void
  setBoardDetail: React.Dispatch<React.SetStateAction<BoardDetail | null>>
  setBoardTab: (tab: 'saved' | 'notes' | 'vibes') => void
  setShowAddBoard: React.Dispatch<React.SetStateAction<boolean>>
  setNewBoardName: (v: string) => void
  setNewBoardDesc: (v: string) => void
  setNewNoteText: (v: string) => void
  handleAddBoard: () => Promise<void>
  handleNewBoardImageChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  handleDeleteBoard: (id: number) => Promise<void>
  handleCoverUpload: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>
  handleAddNote: () => Promise<void>
  handleDeleteNote: (noteId: number) => Promise<void>
  handleRemoveProduct: (productId: number) => Promise<void>
  resetNewBoardForm: () => void
}

export function useBoardsState(memory: MasonMemory, token: string): BoardsState {
  const [selectedBoardId, setSelectedBoardId] = useState<number | null>(null)
  const [boardDetail, setBoardDetail] = useState<BoardDetail | null>(null)
  const [boardTab, setBoardTab] = useState<'saved' | 'notes' | 'vibes'>('saved')
  const [showAddBoard, setShowAddBoard] = useState(false)
  const [newBoardName, setNewBoardName] = useState('')
  const [newBoardDesc, setNewBoardDesc] = useState('')
  const [newBoardImage, setNewBoardImage] = useState<File | null>(null)
  const [newBoardImagePreview, setNewBoardImagePreview] = useState<string | null>(null)
  const [addingBoard, setAddingBoard] = useState(false)
  const [newNoteText, setNewNoteText] = useState('')
  const [addingNote, setAddingNote] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [uploadingCover, setUploadingCover] = useState(false)
  const coverInputRef = useRef<HTMLInputElement>(null)
  const newBoardImageRef = useRef<HTMLInputElement>(null)

  const loadBoardDetail = useCallback(async (id: number) => {
    setDetailLoading(true)
    try {
      const detail = await api.getBoard(id, token)
      setBoardDetail(detail)
    } catch (e) {
      console.error('[useBoardsState] load board detail failed', e)
    } finally {
      setDetailLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (selectedBoardId != null) {
      loadBoardDetail(selectedBoardId)
    } else {
      setBoardDetail(null)
    }
  }, [selectedBoardId, loadBoardDetail])

  const resetNewBoardForm = () => {
    setNewBoardName('')
    setNewBoardDesc('')
    setNewBoardImage(null)
    setNewBoardImagePreview(prev => { if (prev) URL.revokeObjectURL(prev); return null })
    setShowAddBoard(false)
  }

  const handleAddBoard = async () => {
    const name = newBoardName.trim()
    if (!name) return
    setAddingBoard(true)
    try {
      const board = await memory.createBoard(name, newBoardDesc.trim() || undefined)
      if (newBoardImage && board?.id) {
        await api.uploadBoardCover(board.id, newBoardImage, token).catch(() => {})
        await memory.refresh()
      }
      resetNewBoardForm()
    } catch (e) {
      console.error('[useBoardsState] create board failed', e)
    } finally {
      setAddingBoard(false)
    }
  }

  const handleNewBoardImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setNewBoardImage(file)
    const url = URL.createObjectURL(file)
    setNewBoardImagePreview(prev => { if (prev) URL.revokeObjectURL(prev); return url })
  }

  const handleDeleteBoard = async (id: number) => {
    if (!confirm('Delete this board and all its items?')) return
    await memory.deleteBoard(id)
    if (selectedBoardId === id) setSelectedBoardId(null)
  }

  const handleAddNote = async () => {
    const text = newNoteText.trim()
    if (!text || !selectedBoardId) return
    setAddingNote(true)
    try {
      const note = await memory.addNoteToBoard(selectedBoardId, text)
      setBoardDetail(prev => prev ? { ...prev, notes: [...prev.notes, note] } : prev)
      setNewNoteText('')
    } catch (e) {
      console.error('[useBoardsState] add note failed', e)
    } finally {
      setAddingNote(false)
    }
  }

  const handleDeleteNote = async (noteId: number) => {
    if (!selectedBoardId) return
    await memory.deleteBoardNote(selectedBoardId, noteId)
    setBoardDetail(prev => prev ? { ...prev, notes: prev.notes.filter((n: BoardNote) => n.id !== noteId) } : prev)
  }

  const handleRemoveProduct = async (productId: number) => {
    if (!selectedBoardId || !boardDetail) return
    await memory.removeProductFromBoard(selectedBoardId, productId)
    setBoardDetail(prev => prev ? { ...prev, products: prev.products.filter(p => p.product_id !== productId) } : prev)
  }

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !selectedBoardId) return
    setUploadingCover(true)
    try {
      const result = await api.uploadBoardCover(selectedBoardId, file, token)
      setBoardDetail(prev => prev ? { ...prev, cover_image_url: result.cover_image_url } : prev)
      await memory.refresh()
    } catch (e) {
      console.error('[useBoardsState] cover upload failed', e)
    } finally {
      setUploadingCover(false)
      if (coverInputRef.current) coverInputRef.current.value = ''
    }
  }

  return {
    selectedBoardId,
    boardDetail,
    boardTab,
    detailLoading,
    uploadingCover,
    coverInputRef,
    showAddBoard,
    newBoardName,
    newBoardDesc,
    newBoardImage,
    newBoardImagePreview,
    addingBoard,
    newBoardImageRef,
    newNoteText,
    addingNote,
    setSelectedBoardId,
    setBoardDetail,
    setBoardTab,
    setShowAddBoard,
    setNewBoardName,
    setNewBoardDesc,
    setNewNoteText,
    handleAddBoard,
    handleNewBoardImageChange,
    handleDeleteBoard,
    handleCoverUpload,
    handleAddNote,
    handleDeleteNote,
    handleRemoveProduct,
    resetNewBoardForm,
  }
}
