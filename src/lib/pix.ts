// Pix "copia e cola" (BR Code estático, padrão EMV do Banco Central)

const emv = (id: string, value: string) => `${id}${String(value.length).padStart(2, '0')}${value}`
const ascii = (s: string, max: number) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 .\-]/g, '').toUpperCase().slice(0, max).trim()

function crc16(payload: string): string {
  let crc = 0xffff
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8
    for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

/** Normaliza a chave: telefone vira +55DDDNNNNNNNN, CPF/CNPJ só dígitos, e-mail e aleatória como estão. */
export function normalizePixKey(key: string): string {
  const k = key.trim()
  if (/@/.test(k)) return k.toLowerCase()
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)) return k.toLowerCase()
  const digits = k.replace(/\D/g, '')
  if (/^\+/.test(k) || (digits.length === 13 && digits.startsWith('55'))) return `+${digits}`
  // celular: "(11) 98765-4321", "11 98765-4321", "11987654321" (sem pontos, 3º dígito 9)
  if (digits.length === 11 && !/\./.test(k) && digits[2] === '9' && (/[()\s]/.test(k) || /\d{4,5}-\d{4}$/.test(k) || /^\d{11}$/.test(k))) return `+55${digits}`
  return digits // CPF (11) ou CNPJ (14)
}

export function pixCopiaECola(opts: { key: string; name: string; city?: string; amount?: number; description?: string }): string {
  const account = emv('00', 'br.gov.bcb.pix') + emv('01', normalizePixKey(opts.key)) + (opts.description ? emv('02', ascii(opts.description, 40)) : '')
  const payload =
    emv('00', '01') +
    emv('26', account) +
    emv('52', '0000') +
    emv('53', '986') +
    (opts.amount && opts.amount > 0 ? emv('54', opts.amount.toFixed(2)) : '') +
    emv('58', 'BR') +
    emv('59', ascii(opts.name || 'FLOWFLY', 25) || 'FLOWFLY') +
    emv('60', ascii(opts.city || 'BRASIL', 15) || 'BRASIL') +
    emv('62', emv('05', '***')) +
    '6304'
  return payload + crc16(payload)
}
