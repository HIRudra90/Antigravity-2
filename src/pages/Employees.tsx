import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid
} from 'recharts'
import {
  Users, UserCheck, DollarSign, Search, Plus, X, ChevronDown, ChevronUp,
  Phone, Mail, MapPin, Droplets, Calendar, Shield, Truck, Package,
  Trash2, ClipboardCheck, Sparkles, CheckCircle, AlertCircle, Edit,
  UploadCloud, Save, Clock
} from 'lucide-react'
import { supabase } from '../lib/supabaseClient'

// ─── Types ───────────────────────────────────────────────────────
interface Employee {
  id: string
  name: string
  profile_image_url: string | null
  contact_number: string | null
  email: string | null
  emergency_contact: string | null
  address: string | null
  blood_group: string | null
  monthly_salary: number
  joined_date: string
  role: string
  status: string
  created_at: string
}

interface SalaryPayment {
  id: string
  employee_id: string
  amount: number
  payment_month: number
  payment_year: number
  status: 'Paid' | 'Due'
  paid_at: string | null
}

// ─── Constants ──────────────────────────────────────────────────
const ROLES = [
  'Warehouse Supervisor', 'Receiving Clerk', 'Stocker',
  'Packer', 'Logistic', 'Cleaner', 'Security'
]

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']

const roleColors: Record<string, string> = {
  'Warehouse Supervisor': '#6C63FF',
  'Receiving Clerk': '#00D4FF',
  'Stocker': '#22d3a8',
  'Packer': '#f59e0b',
  'Logistic': '#FF6B9D',
  'Cleaner': '#38bdf8',
  'Security': '#a78bfa',
}

const roleIcons: Record<string, any> = {
  'Warehouse Supervisor': ClipboardCheck,
  'Receiving Clerk': Package,
  'Stocker': Package,
  'Packer': Package,
  'Logistic': Truck,
  'Cleaner': Sparkles,
  'Security': Shield,
}

