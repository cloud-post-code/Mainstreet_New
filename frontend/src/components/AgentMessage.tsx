import React from 'react'
import { StreamEvent } from '../hooks/useAgentStream'
import Renderer from '../a2ui/Renderer'
import { A2uiTree } from '../a2ui/types'
import AgentErrorBoundary from './AgentErrorBoundary'
import styles from './AgentMessage.module.css'

interface Props {
  events: StreamEvent[]
  streaming?: boolean
  onAnswer: (answer: string, questionCardId: string) => void
  onIntent?: (intent: string, payload?: unknown) => void
  onShuffleMessage?: (productName: string) => void
}

function AgentMessageImpl({ events, onAnswer, onIntent, onShuffleMessage }: Props) {
  const rendered: React.ReactNode[] = []
  const textBlocks: string[] = []

  function flushText(key: string) {
    if (textBlocks.length) {
      const content = textBlocks.splice(0).join('')
      rendered.push(
        <div key={key} className={styles.textBubble}>
          {renderBlocks(content)}
        </div>
      )
    }
  }

  // Latest ui_tree replaces any earlier one (full-replacement model for MVP)
  const uiTreeEvents = events.filter((e): e is Extract<StreamEvent, { type: 'ui_tree' }> => e.type === 'ui_tree')
  const latestTree: A2uiTree | null = uiTreeEvents.length
    ? { root: uiTreeEvents[uiTreeEvents.length - 1].root, components: uiTreeEvents[uiTreeEvents.length - 1].components }
    : null

  // Handle intents — special-case answer_choice to wire into existing question flow
  const intentHandler = (intent: string, payload?: unknown) => {
    if (intent === 'answer_choice' && payload && typeof payload === 'object') {
      const p = payload as { question_id?: string; choice?: string }
      if (p.question_id && p.choice) {
        onAnswer(p.choice, p.question_id)
        return
      }
    }
    onIntent?.(intent, payload)
  }

  // Stream incremental text from `text` events into a paragraph above the tree.
  events.forEach(event => {
    if (event.type === 'text') {
      textBlocks.push(event.content)
    }
  })
  flushText('final')

  // Render the A2UI tree last (it's the main visual payload)
  if (latestTree) {
    rendered.push(
      <div key="ui-tree" className={styles.uiTreeWrapper}>
        <AgentErrorBoundary>
          <TreeWithQuestionCardAdapter
            tree={latestTree}
            intentHandler={intentHandler}
            onAnswer={onAnswer}
            onShuffleMessage={onShuffleMessage}
          />
        </AgentErrorBoundary>
      </div>
    )
  }

  return <div className={styles.wrapper}>{rendered}</div>
}

const AgentMessage = React.memo(AgentMessageImpl)
export default AgentMessage

// Split text into block-level chunks (paragraphs + pipe tables) and render each.
function renderBlocks(content: string): React.ReactNode[] {
  const lines = content.split('\n')
  const blocks: React.ReactNode[] = []
  let para: string[] = []
  let i = 0
  let key = 0

  const flushPara = () => {
    if (para.length) {
      const text = para.join('\n').replace(/^\n+|\n+$/g, '')
      if (text) {
        blocks.push(
          <p key={`p-${key++}`} className={styles.text}>
            {renderInlineMarkdown(text)}
          </p>
        )
      }
      para = []
    }
  }

  const isTableRow = (s: string) => /^\s*\|.*\|\s*$/.test(s)
  const isSeparatorRow = (s: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(s)

  while (i < lines.length) {
    const line = lines[i]
    // Detect a pipe table: 2+ consecutive pipe-rows. An optional separator row
    // (|---|---|) right after the header is skipped if present.
    if (
      isTableRow(line) &&
      i + 1 < lines.length &&
      (isTableRow(lines[i + 1]) || isSeparatorRow(lines[i + 1]))
    ) {
      flushPara()
      const header = parseRow(line)
      const bodyRows: string[][] = []
      let j = i + 1
      if (isSeparatorRow(lines[j])) j++
      while (j < lines.length && isTableRow(lines[j]) && !isSeparatorRow(lines[j])) {
        bodyRows.push(parseRow(lines[j]))
        j++
      }
      blocks.push(
        <table key={`t-${key++}`} className={styles.table}>
          <thead>
            <tr>
              {header.map((cell, ci) => (
                <th key={ci}>{renderInlineMarkdown(cell)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bodyRows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci}>{renderInlineMarkdown(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )
      i = j
      continue
    }
    para.push(line)
    i++
  }
  flushPara()
  return blocks
}

function parseRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\||\|$/g, '')
  return trimmed.split('|').map(c => c.trim())
}

// Lightweight inline markdown: **bold**, __bold__, *italic*, _italic_, `code`.
// Intentionally minimal — block-level markdown is not supported.
function renderInlineMarkdown(text: string): React.ReactNode[] {
  const tokens: React.ReactNode[] = []
  const pattern = /\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|(?<![A-Za-z0-9])_([^_]+)_(?![A-Za-z0-9])|`([^`]+)`/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(text.slice(lastIndex, match.index))
    }
    const [, bold1, bold2, ital1, ital2, code] = match
    if (bold1 != null || bold2 != null) {
      tokens.push(<strong key={`md-${key++}`}>{bold1 ?? bold2}</strong>)
    } else if (ital1 != null || ital2 != null) {
      tokens.push(<em key={`md-${key++}`}>{ital1 ?? ital2}</em>)
    } else if (code != null) {
      tokens.push(<code key={`md-${key++}`}>{code}</code>)
    }
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    tokens.push(text.slice(lastIndex))
  }
  return tokens
}

function TreeWithQuestionCardAdapter({
  tree,
  intentHandler,
  onAnswer,
  onShuffleMessage,
}: {
  tree: A2uiTree
  intentHandler: (intent: string, payload?: unknown) => void
  onAnswer: (answer: string, questionCardId: string) => void
  onShuffleMessage?: (productName: string) => void
}) {
  const patched: A2uiTree = {
    root: tree.root,
    components: (Array.isArray(tree.components) ? tree.components : []).map(c => {
      if (c.type === 'question_card') {
        return { ...c, props: { ...c.props, onAnswer } }
      }
      return c
    }),
  }
  return <Renderer tree={patched} onIntent={intentHandler} onShuffleMessage={onShuffleMessage} />
}
