// Ícone do FlowNanças: "F" da Pacifico em branco num quadrado roxo (ImageResponse: só estilos inline e flexbox)
import { F_PATH } from './brandPaths'

export function AppIcon({ size, maskable = false }: { size: number; maskable?: boolean }) {
  const inner = maskable ? size : size * 0.86
  const mark = maskable ? size * 0.62 : inner * 0.78
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: maskable ? '#5b3df5' : 'transparent' }}>
      <div
        style={{
          width: inner, height: inner, borderRadius: maskable ? 0 : inner * 0.26, display: 'flex', alignItems: 'center', justifyContent: 'center',
          backgroundImage: 'linear-gradient(140deg, #8b6dff 0%, #5b3df5 60%, #3f25c9 100%)',
        }}
      >
        <svg width={mark} height={mark} viewBox="0 0 100 100">
          <path d={F_PATH} fill="#ffffff" />
        </svg>
      </div>
    </div>
  )
}
