import type { Metadata, Viewport } from 'next'
import { Inter, Fraunces } from 'next/font/google'
import { themeInitScript } from '../lib/theme'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const fraunces = Fraunces({ subsets: ['latin'], variable: '--font-fraunces', axes: ['SOFT', 'opsz'] })

export const metadata: Metadata = {
  title: 'FlowFly · Financeiro',
  description: 'Controle financeiro pessoal e do casal, com registro pelo Telegram',
  applicationName: 'FlowFly',
  appleWebApp: { capable: true, title: 'FlowFly', statusBarStyle: 'black-translucent' },
  formatDetection: { telephone: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#15121c' },
    { media: '(prefers-color-scheme: light)', color: '#f5efe6' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" data-theme="dark" suppressHydrationWarning className={`${inter.variable} ${fraunces.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  )
}
