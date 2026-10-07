import { Briefcase, Car, GraduationCap, HeartPulse, Home, PartyPopper, ShoppingBag, Tag, Tv, UtensilsCrossed, type LucideIcon } from 'lucide-react'
import { getCategory } from '../lib/categories'

const ICONS: Record<string, LucideIcon> = {
  utensils: UtensilsCrossed, car: Car, home: Home, party: PartyPopper, heart: HeartPulse,
  tv: Tv, bag: ShoppingBag, grad: GraduationCap, briefcase: Briefcase, tag: Tag,
}

/** Ícone da categoria num quadrado com a cor dela em baixa opacidade */
export function CategoryIcon({ category, size = 'md' }: { category?: string | null; size?: 'sm' | 'md' }) {
  const def = getCategory(category)
  const Icon = ICONS[def.icon] || Tag
  const box = size === 'sm' ? 'h-7 w-7 rounded-lg' : 'h-10 w-10 rounded-xl'
  const ico = size === 'sm' ? 'h-3.5 w-3.5' : 'h-[18px] w-[18px]'
  return (
    <span className={`inline-flex shrink-0 items-center justify-center ${box}`} style={{ background: `${def.color}1f`, color: def.color }}>
      <Icon className={ico} strokeWidth={2} />
    </span>
  )
}
