// Ícone do FlowNanças: "F" branco cartoon num quadrado roxo (ImageResponse: só estilos inline e flexbox)
import { F_OUTLINE, F_PATH, F_SWOOSH } from './brandPaths'

export function AppIcon({ size, maskable = false }: { size: number; maskable?: boolean }) {
  const inner = maskable ? size : size * 0.86
  const mark = maskable ? size * 0.62 : inner * 0.8
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: maskable ? '#6d4dff' : 'transparent' }}>
      <div
        style={{
          width: inner, height: inner, borderRadius: maskable ? 0 : inner * 0.26, display: 'flex', alignItems: 'center', justifyContent: 'center',
          backgroundImage: 'linear-gradient(140deg, #9a7dff 0%, #6d4dff 55%, #4a2be0 100%)',
        }}
      >
        <svg width={mark} height={mark} viewBox="0 0 100 100">
          <g transform="rotate(-6 50 50)">
            <path d={F_PATH} transform="translate(3 4)" fill="rgba(20,8,60,0.35)" />
            <path d={F_OUTLINE} fill="none" stroke="#2a1670" strokeWidth="7" strokeLinejoin="round" />
            <path d={F_PATH} fill="#ffffff" />
            <path d={F_SWOOSH} fill="none" stroke="#ffffff" strokeWidth="5" strokeLinecap="round" opacity="0.65" />
          </g>
        </svg>
      </div>
    </div>
  )
}
