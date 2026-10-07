// Chamadas à API do Telegram (servidor). Requer TELEGRAM_BOT_TOKEN.
import type { Keyboard } from './telegramBot'

const token = () => process.env.TELEGRAM_BOT_TOKEN || ''

async function call(method: string, body: Record<string, unknown>): Promise<unknown> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => null)
    // "message is not modified" não é erro real
    if (!res.ok && !JSON.stringify(data).includes('not modified')) console.error(`Telegram ${method} falhou:`, res.status, data)
    return data
  } catch (err) {
    console.error(`Erro ao chamar Telegram ${method}:`, err)
    return null
  }
}

export function sendMessage(chatId: number, text: string, keyboard?: Keyboard) {
  return call('sendMessage', {
    chat_id: chatId, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true },
    ...(keyboard ? { reply_markup: keyboard } : {}),
  })
}

export function editMessage(chatId: number, messageId: number, text: string, keyboard?: Keyboard) {
  return call('editMessageText', {
    chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true },
    reply_markup: keyboard ?? { inline_keyboard: [] },
  })
}

export function editKeyboard(chatId: number, messageId: number, keyboard: Keyboard) {
  return call('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: keyboard })
}

export function answerCallback(id: string, text?: string) {
  return call('answerCallbackQuery', { callback_query_id: id, ...(text ? { text } : {}) })
}

export function sendTyping(chatId: number) {
  return call('sendChatAction', { chat_id: chatId, action: 'typing' })
}

/** Baixa um arquivo enviado ao bot (ex.: áudio de voz). Limite do Telegram: 20 MB. */
export async function downloadFile(fileId: string): Promise<Blob | null> {
  const info = (await call('getFile', { file_id: fileId })) as { ok?: boolean; result?: { file_path?: string } } | null
  const path = info?.result?.file_path
  if (!path) return null
  const res = await fetch(`https://api.telegram.org/file/bot${token()}/${path}`)
  return res.ok ? await res.blob() : null
}
