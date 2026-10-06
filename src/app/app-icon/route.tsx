import { ImageResponse } from 'next/og'
import { AppIcon } from '../../components/AppIcon'

// Ícone do app gerado em PNG (sem arquivos binários no repositório): /app-icon?size=192
export function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const size = Math.min(1024, Math.max(16, Number(searchParams.get('size')) || 512))
  const maskable = searchParams.get('maskable') === '1'
  return new ImageResponse(<AppIcon size={size} maskable={maskable} />, { width: size, height: size })
}
