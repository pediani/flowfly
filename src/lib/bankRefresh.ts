// Pede à Pluggy uma nova sincronização com o banco (PATCH /items/:id).
import type { Db } from './botData'
import { ensureWebhook, getItem, updateItem } from './pluggy'

export type RefreshResult = { id: string; institution: string | null; ok: boolean; status?: string; error?: string }

export async function refreshConnections(db: Db, conns: { id: string; item_id: string; institution: string | null }[], opts: { minAgeHours?: number; webhookUrl?: string } = {}): Promise<RefreshResult[]> {
  const secret = process.env.PLUGGY_WEBHOOK_SECRET || process.env.CRON_SECRET
  if (opts.webhookUrl && secret) {
    // garante o aviso "item/updated" para importar assim que a atualização terminar
    try { await ensureWebhook(opts.webhookUrl, secret) } catch (e) { console.error('Webhook Pluggy:', e) }
  }
  const out: RefreshResult[] = []
  for (const c of conns) {
    try {
      if (opts.minAgeHours) {
        const item = await getItem(c.item_id)
        const age = item.lastUpdatedAt ? (Date.now() - Date.parse(item.lastUpdatedAt)) / 3600000 : 99
        if (item.status === 'UPDATING' || age < opts.minAgeHours) { out.push({ id: c.id, institution: c.institution, ok: true, status: `pulado (${item.status}, ${age.toFixed(1)}h)` }); continue }
      }
      const item = await updateItem(c.item_id)
      out.push({ id: c.id, institution: c.institution, ok: true, status: item.status })
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e)
      out.push({ id: c.id, institution: c.institution, ok: false, error: /429|once per hour|rate/i.test(msg) ? 'limite da Pluggy: no máximo 1 atualização por hora' : msg.slice(0, 200) })
    }
  }
  void db
  return out
}
