'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { todayBR, formatDateBR } from '../lib/dates'
import ConnectionsPanel, { type Partnership } from '../components/ConnectionsPanel'
import { PieChart, Pie, Cell, Tooltip as PieTooltip, ResponsiveContainer } from 'recharts'
import { 
  LayoutDashboard, Calendar, LogOut, 
  TrendingDown, TrendingUp, ArrowRightLeft, AlertCircle, 
  Trash2, CheckCircle2, Zap, PlusCircle, Mail, Users, Lock, Send
} from 'lucide-react'

const CATEGORIAS = ['Geral', 'Alimentação', 'Transporte', 'Casa', 'Lazer', 'Saúde', 'Assinaturas']
const PIE_COLORS = ['#3b82f6', '#10b981', '#f43f5e', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6']

export default function Home() {
  const [session, setSession] = useState<any>(undefined) 
  const [activeTab, setActiveTab] = useState<'dashboard' | 'fixas' | 'conexoes'>('dashboard')
  
  // Estados de Login
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [isSignUp, setIsSignUp] = useState(false)

  // Estados do Formulário de Transações
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState('saida')
  const [category, setCategory] = useState('Geral')
  const [isSplit, setIsSplit] = useState(false)
  const [splitPartnerId, setSplitPartnerId] = useState('')
  const [transactions, setTransactions] = useState<any[]>([])
  
  // Estados de Contas Fixas
  const [recAmount, setRecAmount] = useState('')
  const [recDescription, setRecDescription] = useState('')
  const [recType, setRecType] = useState('saida')
  const [recDay, setRecDay] = useState('5')
  const [recurring, setRecurring] = useState<any[]>([])

  // Parceiros aceitos, disponíveis para divisão
  const [usersList, setUsersList] = useState<Partnership[]>([])

  const [loading, setLoading] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session || null)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session || null)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session) {
      fetchTransactions()
      fetchRecurring()
      fetchUsers()
    }
  }, [session])

  async function fetchUsers() {
    const { data } = await supabase.rpc('list_partnerships')
    const accepted = ((data as Partnership[]) || []).filter(p => p.status === 'accepted')
    setUsersList(accepted)
    setSplitPartnerId(prev => accepted.some(p => p.partner_id === prev) ? prev : (accepted[0]?.partner_id || ''))
  }

  async function handlePasswordAuth(e: React.FormEvent) {
    e.preventDefault()
    setAuthLoading(true)

    if (isSignUp) {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) {
        alert(error.message)
      } else {
        alert('Conta criada com sucesso! Já podes entrar.')
        setIsSignUp(false)
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        alert('Erro ao entrar: ' + error.message)
      }
    }
    setAuthLoading(false)
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault()
    setAuthLoading(true)
    const { error } = await supabase.auth.signInWithOtp({ email })
    if (error) {
      alert(error.message)
    } else {
      alert('Link mágico enviado! Verifique o seu e-mail.')
      setEmail('')
    }
    setAuthLoading(false)
  }

  async function fetchTransactions() {
    const { data } = await supabase.from('transactions').select('*').order('date', { ascending: false })
    if (data) setTransactions(data)
  }

  async function fetchRecurring() {
    const { data } = await supabase.from('recurring_transactions').select('*').order('day_of_month', { ascending: true })
    if (data) setRecurring(data)
  }

  async function handleAddTransaction(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const value = parseFloat(amount.replace(',', '.'))
    const split = isSplit && type === 'saida'

    if (split && !splitPartnerId) {
      alert('Adicione um parceiro na aba Conexões para dividir despesas.')
      setLoading(false)
      return
    }

    // Divisão: a função no banco grava as duas linhas juntas e valida a parceria
    const { error } = split
      ? await supabase.rpc('create_split_transaction', {
          p_amount: value, p_description: description, p_category: category, p_partner_id: splitPartnerId
        })
      : await supabase.from('transactions').insert({
          user_id: session.user.id,
          amount: value,
          description,
          type,
          category,
          is_split: false,
          date: todayBR()
        })

    if (error) alert(`Erro ao salvar: ${error.message}`)

    if (!error) { 
      setAmount(''); setDescription(''); setCategory('Geral'); setIsSplit(false); fetchTransactions() 
    }
    setLoading(false)
  }

  async function handleDeleteTransaction(id: string) {
    if (!confirm('Excluir este lançamento?')) return
    await supabase.from('transactions').delete().eq('id', id)
    fetchTransactions()
  }

  async function handlePayDebt(id: string) {
    await supabase.from('transactions').update({ type: 'saida' }).eq('id', id)
    fetchTransactions()
  }

  async function handleAddRecurring(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const value = parseFloat(recAmount.replace(',', '.'))
    const { error } = await supabase.from('recurring_transactions').insert({
      user_id: session.user.id, amount: value, description: recDescription, type: recType, day_of_month: parseInt(recDay)
    })
    if (!error) { setRecAmount(''); setRecDescription(''); setRecDay('5'); fetchRecurring() }
    setLoading(false)
  }

  async function handleDeleteRecurring(id: string) {
    if (!confirm('Deseja excluir esta conta fixa?')) return
    await supabase.from('recurring_transactions').delete().eq('id', id)
    fetchRecurring()
  }

  // --- MATEMÁTICA ---
  const entradas = transactions.filter(t => t.type === 'entrada').reduce((acc, curr) => acc + curr.amount, 0)
  const saidas = transactions.filter(t => t.type === 'saida').reduce((acc, curr) => acc + curr.amount, 0)
  const saldo = entradas - saidas
  
  const aReceber = transactions.filter(t => t.type === 'saida' && t.is_split).reduce((acc, curr) => acc + (curr.amount / 2), 0)
  const aPagar = transactions.filter(t => t.type === 'a_pagar').reduce((acc, curr) => acc + curr.amount, 0)

  const despesasPorCategoria = transactions.filter(t => t.type === 'saida').reduce((acc, curr) => {
    acc[curr.category || 'Geral'] = (acc[curr.category || 'Geral'] || 0) + curr.amount
    return acc
  }, {} as Record<string, number>)
  
  const pieData = Object.keys(despesasPorCategoria).map(key => ({ name: key, value: despesasPorCategoria[key] })).sort((a, b) => b.value - a.value)

  if (session === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <div className="flex flex-col items-center gap-4">
          <Zap className="h-8 w-8 text-blue-500 animate-pulse" />
          <p className="text-sm text-zinc-500 font-medium tracking-widest uppercase">A iniciar FlowFly...</p>
        </div>
      </div>
    )
  }

  if (session === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 font-sans text-zinc-50">
        <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900 p-8 shadow-lg">
          <div className="flex flex-col items-center gap-2 text-center mb-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400">
              <Zap className="h-6 w-6" />
            </div>
            <h1 className="text-xl font-bold text-zinc-100 mt-2">FlowFly</h1>
            <p className="text-sm text-zinc-400">{isSignUp ? 'Crie a sua conta com senha' : 'Entre com e-mail e senha'}</p>
          </div>

          <form onSubmit={handlePasswordAuth} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-300">E-mail</label>
              <input 
                type="email" required 
                value={email} onChange={(e) => setEmail(e.target.value)} 
                placeholder="seu@email.com" 
                className="flex h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-300">Senha</label>
              <input 
                type="password" required 
                value={password} onChange={(e) => setPassword(e.target.value)} 
                placeholder="••••••••" 
                className="flex h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <button 
              type="submit" 
              disabled={authLoading} 
              className="inline-flex w-full items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
            >
              {authLoading ? 'A processar...' : (isSignUp ? 'Criar Conta' : 'Entrar')}
            </button>
          </form>

          <div className="mt-4 text-center">
            <button 
              onClick={() => setIsSignUp(!isSignUp)} 
              className="text-xs text-blue-400 hover:underline"
            >
              {isSignUp ? 'Já tem conta? Faça login' : 'Não tem conta? Cadastre-se com senha'}
            </button>
          </div>

          <div className="mt-6 pt-4 border-t border-zinc-800 text-center">
            <button 
              onClick={handleMagicLink} 
              disabled={authLoading || !email}
              className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Ou enviar Link Mágico por E-mail
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="grid min-h-screen w-full md:grid-cols-[240px_1fr] bg-zinc-950 text-zinc-50 font-sans">
      <aside className="hidden border-r border-zinc-800 bg-zinc-950 md:block">
        <div className="flex h-full max-h-screen flex-col gap-2">
          <div className="flex h-14 items-center border-b border-zinc-800 px-6 lg:h-[60px]">
            <div className="flex items-center gap-2.5 font-bold tracking-tight text-lg">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white">
                <Zap className="h-4 w-4" />
              </div>
              <span>FlowFly</span>
            </div>
          </div>
          <div className="flex-1 overflow-auto py-2">
            <nav className="grid items-start px-4 text-sm font-medium gap-1">
              <button 
                onClick={() => setActiveTab('dashboard')} 
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all ${activeTab === 'dashboard' ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-400 hover:text-zinc-50 hover:bg-zinc-900'}`}
              >
                <LayoutDashboard className="h-4 w-4" />
                Dashboard
              </button>
              <button 
                onClick={() => setActiveTab('fixas')} 
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all ${activeTab === 'fixas' ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-400 hover:text-zinc-50 hover:bg-zinc-900'}`}
              >
                <Calendar className="h-4 w-4" />
                Contas Fixas
              </button>
              <button 
                onClick={() => setActiveTab('conexoes')} 
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all ${activeTab === 'conexoes' ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-400 hover:text-zinc-50 hover:bg-zinc-900'}`}
              >
                <Send className="h-4 w-4" />
                Conexões
              </button>
            </nav>
          </div>
          <div className="mt-auto p-4 border-t border-zinc-800">
            <button 
              onClick={() => supabase.auth.signOut()} 
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-zinc-400 transition-all hover:text-zinc-50 hover:bg-zinc-900"
            >
              <LogOut className="h-4 w-4" />
              Sair da Sessão
            </button>
          </div>
        </div>
      </aside>

      <main className="flex flex-col">
        <header className="flex h-14 items-center gap-4 border-b border-zinc-800 bg-zinc-950 px-6 lg:h-[60px] justify-between">
          <h1 className="text-lg font-semibold tracking-tight">{activeTab === 'dashboard' ? 'Visão Geral' : activeTab === 'fixas' ? 'Contas Fixas' : 'Conexões'}</h1>
          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Saldo Disponível</span>
            <span className="text-sm font-bold text-zinc-100">R$ {saldo.toFixed(2)}</span>
          </div>
        </header>
        
        <div className="flex-1 space-y-6 p-6 md:p-8">
          
          {activeTab === 'dashboard' && (
            <>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-sm">
                  <div className="flex items-center justify-between space-y-0 pb-2">
                    <h3 className="tracking-tight text-sm font-medium text-zinc-400">Saídas (Mês)</h3>
                    <TrendingDown className="h-4 w-4 text-zinc-100" />
                  </div>
                  <div className="text-2xl font-bold text-zinc-100">R$ {saidas.toFixed(2)}</div>
                </div>
                
                <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-sm">
                  <div className="flex items-center justify-between space-y-0 pb-2">
                    <h3 className="tracking-tight text-sm font-medium text-zinc-400">Entradas</h3>
                    <TrendingUp className="h-4 w-4 text-zinc-100" />
                  </div>
                  <div className="text-2xl font-bold text-zinc-100">R$ {entradas.toFixed(2)}</div>
                </div>

                <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-sm">
                  <div className="flex items-center justify-between space-y-0 pb-2">
                    <h3 className="tracking-tight text-sm font-medium text-blue-400">A Receber</h3>
                    <ArrowRightLeft className="h-4 w-4 text-blue-400" />
                  </div>
                  <div className="text-2xl font-bold text-blue-400">R$ {aReceber.toFixed(2)}</div>
                </div>

                <div className="rounded-xl border border-red-900/30 bg-red-950/10 p-6 shadow-sm">
                  <div className="flex items-center justify-between space-y-0 pb-2">
                    <h3 className="tracking-tight text-sm font-medium text-red-400">A Pagar (Dívidas)</h3>
                    <AlertCircle className="h-4 w-4 text-red-400" />
                  </div>
                  <div className="text-2xl font-bold text-red-500">R$ {aPagar.toFixed(2)}</div>
                </div>
              </div>

              <div className="grid gap-6 md:grid-cols-1 lg:grid-cols-3">
                <div className="lg:col-span-2 space-y-6">
                  <div className="rounded-xl border border-zinc-800 bg-zinc-900 shadow-sm flex flex-col md:flex-row">
                    <div className="p-6 flex-1 border-b md:border-b-0 md:border-r border-zinc-800">
                      <h3 className="font-semibold leading-none tracking-tight mb-4">Distribuição de Gastos</h3>
                      <div className="h-[220px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={pieData} cx="50%" cy="50%" innerRadius={65} outerRadius={85} paddingAngle={2} dataKey="value" stroke="none">
                              {pieData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                              ))}
                            </Pie>
                            <PieTooltip formatter={(value: any) => `R$ ${Number(value).toFixed(2)}`} contentStyle={{ backgroundColor: '#09090b', borderRadius: '8px', border: '1px solid #27272a', color: '#fafafa' }} itemStyle={{ color: '#fafafa' }} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                    <div className="p-6 w-full md:w-64">
                      <h4 className="text-xs font-semibold uppercase text-zinc-500 mb-4 tracking-wider">Legenda</h4>
                      <div className="space-y-3 overflow-y-auto max-h-[220px] pr-2">
                        {pieData.map((entry, index) => (
                          <div key={entry.name} className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }} />
                              <span className="text-zinc-300 font-medium">{entry.name}</span>
                            </div>
                            <span className="text-zinc-100">R$ {entry.value.toFixed(0)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-zinc-800 bg-zinc-900 shadow-sm overflow-hidden">
                    <div className="p-6 border-b border-zinc-800">
                      <h3 className="font-semibold leading-none tracking-tight">Últimos Lançamentos</h3>
                    </div>
                    <div className="p-0 overflow-x-auto max-h-[400px]">
                      <table className="w-full text-sm text-left">
                        <thead className="text-xs text-zinc-400 uppercase bg-zinc-900/50 border-b border-zinc-800 sticky top-0 backdrop-blur-md">
                          <tr>
                            <th className="px-6 py-4 font-medium">Descrição</th>
                            <th className="px-6 py-4 font-medium">Categoria</th>
                            <th className="px-6 py-4 font-medium">Data</th>
                            <th className="px-6 py-4 font-medium">Status</th>
                            <th className="px-6 py-4 font-medium text-right">Valor</th>
                            <th className="px-6 py-4 font-medium text-center">Ações</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800">
                          {transactions.map(t => (
                            <tr key={t.id} className={`hover:bg-zinc-800/50 transition-colors ${t.type === 'a_pagar' ? 'bg-red-950/10' : ''}`}>
                              <td className="px-6 py-4 font-medium text-zinc-100">{t.description}</td>
                              <td className="px-6 py-4 text-zinc-400">{t.category}</td>
                              <td className="px-6 py-4 text-zinc-400">{formatDateBR(t.date)}</td>
                              <td className="px-6 py-4">
                                {t.type === 'a_pagar' ? (
                                  <span className="inline-flex items-center rounded-md border border-red-800/50 bg-red-900/20 px-2 py-0.5 text-xs font-semibold text-red-400">Pendente</span>
                                ) : t.is_split ? (
                                  <span className="inline-flex items-center rounded-md border border-blue-800/50 bg-blue-900/20 px-2 py-0.5 text-xs font-semibold text-blue-400">Rachado</span>
                                ) : (
                                  <span className="inline-flex items-center text-zinc-500 text-xs font-medium">Regular</span>
                                )}
                              </td>
                              <td className={`px-6 py-4 text-right font-medium ${t.type === 'entrada' ? 'text-emerald-400' : 'text-zinc-100'}`}>
                                {t.type === 'entrada' ? '+' : '-'} R$ {t.amount.toFixed(2)}
                              </td>
                              <td className="px-6 py-4 text-center">
                                <div className="flex items-center justify-center gap-2">
                                  {t.type === 'a_pagar' && (
                                    <button onClick={() => handlePayDebt(t.id)} className="text-emerald-500 hover:text-emerald-400 transition-colors" title="Marcar como Pago">
                                      <CheckCircle2 className="h-4 w-4" />
                                    </button>
                                  )}
                                  <button onClick={() => handleDeleteTransaction(t.id)} className="text-zinc-500 hover:text-red-400 transition-colors" title="Eliminar">
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-zinc-800 bg-zinc-900 shadow-sm h-fit">
                  <div className="p-6 border-b border-zinc-800">
                    <h3 className="font-semibold leading-none tracking-tight">Novo Lançamento</h3>
                    <p className="text-sm text-zinc-400 mt-2">Adicione uma nova transação ao fluxo.</p>
                  </div>
                  <div className="p-6">
                    <form onSubmit={handleAddTransaction} className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium leading-none text-zinc-300">Tipo da Transação</label>
                        <select 
                          value={type} 
                          onChange={(e) => setType(e.target.value)}
                          className="flex h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
                        >
                          <option value="saida">Saída / Despesa</option>
                          <option value="entrada">Entrada / Receita</option>
                        </select>
                      </div>
                      
                      <div className="space-y-2">
                        <label className="text-sm font-medium leading-none text-zinc-300">Categoria</label>
                        <select 
                          value={category} 
                          onChange={(e) => setCategory(e.target.value)}
                          className="flex h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
                        >
                          {CATEGORIAS.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                        </select>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium leading-none text-zinc-300">Valor (R$)</label>
                        <input 
                          type="number" step="0.01" required 
                          value={amount} onChange={(e) => setAmount(e.target.value)} 
                          placeholder="0.00" 
                          className="flex h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium leading-none text-zinc-300">Descrição</label>
                        <input 
                          type="text" required 
                          value={description} onChange={(e) => setDescription(e.target.value)} 
                          placeholder="Ex: Supermercado" 
                          className="flex h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
                        />
                      </div>

                      {type === 'saida' && (
                        <div className="space-y-3 pt-2 border-t border-zinc-800">
                          <div className="flex items-center space-x-2">
                            <input 
                              type="checkbox" 
                              id="split"
                              checked={isSplit} 
                              onChange={(e) => setIsSplit(e.target.checked)} 
                              className="h-4 w-4 rounded border-zinc-800 bg-zinc-950 text-blue-600 focus:ring-1 focus:ring-blue-500 accent-blue-600"
                            />
                            <label htmlFor="split" className="text-sm font-medium leading-none text-zinc-300 cursor-pointer">
                              Dividir despesa (50%)
                            </label>
                          </div>

                          {isSplit && (
                            <div className="space-y-2 pt-1">
                              <label className="text-xs font-medium text-zinc-400 flex items-center gap-1.5">
                                <Users className="h-3.5 w-3.5" /> Selecionar com quem dividir:
                              </label>
                              <select 
                                value={splitPartnerId} 
                                onChange={(e) => setSplitPartnerId(e.target.value)}
                                className="flex h-9 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 text-zinc-200"
                              >
                                {usersList.length === 0 ? (
                                  <option value="">Nenhum parceiro — adicione na aba Conexões</option>
                                ) : (
                                  usersList.map((u) => (
                                    <option key={u.partner_id} value={u.partner_id}>
                                      {u.partner_email}
                                    </option>
                                  ))
                                )}
                              </select>
                            </div>
                          )}
                        </div>
                      )}

                      <button 
                        type="submit" 
                        disabled={loading} 
                        className="inline-flex w-full items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:pointer-events-none disabled:opacity-50 mt-2"
                      >
                        {loading ? 'A processar...' : (
                          <>
                            <PlusCircle className="mr-2 h-4 w-4" />
                            Guardar Registo
                          </>
                        )}
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            </>
          )}

          {activeTab === 'fixas' && (
            <div className="grid gap-6 md:grid-cols-1 lg:grid-cols-3">
              <div className="rounded-xl border border-zinc-800 bg-zinc-900 shadow-sm h-fit">
                <div className="p-6 border-b border-zinc-800">
                  <h3 className="font-semibold leading-none tracking-tight">Nova Conta Fixa</h3>
                  <p className="text-sm text-zinc-400 mt-2">Cadastre compromissos mensais recorrentes.</p>
                </div>
                <div className="p-6">
                  <form onSubmit={handleAddRecurring} className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium leading-none text-zinc-300">Tipo</label>
                      <select 
                        value={recType} 
                        onChange={(e) => setRecType(e.target.value)}
                        className="flex h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        <option value="saida">Saída (Gasto Fixo)</option>
                        <option value="entrada">Entrada (Salário/Renda)</option>
                      </select>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium leading-none text-zinc-300">Dia do Vencimento (1 a 31)</label>
                      <input 
                        type="number" min="1" max="31" required 
                        value={recDay} onChange={(e) => setRecDay(e.target.value)} 
                        className="flex h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium leading-none text-zinc-300">Valor (R$)</label>
                      <input 
                        type="number" step="0.01" required 
                        value={recAmount} onChange={(e) => setRecAmount(e.target.value)} 
                        placeholder="0.00" 
                        className="flex h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium leading-none text-zinc-300">Descrição</label>
                      <input 
                        type="text" required 
                        value={recDescription} onChange={(e) => setRecDescription(e.target.value)} 
                        placeholder="Ex: Aluguel, Internet..." 
                        className="flex h-10 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>

                    <button 
                      type="submit" 
                      disabled={loading} 
                      className="inline-flex w-full items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50 mt-2"
                    >
                      <PlusCircle className="mr-2 h-4 w-4" />
                      Salvar Conta Fixa
                    </button>
                  </form>
                </div>
              </div>

              <div className="lg:col-span-2 rounded-xl border border-zinc-800 bg-zinc-900 shadow-sm overflow-hidden h-fit">
                <div className="p-6 border-b border-zinc-800">
                  <h3 className="font-semibold leading-none tracking-tight">Contas Fixas Cadastradas</h3>
                </div>
                <div className="p-6">
                  <div className="space-y-3">
                    {recurring.length === 0 ? (
                      <p className="text-sm text-zinc-500">Nenhuma conta fixa registada.</p>
                    ) : (
                      recurring.map((rec) => (
                        <div key={rec.id} className="flex justify-between items-center p-4 bg-zinc-950/50 rounded-lg border border-zinc-800/80">
                          <div className="flex items-center gap-4">
                            <div className="flex flex-col items-center justify-center bg-zinc-900 border border-zinc-800 rounded-md w-12 h-12">
                              <span className="text-[10px] text-zinc-500 uppercase font-semibold">Dia</span>
                              <span className="font-bold text-zinc-100 text-sm">{rec.day_of_month}</span>
                            </div>
                            <div>
                              <p className="font-medium text-zinc-100">{rec.description}</p>
                              <p className="text-xs text-zinc-500">{rec.type === 'entrada' ? 'Recebimento Recorrente' : 'Gasto Fixo'}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-6">
                            <p className={`font-bold ${rec.type === 'entrada' ? 'text-emerald-400' : 'text-zinc-100'}`}>
                              R$ {rec.amount.toFixed(2)}
                            </p>
                            <button onClick={() => handleDeleteRecurring(rec.id)} className="text-zinc-500 hover:text-red-400 transition-colors p-1" title="Eliminar">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'conexoes' && <ConnectionsPanel onPartnersChange={fetchUsers} />}

        </div>
      </main>
    </div>
  )
}
