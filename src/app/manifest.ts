import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'FlowNanças · Financeiro',
    short_name: 'FlowNanças',
    description: 'Controle financeiro pessoal e do casal',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#09090b',
    theme_color: '#09090b',
    lang: 'pt-BR',
    icons: [
      { src: '/app-icon?size=192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/app-icon?size=512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/app-icon?size=512&maskable=1', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
