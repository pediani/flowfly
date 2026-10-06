// Ícone do FlowFly (usado em ImageResponse: só estilos inline e flexbox)
export function AppIcon({ size, maskable = false }: { size: number; maskable?: boolean }) {
  const inner = maskable ? size * 0.62 : size * 0.78
  return (
    <div
      style={{
        width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: maskable ? '#2a1f3d' : 'transparent',
      }}
    >
      <div
        style={{
          width: inner, height: inner, borderRadius: inner * 0.28, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'linear-gradient(135deg, #c7b3f7 0%, #9a7ae6 55%, #6c4fc4 100%)',
          boxShadow: '0 0 0 rgba(0,0,0,0)',
        }}
      >
        <svg width={inner * 0.56} height={inner * 0.56} viewBox="0 0 24 24" fill="none">
          <path d="M13 2L4.5 13.5H11L10 22L19.5 10H13L13 2Z" fill="#fffaf2" stroke="#2a1f3d" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  )
}