// ─── Image Upload Helper ────────────────────────────────────────
function ImageUpload({ currentUrl, onImageChange, size = 80 }: {
  currentUrl: string | null
  onImageChange: (dataUrl: string | null) => void
  size?: number
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const initials = '?'

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      alert('Image must be under 2MB')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      onImageChange(reader.result as string)
    }
    reader.readAsDataURL(file)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <div
        style={{
          width: size, height: size, borderRadius: '50%',
          background: currentUrl ? 'transparent' : 'linear-gradient(135deg, #6C63FF, #00D4FF)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: size * 0.35, fontWeight: 700, color: '#fff',
          overflow: 'hidden', position: 'relative',
          border: '3px solid rgba(108,99,255,0.3)',
          boxShadow: '0 0 20px rgba(108,99,255,0.2)',
          cursor: 'pointer'
        }}
        onClick={() => fileInputRef.current?.click()}
      >
        {currentUrl ? (
          <img src={currentUrl} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <UploadCloud size={size * 0.3} />
        )}
      </div>
      <button
        className="btn btn-ghost btn-sm"
        style={{ fontSize: 11, padding: '4px 10px' }}
        onClick={() => fileInputRef.current?.click()}
      >
        <UploadCloud size={12} /> {currentUrl ? 'Change' : 'Upload'}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────
export default function Employees() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [payments, setPayments] = useState<SalaryPayment[]>([])
  const [search, setSearch] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [showProfileModal, setShowProfileModal] = useState<Employee | null>(null)
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null)
  const [expandedRoles, setExpandedRoles] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [statModal, setStatModal] = useState<null | 'total' | 'active' | 'paid' | 'due'>(null)
  const [chartModal, setChartModal] = useState<null | {
    title: string; subtitle: string; color: string
    rows: { emp: Employee; isPaid: boolean; amount: number }[]
    totalPaid: number; totalDue: number
  }>(null)

  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()

  // ─── Fetch data ───────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true)
    const [empRes, payRes] = await Promise.all([
      supabase.from('employees').select('*').order('role').order('name'),
      supabase.from('salary_payments').select('*')
        .eq('payment_month', currentMonth)
        .eq('payment_year', currentYear)
    ])
    if (empRes.data) setEmployees(empRes.data)
    if (payRes.data) setPayments(payRes.data)
    setLoading(false)
  }, [currentMonth, currentYear])

  useEffect(() => { fetchData() }, [fetchData])

  // ─── Ensure salary records exist for current month ────────────
  const ensureSalaryRecords = useCallback(async (emps: Employee[]) => {
    const existingIds = payments.map(p => p.employee_id)
    const missing = emps.filter(e => !existingIds.includes(e.id))
    if (missing.length === 0) return

    const records = missing.map(e => ({
      employee_id: e.id,
      amount: e.monthly_salary,
      payment_month: currentMonth,
      payment_year: currentYear,
      status: 'Due'
    }))

    await supabase.from('salary_payments').insert(records)
    await fetchData()
  }, [payments, currentMonth, currentYear, fetchData])

  useEffect(() => {
    if (employees.length > 0) ensureSalaryRecords(employees)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees.length])

  // ─── Helpers ──────────────────────────────────────────────────
  const getPaymentStatus = (empId: string): 'Paid' | 'Due' => {
    const p = payments.find(p => p.employee_id === empId)
    return p?.status === 'Paid' ? 'Paid' : 'Due'
  }

  const payEmployee = async (empId: string) => {
    const existing = payments.find(p => p.employee_id === empId)
    if (existing) {
      await supabase.from('salary_payments')
        .update({ status: 'Paid', paid_at: new Date().toISOString() })
        .eq('id', existing.id)
    } else {
      const emp = employees.find(e => e.id === empId)
      if (!emp) return
      await supabase.from('salary_payments').insert({
        employee_id: empId,
        amount: emp.monthly_salary,
        payment_month: currentMonth,
        payment_year: currentYear,
        status: 'Paid',
        paid_at: new Date().toISOString()
      })
    }
    await fetchData()
  }

  const payAllEmployees = async () => {
    const duePayments = payments.filter(p => p.status === 'Due')
    if (duePayments.length === 0) return

    const dueIds = duePayments.map(p => p.id)
    await supabase.from('salary_payments')
      .update({ status: 'Paid', paid_at: new Date().toISOString() })
      .in('id', dueIds)

    const paidEmployeeIds = payments.map(p => p.employee_id)
    const unpaidEmps = employees.filter(e => !paidEmployeeIds.includes(e.id))
    if (unpaidEmps.length > 0) {
      await supabase.from('salary_payments').insert(
        unpaidEmps.map(e => ({
          employee_id: e.id,
          amount: e.monthly_salary,
          payment_month: currentMonth,
          payment_year: currentYear,
          status: 'Paid',
          paid_at: new Date().toISOString()
        }))
      )
    }
    await fetchData()
  }

  const deleteEmployee = async (id: string) => {
    await supabase.from('employees').delete().eq('id', id)
    setShowProfileModal(null)
    setEditingEmployee(null)
    await fetchData()
  }

  const yearsWorking = (joinedDate: string) => {
    const joined = new Date(joinedDate)
    const diff = now.getTime() - joined.getTime()
    return Math.max(0, Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000)))
  }

  // ─── Stats ────────────────────────────────────────────────────
  const totalEmployees = employees.length
  const activeCount = employees.filter(e => e.status === 'Active').length
  const totalSalary = employees.reduce((s, e) => s + Number(e.monthly_salary), 0)
  const paidCount = payments.filter(p => p.status === 'Paid').length
  const dueCount = totalEmployees - paidCount
  const paidAmount = payments.filter(p => p.status === 'Paid').reduce((s, p) => s + Number(p.amount), 0)
  const dueAmount = totalSalary - paidAmount

  // ─── Filter ───────────────────────────────────────────────────
  const filtered = employees.filter(e =>
    e.name.toLowerCase().includes(search.toLowerCase()) ||
    e.role.toLowerCase().includes(search.toLowerCase())
  )

  // ─── Group by role ────────────────────────────────────────────
  const grouped = ROLES.reduce((acc, role) => {
    acc[role] = filtered.filter(e => e.role === role)
    return acc
  }, {} as Record<string, Employee[]>)

  // ─── Pie chart data ───────────────────────────────────────────
  const pieData = [
    { name: 'Paid', value: paidAmount, color: '#22d3a8' },
    { name: 'Due', value: dueAmount, color: '#f43f5e' },
  ].filter(d => d.value > 0)

  // ─── Bar chart data (by role) ─────────────────────────────────
  const roleBarData = ROLES.map(role => {
    const emps = employees.filter(e => e.role === role)
    const rolePaid = emps.reduce((s, e) => {
      const p = payments.find(p => p.employee_id === e.id && p.status === 'Paid')
      return s + (p ? Number(p.amount) : 0)
    }, 0)
    const roleDue = emps.reduce((s, e) => s + Number(e.monthly_salary), 0) - rolePaid
    return { role: role.split(' ').map(w => w[0]).join(''), fullRole: role, paid: rolePaid, due: roleDue }
  })

  // ─── Chart click handlers ─────────────────────────────────────
  const openPieModal = (data: any) => {
    if (!data) return
    const isPaidSlice = data.name === 'Paid'
    const relevant = employees.filter(e => getPaymentStatus(e.id) === (isPaidSlice ? 'Paid' : 'Due'))
    setChartModal({
      title: isPaidSlice ? 'Paid Employees' : 'Unpaid Employees',
      subtitle: `${relevant.length} employee${relevant.length !== 1 ? 's' : ''} · $${data.value.toLocaleString()} total`,
      color: isPaidSlice ? '#22d3a8' : '#f43f5e',
      rows: relevant.map(e => {
        const p = payments.find(px => px.employee_id === e.id)
        return { emp: e, isPaid: isPaidSlice, amount: Number(p?.amount ?? e.monthly_salary) }
      }),
      totalPaid: isPaidSlice ? data.value : 0,
      totalDue: isPaidSlice ? 0 : data.value,
    })
  }

  const openBarModal = (data: any) => {
    if (!data?.fullRole) return
    const roleEmps = employees.filter(e => e.role === data.fullRole)
    const color = roleColors[data.fullRole] || '#6C63FF'
    setChartModal({
      title: data.fullRole,
      subtitle: `${roleEmps.length} employee${roleEmps.length !== 1 ? 's' : ''} · $${(data.paid + data.due).toLocaleString()}/mo`,
      color,
      rows: roleEmps.map(e => {
        const p = payments.find(px => px.employee_id === e.id)
        const isPaid = p?.status === 'Paid'
        return { emp: e, isPaid, amount: Number(p?.amount ?? e.monthly_salary) }
      }),
      totalPaid: data.paid,
      totalDue: data.due,
    })
  }

  // ─── Render ───────────────────────────────────────────────────
  return (
    <div className="page-enter">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1>Employees</h1>
          <p>Manage workforce profiles, roles, and salary payments</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
          <Plus size={16} /> Add Employee
        </button>
      </div>

      {/* ─── Stat Cards ────────────────────────────────────── */}
      <div className="stat-grid">
        {[
          { label: 'Total Employees', value: totalEmployees, icon: Users, color: '#6C63FF', key: 'total' as const },
          { label: 'Active', value: activeCount, icon: UserCheck, color: '#22d3a8', key: 'active' as const },
          { label: 'Salary Paid', value: paidCount, sub: `$${paidAmount.toLocaleString()} paid this month`, icon: CheckCircle, color: '#00D4FF', key: 'paid' as const },
          { label: 'Salary Due', value: dueCount, sub: `$${dueAmount.toLocaleString()} outstanding`, icon: AlertCircle, color: '#f43f5e', key: 'due' as const },
        ].map(s => (
          <div
            key={s.label}
            className="stat-card"
            style={{ '--card-glow': `${s.color}33`, cursor: 'pointer' } as any}
            onClick={() => setStatModal(s.key)}
            title={`Click to view ${s.label}`}
          >
            <div className="stat-card-icon"><s.icon size={18} color={s.color} /></div>
            <div className="stat-card-label">{s.label}</div>
            <div className="stat-card-value">{s.value}</div>
            {'sub' in s && <div style={{ fontSize: 12, color: s.color, fontWeight: 600, marginTop: 2 }}>{s.sub}</div>}
            <div style={{ fontSize: 10, color: s.color, opacity: 0.7, marginTop: 2, letterSpacing: '0.05em' }}>Click to view list</div>
          </div>
        ))}
      </div>

      {/* ─── Salary Infographics ─────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16, marginBottom: 24 }}>
        <div className="glass-card"
          onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'rgba(0,212,255,0.7)'; el.style.boxShadow = '0 0 0 1px rgba(0,212,255,0.3),0 0 20px rgba(0,212,255,0.45),0 0 60px rgba(0,212,255,0.25),0 0 100px rgba(0,212,255,0.12),0 12px 40px rgba(0,0,0,0.6)' }}
          onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = ''; el.style.boxShadow = '' }}
        >
          <div className="section-title">Salary Overview</div>
          <div style={{ height: 200 }}>
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={80}
                    dataKey="value" strokeWidth={0} paddingAngle={4}
                    cursor="pointer"
                    onClick={(data) => openPieModal(data)}
                  >
                    {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip
                    cursor={false}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const d = payload[0]
                      return (
                        <div style={{ background: 'rgba(5,8,16,0.95)', border: `1px solid ${d.payload.color}55`, borderRadius: 12, padding: '10px 16px', boxShadow: '0 12px 32px rgba(0,0,0,0.6)' }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 4 }}>{d.name}</div>
                          <div style={{ fontSize: 13, fontWeight: 800, color: d.payload.color }}>${(d.value as number).toLocaleString()}</div>
                          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>Click to view employees</div>
                        </div>
                      )
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--clr-text-muted)', fontSize: 13 }}>
                No salary data yet
              </div>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginTop: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <div style={{ width: 10, height: 10, borderRadius: 3, background: '#22d3a8' }} />
              <span style={{ color: 'var(--clr-text-muted)' }}>Paid</span>
              <span style={{ fontWeight: 700, color: '#22d3a8' }}>${paidAmount.toLocaleString()}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <div style={{ width: 10, height: 10, borderRadius: 3, background: '#f43f5e' }} />
              <span style={{ color: 'var(--clr-text-muted)' }}>Due</span>
              <span style={{ fontWeight: 700, color: '#f43f5e' }}>${dueAmount.toLocaleString()}</span>
            </div>
          </div>
        </div>

        <div className="glass-card"
          onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'rgba(0,212,255,0.7)'; el.style.boxShadow = '0 0 0 1px rgba(0,212,255,0.3),0 0 20px rgba(0,212,255,0.45),0 0 60px rgba(0,212,255,0.25),0 0 100px rgba(0,212,255,0.12),0 12px 40px rgba(0,0,0,0.6)' }}
          onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = ''; el.style.boxShadow = '' }}
        >
          <div className="section-title">
            Salary by Role
            <button className="btn btn-primary btn-sm" onClick={payAllEmployees} disabled={dueCount === 0}>
              <DollarSign size={14} /> Pay All ({dueCount} due)
            </button>
          </div>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={roleBarData} barGap={2}
                style={{ cursor: 'pointer' }}
                onClick={(chartData: any) => {
                  const payload = chartData?.activePayload?.[0]?.payload
                  if (payload) openBarModal(payload)
                }}
              >
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="role" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.04)', radius: 6 } as any}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    const item = roleBarData.find(r => r.role === label)
                    const color = roleColors[item?.fullRole || ''] || '#6C63FF'
                    return (
                      <div style={{ background: 'rgba(5,8,16,0.95)', border: `1px solid ${color}55`, borderRadius: 12, padding: '10px 16px', boxShadow: '0 12px 32px rgba(0,0,0,0.6)', minWidth: 150 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 6 }}>{item?.fullRole || label}</div>
                        {payload.map((p: any) => (
                          <div key={p.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 12, color: p.dataKey === 'paid' ? '#22d3a8' : '#f43f5e', marginBottom: 2 }}>
                            <span>{p.dataKey === 'paid' ? '✓ Paid' : '● Due'}</span>
                            <span style={{ fontWeight: 700 }}>${(p.value as number).toLocaleString()}</span>
                          </div>
                        ))}
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 5 }}>Click to view employees</div>
                      </div>
                    )
                  }}
                />
                <Bar dataKey="paid" fill="#22d3a8" radius={[4, 4, 0, 0]} activeBar={{ filter: 'brightness(1.35) drop-shadow(0 0 10px #22d3a8)' }} />
                <Bar dataKey="due" fill="#f43f5e" radius={[4, 4, 0, 0]} opacity={0.85} activeBar={{ filter: 'brightness(1.35) drop-shadow(0 0 10px #f43f5e)' }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ─── Search + universal expand/collapse ─────────── */}
      <div className="glass-card mb-4">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--clr-text-muted)' }} />
            <input className="glass-input" style={{ paddingLeft: 34 }} placeholder="Search by name or role…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {(() => {
            const visibleRoles = ROLES.filter(r => (grouped[r] || []).length > 0)
            const allExpanded = visibleRoles.every(r => expandedRoles.has(r))
            return (
              <button
                className="btn btn-ghost btn-sm"
                style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                onClick={() => setExpandedRoles(allExpanded ? new Set() : new Set(ROLES))}
              >
                {allExpanded ? <><ChevronUp size={14} /> Collapse All</> : <><ChevronDown size={14} /> Expand All</>}
              </button>
            )
          })()}
        </div>
      </div>

      {/* ─── Role-Based Employee Cards ───────────────────── */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {[1, 2, 3].map(i => <div key={i} className="shimmer" style={{ height: 80, borderRadius: 'var(--r-lg)' }} />)}
        </div>
      ) : employees.length === 0 ? (
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, gap: 12 }}>
          <Users size={48} color="var(--clr-text-muted)" />
          <p style={{ color: 'var(--clr-text-muted)', fontSize: 15 }}>No employees yet. Click "Add Employee" to get started.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {ROLES.map(role => {
            const emps = grouped[role]
            if (emps.length === 0) return null
            const isExpanded = expandedRoles.has(role)
            const RoleIcon = roleIcons[role] || Users
            const color = roleColors[role] || '#6C63FF'

            return (
              <div key={role} className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
                <div
                  onClick={() => setExpandedRoles(prev => {
                    const next = new Set(prev)
                    if (next.has(role)) next.delete(role)
                    else next.add(role)
                    return next
                  })}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '16px 22px', cursor: 'pointer',
                    background: `linear-gradient(135deg, ${color}12, transparent)`,
                    borderBottom: isExpanded ? '1px solid rgba(255,255,255,0.06)' : 'none'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: `${color}22`, border: `1px solid ${color}44`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <RoleIcon size={18} color={color} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, color }}>{role}</div>
                      <div style={{ fontSize: 12, color: 'var(--clr-text-muted)' }}>{emps.length} employee{emps.length !== 1 ? 's' : ''}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span className="badge" style={{ background: `${color}22`, color, border: `1px solid ${color}44` }}>
                      ${emps.reduce((s, e) => s + Number(e.monthly_salary), 0).toLocaleString()}/mo
                    </span>
                    {isExpanded ? <ChevronUp size={18} color="var(--clr-text-muted)" /> : <ChevronDown size={18} color="var(--clr-text-muted)" />}
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12, padding: 16 }}>
                    {emps.map(emp => {
                      const pStatus = getPaymentStatus(emp.id)
                      const isPaid = pStatus === 'Paid'
                      return (
                        <div
                          key={emp.id}
                          className="emp-card"
                          style={{
                            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
                            borderRadius: 'var(--r-md)', padding: 16, cursor: 'pointer', transition: 'all 0.2s'
                          }}
                          onClick={() => setShowProfileModal(emp)}
                          onMouseEnter={e => { (e.currentTarget).style.background = 'rgba(255,255,255,0.06)'; (e.currentTarget).style.borderColor = `${color}44` }}
                          onMouseLeave={e => { (e.currentTarget).style.background = 'rgba(255,255,255,0.03)'; (e.currentTarget).style.borderColor = 'rgba(255,255,255,0.08)' }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                            {emp.profile_image_url ? (
                              <img src={emp.profile_image_url} alt={emp.name} style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover', border: `2px solid ${color}44`, flexShrink: 0 }} />
                            ) : (
                              <div style={{ width: 44, height: 44, borderRadius: '50%', background: `linear-gradient(135deg, ${color}, ${color}88)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, color: '#fff', flexShrink: 0, border: `2px solid ${color}44` }}>
                                {emp.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
                              </div>
                            )}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{emp.name}</div>
                              <div style={{ fontSize: 12, color: 'var(--clr-text-muted)' }}>
                                {yearsWorking(emp.joined_date)} yr{yearsWorking(emp.joined_date) !== 1 ? 's' : ''} · {emp.status}
                              </div>
                            </div>
                            {/* Edit icon */}
                            <button
                              className="btn btn-ghost btn-sm"
                              style={{ padding: 6, opacity: 0.5 }}
                              onClick={(e) => { e.stopPropagation(); setEditingEmployee(emp) }}
                              title="Edit"
                            >
                              <Edit size={14} />
                            </button>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div>
                              <div style={{ fontSize: 11, color: 'var(--clr-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Salary</div>
                              <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-display)' }}>${Number(emp.monthly_salary).toLocaleString()}</div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span className={`badge ${isPaid ? 'badge-success' : 'badge-danger'}`}>{isPaid ? '✓ Paid' : '● Due'}</span>
                              {!isPaid && (
                                <button className="btn btn-primary btn-sm" style={{ padding: '5px 12px', fontSize: 11 }} onClick={(e) => { e.stopPropagation(); payEmployee(emp.id) }}>
                                  <DollarSign size={12} /> Pay
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ─── Modals ──────────────────────────────────────── */}
      {chartModal && (
        <ChartDetailModal
          data={chartModal}
          onClose={() => setChartModal(null)}
          onSelectEmployee={(emp) => { setChartModal(null); setShowProfileModal(emp) }}
          yearsWorking={yearsWorking}
        />
      )}
      {showAddModal && <EmployeeFormModal mode="add" onClose={() => setShowAddModal(false)} onSaved={fetchData} />}
      {editingEmployee && <EmployeeFormModal mode="edit" employee={editingEmployee} onClose={() => setEditingEmployee(null)} onSaved={() => { fetchData(); setShowProfileModal(null) }} />}

      {statModal && (
        <StatListModal
          type={statModal}
          employees={employees}
          payments={payments}
          onClose={() => setStatModal(null)}
          onSelectEmployee={(emp) => { setStatModal(null); setShowProfileModal(emp) }}
          yearsWorking={yearsWorking}
          getPaymentStatus={getPaymentStatus}
          paidAmount={paidAmount}
          dueAmount={dueAmount}
        />
      )}

      {showProfileModal && !editingEmployee && (
        <ProfileModal
          employee={showProfileModal}
          payment={payments.find(p => p.employee_id === showProfileModal.id)}
          onClose={() => setShowProfileModal(null)}
          onPay={() => payEmployee(showProfileModal.id)}
          onEdit={() => setEditingEmployee(showProfileModal)}
          onDelete={() => deleteEmployee(showProfileModal.id)}
          yearsWorking={yearsWorking(showProfileModal.joined_date)}
          roleColor={roleColors[showProfileModal.role] || '#6C63FF'}
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  CHART DETAIL MODAL — click pie segment or bar to open
// ═══════════════════════════════════════════════════════════════
function ChartDetailModal({ data, onClose, onSelectEmployee, yearsWorking }: {
  data: { title: string; subtitle: string; color: string; rows: { emp: Employee; isPaid: boolean; amount: number }[]; totalPaid: number; totalDue: number }
  onClose: () => void
  onSelectEmployee: (emp: Employee) => void
  yearsWorking: (date: string) => number
}) {
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(5,8,16,0.45)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={onClose}>
      <div
        className="glass-card"
        style={{ width: 580, maxHeight: '82vh', display: 'flex', flexDirection: 'column', padding: 0, position: 'relative', overflow: 'hidden', background: 'rgba(8,10,22,0.30)', backdropFilter: 'blur(32px)', WebkitBackdropFilter: 'blur(32px)', border: '1px solid rgba(255,255,255,0.14)', boxShadow: '0 24px 80px rgba(0,0,0,0.5)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '16px 20px 12px', background: `linear-gradient(135deg, ${data.color}18, transparent)`, borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: `${data.color}22`, border: `1px solid ${data.color}44`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <DollarSign size={16} color={data.color} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, fontFamily: 'var(--font-display)' }}>{data.title}</div>
                <div style={{ fontSize: 11, color: 'var(--clr-text-muted)', marginTop: 1 }}>{data.subtitle}</div>
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', borderRadius: '50%', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <X size={13} />
            </button>
          </div>
        </div>

        {/* Summary strip */}
        {(data.totalPaid > 0 || data.totalDue > 0) && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: '12px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
            <div style={{ background: 'rgba(34,211,168,0.05)', borderRadius: 10, padding: '8px 12px', border: '1px solid rgba(34,211,168,0.12)', textAlign: 'center' }}>
              <div style={{ fontSize: 17, fontWeight: 700, fontFamily: 'var(--font-display)', color: '#22d3a8' }}>${data.totalPaid.toLocaleString()}</div>
              <div style={{ fontSize: 10, color: 'var(--clr-text-muted)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Paid</div>
            </div>
            <div style={{ background: 'rgba(244,63,94,0.05)', borderRadius: 10, padding: '8px 12px', border: '1px solid rgba(244,63,94,0.12)', textAlign: 'center' }}>
              <div style={{ fontSize: 17, fontWeight: 700, fontFamily: 'var(--font-display)', color: '#f43f5e' }}>${data.totalDue.toLocaleString()}</div>
              <div style={{ fontSize: 10, color: 'var(--clr-text-muted)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Due</div>
            </div>
          </div>
        )}

        {/* Employee list */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '10px 20px 16px' }}>
          {data.rows.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, gap: 10 }}>
              <Users size={32} color="rgba(255,255,255,0.15)" />
              <div style={{ color: 'var(--clr-text-muted)', fontSize: 13 }}>No employees in this category</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {data.rows.map(({ emp, isPaid, amount }) => {
                const color = roleColors[emp.role] || '#6C63FF'
                return (
                  <div key={emp.id} onClick={() => onSelectEmployee(emp)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer', transition: 'all 0.15s' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'; (e.currentTarget as HTMLElement).style.borderColor = `${color}44` }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.06)' }}
                  >
                    {emp.profile_image_url ? (
                      <img src={emp.profile_image_url} alt={emp.name} style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', border: `2px solid ${color}44`, flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: 36, height: 36, borderRadius: '50%', background: `linear-gradient(135deg, ${color}, ${color}88)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff', flexShrink: 0, border: `2px solid ${color}44` }}>
                        {emp.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2)}
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{emp.name}</div>
                      <div style={{ fontSize: 11, color, marginTop: 1 }}>{emp.role} · <span style={{ color: emp.status === 'Active' ? '#22d3a8' : emp.status === 'On Leave' ? '#f59e0b' : 'rgba(255,255,255,0.35)' }}>{emp.status}</span> · {yearsWorking(emp.joined_date)} yr{yearsWorking(emp.joined_date) !== 1 ? 's' : ''}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, fontFamily: 'var(--font-display)' }}>${amount.toLocaleString()}</div>
                      <span className={`badge ${isPaid ? 'badge-success' : 'badge-danger'}`} style={{ fontSize: 10, padding: '2px 7px', marginTop: 3 }}>{isPaid ? '✓ Paid' : '● Due'}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 20px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, background: 'rgba(0,0,0,0.15)' }}>
          <div style={{ fontSize: 12, color: 'var(--clr-text-muted)' }}>{data.rows.length} employee{data.rows.length !== 1 ? 's' : ''} · Click a row to view profile</div>
          <div style={{ fontWeight: 700, fontSize: 13, color: data.color }}>${(data.totalPaid + data.totalDue).toLocaleString()}/mo</div>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ═══════════════════════════════════════════════════════════════
//  STAT LIST MODAL — click on any stat card to open
// ═══════════════════════════════════════════════════════════════
function StatListModal({
  type, employees, payments, onClose, onSelectEmployee, yearsWorking, getPaymentStatus, paidAmount, dueAmount
}: {
  type: 'total' | 'active' | 'paid' | 'due'
  employees: Employee[]
  payments: SalaryPayment[]
  onClose: () => void
  onSelectEmployee: (emp: Employee) => void
  yearsWorking: (date: string) => number
  getPaymentStatus: (id: string) => 'Paid' | 'Due'
  paidAmount: number
  dueAmount: number
}) {
  const config = {
    total: { title: 'All Employees', color: '#6C63FF', icon: Users, subtitle: `${employees.length} total` },
    active: { title: 'Active Employees', color: '#22d3a8', icon: UserCheck, subtitle: `${employees.filter(e => e.status === 'Active').length} currently active` },
    paid: { title: 'Salary Paid', color: '#00D4FF', icon: CheckCircle, subtitle: `$${paidAmount.toLocaleString()} paid this month` },
    due: { title: 'Salary Due', color: '#f43f5e', icon: AlertCircle, subtitle: `$${dueAmount.toLocaleString()} outstanding this month` },
  }[type]

  const list = employees.filter(emp => {
    if (type === 'total') return true
    if (type === 'active') return emp.status === 'Active'
    const pStatus = getPaymentStatus(emp.id)
    if (type === 'paid') return pStatus === 'Paid'
    if (type === 'due') return pStatus === 'Due'
    return false
  })

  const Icon = config.icon

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(5,8,16,0.45)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        className="glass-card"
        style={{
          width: 580, maxHeight: '82vh', display: 'flex', flexDirection: 'column',
          padding: 0, position: 'relative', overflow: 'hidden',
          background: 'rgba(8,10,22,0.30)', backdropFilter: 'blur(32px)', WebkitBackdropFilter: 'blur(32px)',
          border: '1px solid rgba(255,255,255,0.14)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '20px 24px 16px',
          background: `linear-gradient(135deg, ${config.color}18, transparent)`,
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 12,
                background: `${config.color}22`, border: `1px solid ${config.color}44`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Icon size={20} color={config.color} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 17, fontFamily: 'var(--font-display)' }}>{config.title}</div>
                <div style={{ fontSize: 12, color: config.color, marginTop: 2 }}>{config.subtitle}</div>
              </div>
            </div>
            <button
              onClick={onClose}
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Employee list */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '12px 16px 16px' }}>
          {list.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 48, gap: 10 }}>
              <Icon size={36} color="rgba(255,255,255,0.15)" />
              <div style={{ color: 'var(--clr-text-muted)', fontSize: 13 }}>No employees in this category</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {list.map((emp, idx) => {
                const pStatus = getPaymentStatus(emp.id)
                const isPaid = pStatus === 'Paid'
                const color = roleColors[emp.role] || '#6C63FF'
                const payment = payments.find(p => p.employee_id === emp.id)
                return (
                  <div
                    key={emp.id}
                    onClick={() => onSelectEmployee(emp)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 14,
                      padding: '12px 14px', borderRadius: 'var(--r-md)',
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.06)',
                      cursor: 'pointer', transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'; (e.currentTarget as HTMLElement).style.borderColor = `${color}44` }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.06)' }}
                  >
                    {/* Index */}
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', fontWeight: 600, width: 18, textAlign: 'right', flexShrink: 0 }}>
                      {idx + 1}
                    </div>

                    {/* Avatar */}
                    {emp.profile_image_url ? (
                      <img src={emp.profile_image_url} alt={emp.name} style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', border: `2px solid ${color}44`, flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: 40, height: 40, borderRadius: '50%', background: `linear-gradient(135deg, ${color}, ${color}88)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#fff', flexShrink: 0, border: `2px solid ${color}44` }}>
                        {emp.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2)}
                      </div>
                    )}

                    {/* Name + role */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{emp.name}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                        <span style={{ fontSize: 11, color }}>
                          {emp.role}
                        </span>
                        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>·</span>
                        <span style={{ fontSize: 11, color: emp.status === 'Active' ? '#22d3a8' : emp.status === 'On Leave' ? '#f59e0b' : 'rgba(255,255,255,0.35)' }}>
                          {emp.status}
                        </span>
                        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>·</span>
                        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                          {yearsWorking(emp.joined_date)} yr{yearsWorking(emp.joined_date) !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>

                    {/* Salary + payment status */}
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 15, fontFamily: 'var(--font-display)' }}>
                        ${Number(emp.monthly_salary).toLocaleString()}
                      </div>
                      <div style={{ marginTop: 4 }}>
                        <span className={`badge ${isPaid ? 'badge-success' : 'badge-danger'}`} style={{ fontSize: 10, padding: '2px 8px' }}>
                          {isPaid ? '✓ Paid' : '● Due'}
                          {payment?.paid_at && isPaid ? ` · ${new Date(payment.paid_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer summary */}
        <div style={{
          padding: '12px 24px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
          background: 'rgba(0,0,0,0.2)',
        }}>
          <div style={{ fontSize: 12, color: 'var(--clr-text-muted)' }}>
            {list.length} employee{list.length !== 1 ? 's' : ''} · Click a row to view full profile
          </div>
          <div style={{ fontWeight: 700, fontSize: 14, color: config.color }}>
            ${list.reduce((s, e) => s + Number(e.monthly_salary), 0).toLocaleString()}/mo total
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ═══════════════════════════════════════════════════════════════
//  UNIFIED ADD / EDIT EMPLOYEE MODAL
// ═══════════════════════════════════════════════════════════════
function EmployeeFormModal({ mode, employee, onClose, onSaved }: {
  mode: 'add' | 'edit'
  employee?: Employee
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState({
    name: employee?.name || '',
    email: employee?.email || '',
    contact_number: employee?.contact_number || '',
    emergency_contact: employee?.emergency_contact || '',
    address: employee?.address || '',
    blood_group: employee?.blood_group || '',
    monthly_salary: employee ? String(employee.monthly_salary) : '',
    role: employee?.role || 'Warehouse Supervisor',
    joined_date: employee?.joined_date || new Date().toISOString().split('T')[0],
    profile_image_url: employee?.profile_image_url || '',
    status: employee?.status || 'Active'
  })
  const [saving, setSaving] = useState(false)

  const update = (k: string, v: string) => setForm(prev => ({ ...prev, [k]: v }))

  const handleSave = async () => {
    if (!form.name.trim() || !form.monthly_salary) return
    setSaving(true)

    const payload = {
      name: form.name.trim(),
      email: form.email || null,
      contact_number: form.contact_number || null,
      emergency_contact: form.emergency_contact || null,
      address: form.address || null,
      blood_group: form.blood_group || null,
      monthly_salary: parseFloat(form.monthly_salary),
      role: form.role,
      joined_date: form.joined_date,
      profile_image_url: form.profile_image_url || null,
      status: form.status
    }

    let error
    if (mode === 'edit' && employee) {
      const res = await supabase.from('employees').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', employee.id)
      error = res.error

      // Also update this month's salary payment amount if salary changed
      if (!error && parseFloat(form.monthly_salary) !== Number(employee.monthly_salary)) {
        const now = new Date()
        await supabase.from('salary_payments')
          .update({ amount: parseFloat(form.monthly_salary) })
          .eq('employee_id', employee.id)
          .eq('payment_month', now.getMonth() + 1)
          .eq('payment_year', now.getFullYear())
          .eq('status', 'Due')
      }
    } else {
      const res = await supabase.from('employees').insert(payload)
      error = res.error
    }

    setSaving(false)
    if (!error) {
      onSaved()
      onClose()
    }
  }

  const lbl: React.CSSProperties = { display: 'block', fontSize: 11, color: 'var(--clr-text-muted)', marginBottom: 3 }
  const inp: React.CSSProperties = { padding: '7px 11px', fontSize: 13 }

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(5,8,16,0.45)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div
        className="glass-card"
        style={{
          width: 580, padding: 20, position: 'relative',
          background: 'rgba(8,10,22,0.30)', backdropFilter: 'blur(32px)', WebkitBackdropFilter: 'blur(32px)',
          border: '1px solid rgba(255,255,255,0.14)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <button onClick={onClose} style={{ position: 'absolute', top: 14, right: 14, background: 'none', border: 'none', color: 'var(--clr-text-muted)', cursor: 'pointer' }}>
          <X size={18} />
        </button>

        <h2 style={{ fontSize: 17, fontFamily: 'var(--font-display)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          {mode === 'edit' ? <><Edit size={16} color="#00D4FF" /> Edit Employee</> : <><Plus size={16} color="#6C63FF" /> Add New Employee</>}
        </h2>

        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
          <ImageUpload
            currentUrl={form.profile_image_url || null}
            onImageChange={(url) => update('profile_image_url', url || '')}
            size={68}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={lbl}>Full Name *</label>
            <input className="glass-input" style={inp} placeholder="John Doe" value={form.name} onChange={e => update('name', e.target.value)} />
          </div>
          <div>
            <label style={lbl}>Email</label>
            <input className="glass-input" style={inp} type="email" placeholder="john@company.com" value={form.email} onChange={e => update('email', e.target.value)} />
          </div>
          <div>
            <label style={lbl}>Contact Number</label>
            <input className="glass-input" style={inp} placeholder="+880 1XXXXXXXXX" value={form.contact_number} onChange={e => update('contact_number', e.target.value)} />
          </div>
          <div>
            <label style={lbl}>Emergency Contact</label>
            <input className="glass-input" style={inp} placeholder="+880 …" value={form.emergency_contact} onChange={e => update('emergency_contact', e.target.value)} />
          </div>
          <div>
            <label style={lbl}>Blood Group</label>
            <select className="glass-input" style={inp} value={form.blood_group} onChange={e => update('blood_group', e.target.value)}>
              <option value="">Select</option>
              {BLOOD_GROUPS.map(bg => <option key={bg} value={bg}>{bg}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={lbl}>Address</label>
            <input className="glass-input" style={inp} placeholder="123 Street, City" value={form.address} onChange={e => update('address', e.target.value)} />
          </div>
          <div>
            <label style={lbl}>Role *</label>
            <select className="glass-input" style={inp} value={form.role} onChange={e => update('role', e.target.value)}>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Monthly Salary ($) *</label>
            <input className="glass-input" style={inp} type="number" placeholder="3000" value={form.monthly_salary} onChange={e => update('monthly_salary', e.target.value)} />
          </div>
          <div>
            <label style={lbl}>Joined Date</label>
            <input className="glass-input" style={inp} type="date" value={form.joined_date} onChange={e => update('joined_date', e.target.value)} />
          </div>
          <div>
            <label style={lbl}>Status</label>
            <select className="glass-input" style={inp} value={form.status} onChange={e => update('status', e.target.value)}>
              <option value="Active">Active</option>
              <option value="On Leave">On Leave</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 14, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving || !form.name.trim() || !form.monthly_salary}>
            <Save size={13} /> {saving ? 'Saving…' : mode === 'edit' ? 'Save Changes' : 'Add Employee'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ═══════════════════════════════════════════════════════════════
//  EMPLOYEE PROFILE MODAL (VIEW)
// ═══════════════════════════════════════════════════════════════
function ProfileModal({
  employee, payment, onClose, onPay, onEdit, onDelete, yearsWorking, roleColor
}: {
  employee: Employee
  payment?: SalaryPayment
  onClose: () => void
  onPay: () => void
  onEdit: () => void
  onDelete: () => void
  yearsWorking: number
  roleColor: string
}) {
  const [showHistory, setShowHistory] = useState(false)
  const isPaid = payment?.status === 'Paid'

  return (
    <>
      {createPortal(
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(5,8,16,0.45)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={onClose}>
          <div
            className="glass-card"
            style={{
              width: 580, padding: 0, position: 'relative',
              background: 'rgba(8,10,22,0.30)', backdropFilter: 'blur(32px)', WebkitBackdropFilter: 'blur(32px)',
              border: '1px solid rgba(255,255,255,0.14)',
              boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Banner */}
            <div style={{ height: 64, background: `linear-gradient(135deg, ${roleColor}44, ${roleColor}11)`, position: 'relative', borderRadius: 'var(--r-lg) var(--r-lg) 0 0' }}>
              <div style={{ position: 'absolute', top: 10, right: 10, display: 'flex', gap: 6 }}>
                <button onClick={onEdit} style={{ background: 'rgba(0,0,0,0.3)', border: 'none', color: '#fff', cursor: 'pointer', borderRadius: '50%', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Edit">
                  <Edit size={13} />
                </button>
                <button onClick={onClose} style={{ background: 'rgba(0,0,0,0.3)', border: 'none', color: '#fff', cursor: 'pointer', borderRadius: '50%', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Avatar */}
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: -30 }}>
              {employee.profile_image_url ? (
                <img src={employee.profile_image_url} alt={employee.name} style={{ width: 60, height: 60, borderRadius: '50%', objectFit: 'cover', border: '3px solid rgba(5,8,16,0.9)', boxShadow: `0 0 16px ${roleColor}44` }} />
              ) : (
                <div style={{ width: 60, height: 60, borderRadius: '50%', background: `linear-gradient(135deg, ${roleColor}, ${roleColor}88)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700, color: '#fff', border: '3px solid rgba(5,8,16,0.9)', boxShadow: `0 0 16px ${roleColor}44` }}>
                  {employee.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
                </div>
              )}
            </div>

            <div style={{ padding: '8px 22px 18px' }}>
              {/* Name & Role */}
              <div style={{ textAlign: 'center', marginBottom: 12 }}>
                <h2 style={{ fontSize: 18, fontFamily: 'var(--font-display)', fontWeight: 700 }}>{employee.name}</h2>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4 }}>
                  <span className="badge" style={{ background: `${roleColor}22`, color: roleColor, border: `1px solid ${roleColor}44` }}>{employee.role}</span>
                  <span className="badge" style={{ background: employee.status === 'Active' ? 'rgba(34,211,168,0.12)' : 'rgba(245,158,11,0.12)', color: employee.status === 'Active' ? '#22d3a8' : '#f59e0b', border: `1px solid ${employee.status === 'Active' ? 'rgba(34,211,168,0.25)' : 'rgba(245,158,11,0.25)'}` }}>{employee.status}</span>
                </div>
              </div>

              {/* Details Grid — 2x3 compact */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                {[
                  { icon: Mail, label: 'Email', value: employee.email },
                  { icon: Phone, label: 'Phone', value: employee.contact_number },
                  { icon: Phone, label: 'Emergency', value: employee.emergency_contact },
                  { icon: Droplets, label: 'Blood Group', value: employee.blood_group },
                  { icon: MapPin, label: 'Address', value: employee.address },
                  { icon: Calendar, label: 'Joined', value: employee.joined_date ? new Date(employee.joined_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '–' },
                ].map((item, i) => (
                  <div key={i} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '7px 10px', border: '1px solid rgba(255,255,255,0.06)', gridColumn: item.label === 'Address' ? '1 / -1' : undefined }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--clr-text-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
                      <item.icon size={10} /> {item.label}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 500 }}>{item.value || '–'}</div>
                  </div>
                ))}
              </div>

              {/* Salary Section */}
              <div style={{ background: isPaid ? 'rgba(34,211,168,0.06)' : 'rgba(244,63,94,0.06)', border: `1px solid ${isPaid ? 'rgba(34,211,168,0.2)' : 'rgba(244,63,94,0.2)'}`, borderRadius: 'var(--r-md)', padding: '10px 14px', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--clr-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Monthly Salary</div>
                    <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-display)' }}>${Number(employee.monthly_salary).toLocaleString()}</div>
                    <div style={{ fontSize: 11, color: 'var(--clr-text-muted)', marginTop: 2 }}>{yearsWorking} yr{yearsWorking !== 1 ? 's' : ''} with company</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                    <span className={`badge ${isPaid ? 'badge-success' : 'badge-danger'}`} style={{ fontSize: 12, padding: '4px 12px' }}>{isPaid ? '✓ Paid' : '● Due'}</span>
                    {!isPaid && <button className="btn btn-primary btn-sm" onClick={onPay}><DollarSign size={12} /> Mark as Paid</button>}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost btn-sm" style={{ fontSize: 12 }} onClick={() => setShowHistory(true)}>
                  <Clock size={13} /> History
                </button>
                <button className="btn btn-ghost btn-sm" style={{ fontSize: 12 }} onClick={onEdit}>
                  <Edit size={13} /> Edit
                </button>
                <button className="btn btn-danger btn-sm" style={{ fontSize: 12 }} onClick={onDelete}>
                  <Trash2 size={13} /> Remove
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showHistory && (
        <HistoryModal employee={employee} roleColor={roleColor} onClose={() => setShowHistory(false)} />
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════════
//  HISTORY MODAL — payment & activity summary per employee
// ═══════════════════════════════════════════════════════════════
function HistoryModal({ employee, roleColor, onClose }: {
  employee: Employee
  roleColor: string
  onClose: () => void
}) {
  const [records, setRecords] = useState<SalaryPayment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('salary_payments')
        .select('*')
        .eq('employee_id', employee.id)
        .order('payment_year', { ascending: false })
        .order('payment_month', { ascending: false })
      if (data) setRecords(data)
      setLoading(false)
    }
    load()
  }, [employee.id])

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const totalPaid = records.filter(r => r.status === 'Paid').reduce((s, r) => s + Number(r.amount), 0)
  const monthsPaid = records.filter(r => r.status === 'Paid').length
  const monthsDue = records.filter(r => r.status === 'Due').length
  const joinedLabel = employee.joined_date
    ? new Date(employee.joined_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : '–'

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(5,8,16,0.45)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }} onClick={onClose}>
      <div
        className="glass-card"
        style={{
          width: 580, maxHeight: '85vh', display: 'flex', flexDirection: 'column',
          padding: 0, position: 'relative', overflow: 'hidden',
          background: 'rgba(8,10,22,0.30)', backdropFilter: 'blur(32px)', WebkitBackdropFilter: 'blur(32px)',
          border: '1px solid rgba(255,255,255,0.14)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '16px 20px 12px', background: `linear-gradient(135deg, ${roleColor}18, transparent)`, borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: `${roleColor}22`, border: `1px solid ${roleColor}44`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Clock size={17} color={roleColor} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, fontFamily: 'var(--font-display)' }}>Payment & Activity History</div>
                <div style={{ fontSize: 11, color: 'var(--clr-text-muted)', marginTop: 1 }}>{employee.name} · {employee.role}</div>
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', borderRadius: '50%', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <X size={13} />
            </button>
          </div>
        </div>

        {/* Summary strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, padding: '12px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
          {[
            { label: 'Total Paid', value: `$${totalPaid.toLocaleString()}`, color: '#22d3a8' },
            { label: 'Months Paid', value: String(monthsPaid), color: '#00D4FF' },
            { label: 'Months Due', value: String(monthsDue), color: '#f43f5e' },
            { label: 'Since', value: joinedLabel, color: roleColor },
          ].map(s => (
            <div key={s.label} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '8px 12px', border: '1px solid rgba(255,255,255,0.06)', textAlign: 'center' }}>
              <div style={{ fontSize: 17, fontWeight: 700, fontFamily: 'var(--font-display)', color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 10, color: 'var(--clr-text-muted)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Records */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '10px 20px 16px' }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[1,2,3,4].map(i => <div key={i} className="shimmer" style={{ height: 44, borderRadius: 10 }} />)}
            </div>
          ) : records.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, gap: 10 }}>
              <Clock size={32} color="rgba(255,255,255,0.15)" />
              <div style={{ color: 'var(--clr-text-muted)', fontSize: 13 }}>No payment records found</div>
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 76px 96px 1fr', gap: 8, padding: '4px 10px 6px', marginBottom: 4 }}>
                {['Period', 'Status', 'Amount', 'Paid On'].map(h => (
                  <div key={h} style={{ fontSize: 10, fontWeight: 600, color: 'var(--clr-text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{h}</div>
                ))}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {records.map(r => {
                  const paid = r.status === 'Paid'
                  return (
                    <div key={r.id} style={{
                      display: 'grid', gridTemplateColumns: '1fr 76px 96px 1fr', gap: 8,
                      padding: '9px 10px', borderRadius: 10, alignItems: 'center',
                      background: paid ? 'rgba(34,211,168,0.05)' : 'rgba(244,63,94,0.04)',
                      border: `1px solid ${paid ? 'rgba(34,211,168,0.12)' : 'rgba(244,63,94,0.1)'}`,
                    }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{MONTHS[r.payment_month - 1]} {r.payment_year}</div>
                      <div>
                        <span className={`badge ${paid ? 'badge-success' : 'badge-danger'}`} style={{ fontSize: 10, padding: '2px 7px' }}>
                          {paid ? '✓ Paid' : '● Due'}
                        </span>
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 13, fontFamily: 'var(--font-display)' }}>${Number(r.amount).toLocaleString()}</div>
                      <div style={{ fontSize: 12, color: 'var(--clr-text-muted)' }}>
                        {r.paid_at ? new Date(r.paid_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 20px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, background: 'rgba(0,0,0,0.15)' }}>
          <div style={{ fontSize: 12, color: 'var(--clr-text-muted)' }}>{records.length} total record{records.length !== 1 ? 's' : ''}</div>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#22d3a8' }}>${totalPaid.toLocaleString()} total paid</div>
        </div>
      </div>
    </div>,
    document.body
  )
}
