import { Suspense, lazy, useState } from 'react'
import { BrowserRouter, Routes, Route, NavLink, useLocation, Navigate } from 'react-router-dom'
import {
  LayoutDashboard, Package, Users, RefreshCw,
  TrendingUp, CreditCard, Truck, BarChart3, Settings, Bell, Menu, X,
  Building2, LogOut,
} from 'lucide-react'
import SplineBackground from './components/SplineBackground'
import { AuthProvider, useAuth, Role } from './lib/auth'
import Login from './pages/Login'

const Dashboard        = lazy(() => import('./pages/Dashboard'))
const Inventory        = lazy(() => import('./pages/Inventory'))
const Employees        = lazy(() => import('./pages/Employees'))
const Restock          = lazy(() => import('./pages/Restock'))
const SalesForecast    = lazy(() => import('./pages/SalesForecast'))
const Payment          = lazy(() => import('./pages/Payment'))
const Logistics        = lazy(() => import('./pages/Logistics'))
const Statistics       = lazy(() => import('./pages/Statistics'))
const Alerts           = lazy(() => import('./pages/Alerts'))
const SettingsPage     = lazy(() => import('./pages/Settings'))
const AdminOwners      = lazy(() => import('./pages/admin/AdminOwners'))
const AdminOwnerDetail = lazy(() => import('./pages/admin/AdminOwnerDetail'))

// The two apps live in fully separate URL namespaces: /owner/* and /admin/*.
// Nothing but the login screen and a redirect sits at the root.
const OWNER_HOME = '/owner'
const ADMIN_HOME = '/admin'

const OWNER_NAV = [
  { path: '/owner',            label: 'Dashboard',      icon: LayoutDashboard },
  { path: '/owner/inventory',  label: 'Inventory',      icon: Package },
  { path: '/owner/employees',  label: 'Employees',      icon: Users },
  { path: '/owner/restock',    label: 'Restock',        icon: RefreshCw },
  { path: '/owner/forecast',   label: 'Sales Forecast', icon: TrendingUp },
  { path: '/owner/payment',    label: 'Payment',        icon: CreditCard },
  { path: '/owner/logistics',  label: 'Logistics',      icon: Truck },
  { path: '/owner/statistics', label: 'Statistics',     icon: BarChart3 },
  { path: '/owner/alerts',     label: 'Alerts',         icon: Bell },
]

const ADMIN_NAV = [
  { path: '/admin', label: 'Owners', icon: Building2 },
]

/** Where a signed-in user belongs, given their role. */
function homeFor(role?: Role) {
  return role === 'admin' ? ADMIN_HOME : OWNER_HOME
}

