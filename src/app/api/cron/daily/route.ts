import { NextResponse } from 'next/server'
import { addDays, monthKeyOf, todayBR } from '../../../../lib/dates'
import { budgetStatus, pendingRecurring, recurringDay, type Recurring } from '../../../../lib/finance'
import { anomalyAlert, budgetAlertMessage, recapMessage, reminderMessage, subscriptionAlert, weeklyMessage } from '../../../../lib/telegramBot'
import { detectAnomalies, detectSubscriptions, monthRecap } from '../../../../lib/analysis'
import { addMonths } from '../../../../lib/dates'
import { sendMessage } from '../../../../lib/telegramApi'
import { adminDb, fetchBudgets, fetchRecurring, fetchTxs, fetchTxsBetween, findPartner, type Db } from '../../../../lib/botData'
import { notifyImported, syncConnection, type BankConnection } from '../../../../lib/bankSync'
import { pluggyEnabled } from '../../../../lib/pluggy'
import { computeNetWorth, saveSnapshot } from '../../../../lib/networth'

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
  const report = { users: 0, reminders: 0, weekly: 0, budgetAlerts: 0, insights: 0, bankImported: 0 }

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
    // foto diária do patrimônio (uma por usuário com banco)
    for (const uid of [...new Set(((banks || []) as BankConnection[]).map((b) => b.user_id))]) {
      try { const nw = await computeNetWorth(db, uid); if (nw) await saveSnapshot(db, uid, nw) } catch (e) { console.error('Cron: patrimônio', uid, e) }
    }
  }

  for (const c of connections || []) {
    report.users++
    try {
      const r = await runForUser(db, Number(c.telegram_chat_id), c.user_id)
      report.reminders += r.reminders
      report.weekly += r.weekly
      report.budgetAlerts += r.budgetAlerts
      report.insights += r.insights
    } catch (e) {
      console.error('Cron: erro para usuário', c.user_id, e)
    }
  }
  console.log('Cron diário:', report)
  return NextResponse.json({ ok: true, ...report })
}

async function runForUser(db: Db, chatId: number, userId: string) {
  const out = { reminders: 0, weekly: 0, budgetAlerts: 0, insights: 0 }
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
  // 4. Dia 1: retrospectiva do mês anterior
  if (today.endsWith('-01')) {
    const prevKey = addMonths(key, -1)
    const [hist, goals] = await Promise.all([
      fetchTxs(db, userId, addMonths(prevKey, -1), prevKey),
      db.from('goals').select('title, saved_amount, target_amount').eq('user_id', userId).then(({ data }) => data || []),
    ])
    await sendMessage(chatId, recapMessage(monthRecap(hist, budgets, prevKey), goals))
    out.insights++
  }

  // 5. Assinaturas (aumento / duplicada) e gastos fora do padrão — cada aviso uma única vez
  const longTxs = await fetchTxsBetween(db, userId, addDays(today, -400), today)
  const once = async (category: string, period: string) => {
    const { data } = await db.from('budget_alerts').upsert({ user_id: userId, category, month: period, level: 1 }, { onConflict: 'user_id,category,month,level', ignoreDuplicates: true }).select('level')
    return !!data?.length
  }
  for (const sub of detectSubscriptions(longTxs, recurring, today)) {
    if (sub.increased && sub.lastDate >= addDays(today, -10) && await once(`assinatura-aumento:${sub.key}`, sub.lastDate.slice(0, 7))) { await sendMessage(chatId, subscriptionAlert(sub, 'aumento')); out.insights++ }
    if (sub.duplicate && sub.duplicate.date >= addDays(today, -10) && await once(`assinatura-duplicada:${sub.key}`, sub.duplicate.date)) { await sendMessage(chatId, subscriptionAlert(sub, 'duplicada')); out.insights++ }
  }
  const week = `${today.slice(0, 4)}-S${String(Math.ceil((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${today.slice(0, 4)}-01-01T00:00:00Z`)) / 604800000)).padStart(2, '0')}`
  for (const a of detectAnomalies(longTxs, today)) {
    if (await once(`anomalia:${a.key}`, week)) { await sendMessage(chatId, anomalyAlert(a)); out.insights++ }
  }
  return out
}
