import { ComponentType } from 'react'
import ProductCard from '../components/ProductCard'
import ShopCard from '../components/ShopCard'
import QuestionCard from '../components/QuestionCard'
import PlanDropdown from '../components/PlanDropdown'
import Stack from '../components/a2ui/Stack'
import TextBlock from '../components/a2ui/TextBlock'
import ReasoningBlock from '../components/a2ui/ReasoningBlock'
import ProductGrid from '../components/a2ui/ProductGrid'
import ComparisonTable from '../components/a2ui/ComparisonTable'
import MultipleChoice from '../components/a2ui/MultipleChoice'
import ProductDetailsModal from '../components/a2ui/ProductDetailsModal'
import NextActions from '../components/a2ui/NextActions'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const REGISTRY: Record<string, ComponentType<any>> = {
  stack: Stack,
  text_block: TextBlock,
  reasoning_block: ReasoningBlock,
  product_card: ProductCard,
  product_grid: ProductGrid,
  comparison_table: ComparisonTable,
  multiple_choice: MultipleChoice,
  question_card: QuestionCard,
  product_details_modal: ProductDetailsModal,
  next_actions: NextActions,
  shop_card: ShopCard,
  plan: PlanDropdown,
}