function Sidebar({
  mobileOpen, onClose, navItems, showSettings,
}: {
  mobileOpen: boolean
  onClose: () => void
  navItems: typeof OWNER_NAV
  showSettings: boolean
}) {
  const { profile, signOut } = useAuth()

  const displayName = profile?.full_name || profile?.email || 'User'
  const roleLabel = profile?.role === 'admin' ? 'Admin' : 'Owner'
  const homePath = homeFor(profile?.role)

  return (
    <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <span className="sidebar-logo-text">Inventiq</span>
        <button className="sidebar-close-btn" onClick={onClose} aria-label="Close menu"><X size={20} /></button>
      </div>

      <nav className="sidebar-nav">
        {navItems.map(({ path, label, icon: Icon }) => (
          // `end` stops the section root (/owner, /admin) from matching its own
          // child routes. The className MUST stay in callback form: given a
          // plain string, NavLink appends its own "active" class based on its
          // internal match, which is prefix-based and ignored any isActive we
          // computed ourselves -- that is what kept Dashboard lit up on every
          // page alongside the real active item.
          <NavLink
            key={path}
            to={path}
            end={path === homePath}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            aria-label={label}
            onClick={onClose}
          >
            <div className="nav-active-bar" />
            <div className="nav-item-icon">
              <Icon size={18} />
            </div>
            <span className="nav-item-label">{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-bottom">
        {showSettings && (
          <NavLink
            to="/owner/settings"
            className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`}
            onClick={onClose}
          >
            <div className="nav-active-bar" />
            <div className="nav-item-icon"><Settings size={18} /></div>
            <span className="nav-item-label">Settings</span>
          </NavLink>
        )}

        <div className="nav-item" style={{ marginTop: 8, cursor: 'default' }}>
          <div
            className="nav-item-icon avatar"
            style={{ background: 'linear-gradient(135deg,#6C63FF,#00D4FF)', borderRadius: '50%', width: 32, height: 32 }}
          >
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {displayName}
            </span>
            <span style={{ fontSize: 11, color: 'var(--clr-text-muted)' }}>{roleLabel}</span>
          </div>
        </div>

        <button
          className="nav-item"
          onClick={() => { onClose(); signOut() }}
          style={{ background: 'none', border: 'none', width: '100%', cursor: 'pointer', textAlign: 'left' }}
          aria-label="Sign out"
        >
          <div className="nav-active-bar" />
          <div className="nav-item-icon"><LogOut size={18} /></div>
          <span className="nav-item-label">Sign Out</span>
        </button>
      </div>
    </aside>
  )
}

function PageLoader() {
  return (
    <div style={{ padding: 28 }}>
      <div className="shimmer" style={{ height: 36, width: 220, marginBottom: 24 }} />
      <div className="stat-grid">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="shimmer" style={{ height: 120, borderRadius: 'var(--r-lg)' }} />
        ))}
      </div>
    </div>
  )
}

function FullScreenMessage({ title, body }: { title: string; body: string }) {
  const { signOut } = useAuth()
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, position: 'relative', zIndex: 1 }}>
      <div className="glass-card" style={{ maxWidth: 460, padding: 28 }}>
        <h2 style={{ margin: 0, fontSize: 18, color: '#fff' }}>{title}</h2>
        <p style={{ fontSize: 13, color: 'var(--clr-text-muted)', lineHeight: 1.7, margin: '12px 0 20px' }}>{body}</p>
        <button className="btn" onClick={signOut}><LogOut size={15} /> Sign Out</button>
      </div>
    </div>
  )
}

/** The existing business app — unchanged, now scoped to the signed-in owner. */
function OwnerApp() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  return (
    <div className="app-shell">
      <button className="mobile-menu-btn" onClick={() => setMobileNavOpen(true)} aria-label="Open menu">
        <Menu size={20} />
      </button>
      {mobileNavOpen && <div className="mobile-nav-backdrop" onClick={() => setMobileNavOpen(false)} />}
      <Sidebar mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} navItems={OWNER_NAV} showSettings />
      <main className="main-content">
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/owner"            element={<Dashboard />} />
            <Route path="/owner/inventory"  element={<Inventory />} />
            <Route path="/owner/employees"  element={<Employees />} />
            <Route path="/owner/restock"    element={<Restock />} />
            <Route path="/owner/forecast"   element={<SalesForecast />} />
            <Route path="/owner/payment"    element={<Payment />} />
            <Route path="/owner/logistics"  element={<Logistics />} />
            <Route path="/owner/statistics" element={<Statistics />} />
            <Route path="/owner/alerts"     element={<Alerts />} />
            <Route path="/owner/settings"   element={<SettingsPage />} />
            <Route path="*"                 element={<Navigate to={OWNER_HOME} replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  )
}

/** Admin console — owner directory and per-owner ordering. */
function AdminApp() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  return (
    <div className="app-shell">
      <button className="mobile-menu-btn" onClick={() => setMobileNavOpen(true)} aria-label="Open menu">
        <Menu size={20} />
      </button>
      {mobileNavOpen && <div className="mobile-nav-backdrop" onClick={() => setMobileNavOpen(false)} />}
      <Sidebar mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} navItems={ADMIN_NAV} showSettings={false} />
      <main className="main-content">
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/admin"                  element={<AdminOwners />} />
            <Route path="/admin/owners/:ownerId"  element={<AdminOwnerDetail />} />
            <Route path="*"                       element={<Navigate to="/admin" replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  )
}

function Root() {
  const { session, profile, loading, profileError } = useAuth()
  const location = useLocation()

  if (loading) return <PageLoader />

  // Signed out: only /login exists. Anything else sends you there.
  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*"      element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  if (profileError) {
    return (
      <FullScreenMessage
        title="Signed in, but your role could not be loaded"
        body={profileError}
      />
    )
  }
  if (!profile) return <PageLoader />

  const home = homeFor(profile.role)

  // Signed in: /login and / are not places to stay — bounce to your own app.
  // This also keeps an owner out of /admin and an admin out of /owner, so the
  // two namespaces never overlap in the browser.
  const inOwnNamespace = location.pathname.startsWith(home)
  if (!inOwnNamespace) return <Navigate to={home} replace />

  return profile.role === 'admin' ? <AdminApp /> : <OwnerApp />
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <SplineBackground />
      <AuthProvider>
        <Root />
      </AuthProvider>
    </BrowserRouter>
  )
}
