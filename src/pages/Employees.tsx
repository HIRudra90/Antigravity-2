import { useState, useEffect, useCallback, useRef } from 'react'
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid
} from 'recharts'
import {
  Users, UserCheck, DollarSign, Search, Plus, X, ChevronDown, ChevronUp,
  Phone, Mail, MapPin, Droplets, Calendar, Shield, Truck, Package,
  Trash2, ClipboardCheck, Sparkles, CheckCircle, AlertCircle, Edit,
  UploadCloud, Save
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
  const [expandedRole, setExpandedRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

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
          { label: 'Total Employees', value: totalEmployees, icon: Users, color: '#6C63FF' },
          { label: 'Active', value: activeCount, icon: UserCheck, color: '#22d3a8' },
          { label: 'Salary Paid', value: `$${paidAmount.toLocaleString()}`, icon: CheckCircle, color: '#00D4FF' },
          { label: 'Salary Due', value: `$${dueAmount.toLocaleString()}`, icon: AlertCircle, color: '#f43f5e' },
        ].map(s => (
          <div key={s.label} className="stat-card" style={{ '--card-glow': `${s.color}33` } as any}>
            <div className="stat-card-icon"><s.icon size={18} color={s.color} /></div>
            <div className="stat-card-label">{s.label}</div>
            <div className="stat-card-value">{s.value}</div>
          </div>
        ))}
      </div>

      {/* ─── Salary Infographics ─────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16, marginBottom: 24 }}>
        <div className="glass-card">
          <div className="section-title">Salary Overview</div>
          <div style={{ height: 200 }}>
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} dataKey="value" strokeWidth={0} paddingAngle={4}>
                    {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip formatter={(val: number) => `$${val.toLocaleString()}`}
                    contentStyle={{ background: 'rgba(10,12,25,0.92)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: '#fff' }}
                    itemStyle={{ color: '#fff' }} />
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

        <div className="glass-card">
          <div className="section-title">
            Salary by Role
            <button className="btn btn-primary btn-sm" onClick={payAllEmployees} disabled={dueCount === 0}>
              <DollarSign size={14} /> Pay All ({dueCount} due)
            </button>
          </div>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={roleBarData} barGap={2}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="role" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} />
                <Tooltip
                  contentStyle={{ background: 'rgba(10,12,25,0.92)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10 }}
                  itemStyle={{ color: '#fff' }} labelStyle={{ color: 'rgba(255,255,255,0.7)' }}
                  formatter={(val: number, name: string) => [`$${val.toLocaleString()}`, name === 'paid' ? 'Paid' : 'Due']}
                  labelFormatter={(label: string) => { const item = roleBarData.find(r => r.role === label); return item?.fullRole || label }}
                />
                <Bar dataKey="paid" fill="#22d3a8" radius={[4, 4, 0, 0]} />
                <Bar dataKey="due" fill="#f43f5e" radius={[4, 4, 0, 0]} opacity={0.7} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ─── Search ──────────────────────────────────────── */}
      <div className="glass-card mb-4">
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--clr-text-muted)' }} />
          <input className="glass-input" style={{ paddingLeft: 34 }} placeholder="Search by name or role…" value={search} onChange={e => setSearch(e.target.value)} />
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
            const isExpanded = expandedRole === role || expandedRole === null
            const RoleIcon = roleIcons[role] || Users
            const color = roleColors[role] || '#6C63FF'

            return (
              <div key={role} className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
                <div
                  onClick={() => setExpandedRole(expandedRole === role ? null : role)}
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
      {showAddModal && <EmployeeFormModal mode="add" onClose={() => setShowAddModal(false)} onSaved={fetchData} />}
      {editingEmployee && <EmployeeFormModal mode="edit" employee={editingEmployee} onClose={() => setEditingEmployee(null)} onSaved={() => { fetchData(); setShowProfileModal(null) }} />}

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

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      animation: 'pageIn 0.25s ease both'
    }} onClick={onClose}>
      <div
        className="glass-card"
        style={{ width: 580, maxHeight: '88vh', overflowY: 'auto', padding: 32, position: 'relative' }}
        onClick={e => e.stopPropagation()}
      >
        <button onClick={onClose} style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', color: 'var(--clr-text-muted)', cursor: 'pointer' }}>
          <X size={20} />
        </button>

        <h2 style={{ fontSize: 20, fontFamily: 'var(--font-display)', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
          {mode === 'edit' ? <><Edit size={20} color="#00D4FF" /> Edit Employee</> : <><Plus size={20} color="#6C63FF" /> Add New Employee</>}
        </h2>

        {/* Profile Image Upload */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
          <ImageUpload
            currentUrl={form.profile_image_url || null}
            onImageChange={(url) => update('profile_image_url', url || '')}
            size={90}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Full Name *</label>
            <input className="glass-input" placeholder="John Doe" value={form.name} onChange={e => update('name', e.target.value)} />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Email</label>
            <input className="glass-input" type="email" placeholder="john@company.com" value={form.email} onChange={e => update('email', e.target.value)} />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Contact Number</label>
            <input className="glass-input" placeholder="+880 1XXXXXXXXX" value={form.contact_number} onChange={e => update('contact_number', e.target.value)} />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Emergency Contact</label>
            <input className="glass-input" placeholder="+880 …" value={form.emergency_contact} onChange={e => update('emergency_contact', e.target.value)} />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Blood Group</label>
            <select className="glass-input" value={form.blood_group} onChange={e => update('blood_group', e.target.value)}>
              <option value="">Select</option>
              {BLOOD_GROUPS.map(bg => <option key={bg} value={bg}>{bg}</option>)}
            </select>
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Address</label>
            <input className="glass-input" placeholder="123 Street, City" value={form.address} onChange={e => update('address', e.target.value)} />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Role *</label>
            <select className="glass-input" value={form.role} onChange={e => update('role', e.target.value)}>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Monthly Salary ($) *</label>
            <input className="glass-input" type="number" placeholder="3000" value={form.monthly_salary} onChange={e => update('monthly_salary', e.target.value)} />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Joined Date</label>
            <input className="glass-input" type="date" value={form.joined_date} onChange={e => update('joined_date', e.target.value)} />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--clr-text-muted)', marginBottom: 6 }}>Status</label>
            <select className="glass-input" value={form.status} onChange={e => update('status', e.target.value)}>
              <option value="Active">Active</option>
              <option value="On Leave">On Leave</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 24, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || !form.name.trim() || !form.monthly_salary}>
            <Save size={14} /> {saving ? 'Saving…' : mode === 'edit' ? 'Save Changes' : 'Add Employee'}
          </button>
        </div>
      </div>
    </div>
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
  const isPaid = payment?.status === 'Paid'

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      animation: 'pageIn 0.25s ease both'
    }} onClick={onClose}>
      <div
        className="glass-card"
        style={{ width: 500, maxHeight: '88vh', overflowY: 'auto', padding: 0, position: 'relative' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Banner */}
        <div style={{ height: 100, background: `linear-gradient(135deg, ${roleColor}44, ${roleColor}11)`, position: 'relative', borderRadius: 'var(--r-lg) var(--r-lg) 0 0' }}>
          <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 8 }}>
            <button onClick={onEdit} style={{ background: 'rgba(0,0,0,0.3)', border: 'none', color: '#fff', cursor: 'pointer', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Edit">
              <Edit size={14} />
            </button>
            <button onClick={onClose} style={{ background: 'rgba(0,0,0,0.3)', border: 'none', color: '#fff', cursor: 'pointer', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Avatar overlapping banner */}
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: -40 }}>
          {employee.profile_image_url ? (
            <img src={employee.profile_image_url} alt={employee.name} style={{ width: 80, height: 80, borderRadius: '50%', objectFit: 'cover', border: '4px solid rgba(5,8,16,0.8)', boxShadow: `0 0 20px ${roleColor}44` }} />
          ) : (
            <div style={{
              width: 80, height: 80, borderRadius: '50%',
              background: `linear-gradient(135deg, ${roleColor}, ${roleColor}88)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 28, fontWeight: 700, color: '#fff',
              border: '4px solid rgba(5,8,16,0.8)',
              boxShadow: `0 0 20px ${roleColor}44`
            }}>
              {employee.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
            </div>
          )}
        </div>

        <div style={{ padding: '12px 28px 28px' }}>
          {/* Name & Role */}
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <h2 style={{ fontSize: 22, fontFamily: 'var(--font-display)', fontWeight: 700 }}>{employee.name}</h2>
            <span className="badge" style={{ background: `${roleColor}22`, color: roleColor, border: `1px solid ${roleColor}44`, marginTop: 6 }}>
              {employee.role}
            </span>
          </div>

          {/* Details Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
            {[
              { icon: Mail, label: 'Email', value: employee.email },
              { icon: Phone, label: 'Phone', value: employee.contact_number },
              { icon: Phone, label: 'Emergency', value: employee.emergency_contact },
              { icon: Droplets, label: 'Blood Group', value: employee.blood_group },
              { icon: MapPin, label: 'Address', value: employee.address },
              { icon: Calendar, label: 'Joined', value: employee.joined_date ? new Date(employee.joined_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '–' },
            ].map((item, i) => (
              <div key={i} style={{
                background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--r-sm)',
                padding: 12, border: '1px solid rgba(255,255,255,0.06)',
                gridColumn: item.label === 'Address' ? '1 / -1' : undefined
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--clr-text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                  <item.icon size={12} /> {item.label}
                </div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{item.value || '–'}</div>
              </div>
            ))}
          </div>

          {/* Salary Section */}
          <div style={{
            background: isPaid ? 'rgba(34,211,168,0.06)' : 'rgba(244,63,94,0.06)',
            border: `1px solid ${isPaid ? 'rgba(34,211,168,0.2)' : 'rgba(244,63,94,0.2)'}`,
            borderRadius: 'var(--r-md)', padding: 16, marginBottom: 20
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--clr-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Monthly Salary</div>
                <div style={{ fontSize: 28, fontWeight: 700, fontFamily: 'var(--font-display)' }}>
                  ${Number(employee.monthly_salary).toLocaleString()}
                </div>
                <div style={{ fontSize: 12, color: 'var(--clr-text-muted)', marginTop: 4 }}>
                  {yearsWorking} year{yearsWorking !== 1 ? 's' : ''} with company
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
                <span className={`badge ${isPaid ? 'badge-success' : 'badge-danger'}`} style={{ fontSize: 13, padding: '5px 14px' }}>
                  {isPaid ? '✓ Paid' : '● Due'}
                </span>
                {!isPaid && (
                  <button className="btn btn-primary btn-sm" onClick={onPay}>
                    <DollarSign size={14} /> Mark as Paid
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={onEdit}>
              <Edit size={14} /> Edit Profile
            </button>
            <button className="btn btn-danger btn-sm" onClick={onDelete}>
              <Trash2 size={14} /> Remove
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
