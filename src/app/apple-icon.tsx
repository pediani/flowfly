import { ImageResponse } from 'next/og'
import { AppIcon } from '../components/AppIcon'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

// iOS aplica as bordas arredondadas sozinho: fundo cheio
export default function AppleIcon() {
  return new ImageResponse(<AppIcon size={180} maskable />, size)
}
