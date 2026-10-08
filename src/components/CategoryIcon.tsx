import {
  Baby, BookOpen, Briefcase, Car, Coffee, Dog, Dumbbell, Fuel, Gamepad2, Gift, GraduationCap, HeartPulse, Home,
  Music, PartyPopper, PiggyBank, Plane, Scissors, Shirt, ShoppingBag, ShoppingCart, Smartphone, Tag, Tv, UtensilsCrossed, Wrench,
  type LucideIcon,
} from 'lucide-react'
import { getCategory } from '../lib/categories'

export const ICONS: Record<string, LucideIcon> = {
  utensils: UtensilsCrossed, car: Car, home: Home, party: PartyPopper, heart: HeartPulse,
  tv: Tv, bag: ShoppingBag, grad: GraduationCap, briefcase: Briefcase, tag: Tag,
  // para categorias personalizadas
  cart: ShoppingCart, coffee: Coffee, fuel: Fuel, plane: Plane, gift: Gift, dog: Dog, baby: Baby, dumbbell: Dumbbell,
  shirt: Shirt, wrench: Wrench, game: Gamepad2, music: Music, book: BookOpen, piggy: PiggyBank, phone: Smartphone, scissors: Scissors,
}

export const PICKER_ICONS = ['tag', 'cart', 'coffee', 'fuel', 'plane', 'gift', 'dog', 'baby', 'dumbbell', 'shirt', 'wrench', 'game', 'music', 'book', 'piggy', 'phone', 'scissors', 'home', 'car', 'heart']
export const PICKER_COLORS = ['#8b5cf6', '#ec4899', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#f43f5e', '#78716c']

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
