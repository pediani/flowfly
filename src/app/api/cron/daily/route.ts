import { NextResponse } from 'next/server'
import { addDays, monthKeyOf, todayBR } from '../../../../lib/dates'
import { budgetStatus, pendingRecurring, recurringDay, type Recurring } from '../../../../lib/finance'
import { budgetAlertMessage, reminderMessage, weeklyMessage } from '../../../../lib/telegramBot'
import { sendMessage } from '../../../../lib/telegramApi'
import { adminDb, fetchBudgets, fetchRecurring, fetchTxs, fetchTxsBetween, findPartner, type Db } from '../../../../lib/botData'
import { notifyImported, syncConnection, type BankConnection } from '../../../../lib/bankSync'
import { pluggyEnabled } from '../../../../lib/pluggy'

// Roda todo dia às 12:00 UTC (9h em Brasília) — ver vercel.json.
// A Vercel envia "Authorization: Bearer <CRON_SECRET>".
export const maxDuration = 60

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  if (!adminDb) return NextResponse.json({ ok: false, error: 'Supabase não configurado' }, { status: 500 })

  const db = adminDb
  const { data: connections } = await db.from('telegram_connections').select('telegram_chat_id, user_id')
  const report = { users: 0, reminders: 0, weekly: 0, budgetAlerts: 0, bankImported: 0 }

  // Bancos (Pluggy): garante a sincronização diária mesmo se algum webhook falhar
  if (pluggyEnabled()) {
    const { data: banks } = await db.from('bank_connections').select('*')
    for (const b of (banks || []) as BankConnection[]) {
      try {
        const r = await syncConnection(db, b)
        report.bankImported += r.imported.length
        await notifyImported(db, b.user_id, r.imported, !!(await findPartner(db, b.user_id)))
      } catch (e) {
        console.error('Cron: sync Pluggy falhou', b.item_id, e)
      }
    }
  }

  for (const c of connections || []) {
    report.users++
    try {
      const r = await runForUser(db, Number(c.telegram_chat_id), c.user_id)
      report.reminders += r.reminders
      report.weekly += r.weekly
      report.budgetAlerts += r.budgetAlerts
    } catch (e) {
      console.error('Cron: erro para usuário', c.user_id, e)
    }
  }
  console.log('Cron diário:', report)
  return NextResponse.json({ ok: true, ...report })
}

async function runForUser(db: Db, chatId: number, userId: string) {
  const out = { reminders: 0, weekly: 0, budgetAlerts: 0 }
  const today = todayBR()
  const tomorrow = addDays(today, 1)
  const key = monthKeyOf(today)
  const [recurring, monthTxs, budgets] = await Promise.all([fetchRecurring(db, userId), fetchTxs(db, userId, key), fetchBudgets(db, userId)])

  // 1. Contas fixas que vencem hoje ou amanhã e ainda não foram lançadas
  const items: { r: Recurring; when: 'hoje' | 'amanhã' }[] = []
  const pendingNow = pendingRecurring(monthTxs, recurring, key)
  for (const r of pendingNow) if (recurringDay(r, key) === Number(today.slice(8))) items.push({ r, when: 'hoje' })
  const tKey = monthKeyOf(tomorrow)
  const pendingTomorrow = tKey === key ? pendingNow : pendingRecurring(await fetchTxs(db, userId, tKey), recurring, tKey)
  for (const r of pendingTomorrow) if (recurringDay(r, tKey) === Number(tomorrow.slice(8)) && !items.some((i) => i.r.id === r.id)) items.push({ r, when: 'amanhã' })
  if (items.length) {
    const { text, keyboard } = reminderMessage(items)
    await sendMessage(chatId, text, keyboard)
    out.reminders = items.length
  }

  // 2. Domingo: resumo da semana anterior (domingo a sábado)
  const [y, m, d] = today.split('-').map(Number)
  if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 0) {
    const from = addDays(today, -7)
    const to = addDays(today, -1)
    await sendMessage(chatId, weeklyMessage(await fetchTxsBetween(db, userId, from, to), from, to))
    out.weekly = 1
  }

  // 3. Orçamentos que passaram de 80% / 100% (avisa uma vez por nível por mês)
  for (const b of budgetStatus(monthTxs, budgets, key)) {
    const level = b.pct >= 100 ? 100 : b.pct >= 80 ? 80 : 0
    if (!level) continue
    const levels = level === 100 ? [80, 100] : [80]
    const { data: inserted } = await db.from('budget_alerts')
      .upsert(levels.map((l) => ({ user_id: userId, category: b.category, month: key, level: l })), { onConflict: 'user_id,category,month,level', ignoreDuplicates: true })
      .select('level')
    if (inserted?.some((x) => x.level === level)) {
      await sendMessage(chatId, budgetAlertMessage(b.category, b.spent, b.limit, level))
      out.budgetAlerts++
    }
  }
  return out
}
