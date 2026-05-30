export interface A2uiComponent {
  id: string
  type: string
  props: Record<string, unknown>
  children?: string[]
}

export interface A2uiTree {
  root: string
  components: A2uiComponent[]
}

export type IntentHandler = (intent: string, payload?: unknown) => void
