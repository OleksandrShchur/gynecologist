import { Baby, Flower2, HeartHandshake, MessagesSquare, ScanHeart, Scissors } from 'lucide-react'
import type { DirectionIcon as IconName } from '../content/site'

const icons = {
  surgery: Scissors,
  pregnancy: HeartHandshake,
  birth: Baby,
  conversation: MessagesSquare,
  examination: ScanHeart,
  pediatric: Flower2,
} satisfies Record<IconName, typeof Scissors>

export function DirectionIcon({ name }: { name: IconName }) {
  const Icon = icons[name]
  return <Icon size={29} strokeWidth={1.3} aria-hidden="true" />
}
