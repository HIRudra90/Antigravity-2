import { Suspense, lazy, useState } from 'react'
import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Package, Users, RefreshCw,
  TrendingUp, CreditCard, Truck, BarChart3, Settings, Bell
} from 'lucide-react'
import SplineBackground from './components/SplineBackground'

const Dashboard     = lazy(() => import('./pages/Dashboard'))
const Inventory     = lazy(() => import('./pages/Inventory'))
const Employees     = lazy(() => import('./pages/Employees'))
const Restock       = lazy(() => import('./pages/Restock'))
const SalesForecast = lazy(() => import('./pages/SalesForecast'))
const Payment       = lazy(() => import('./pages/Payment'))
const Logistics     = lazy(() => import('./pages/Logistics'))
const Statistics    = lazy(() => import('./pages/Statistics'))
const Alerts        = lazy(() => import('./pages/Alerts'))
const SettingsPage  = lazy(() => import('./pages/Settings'))

const NAV_ITEMS = [
  { path: '/',          label: 'Dashboard',      icon: LayoutDashboard },
  { path: '/inventory', label: 'Inventory',      icon: Package },
  { path: '/employees', label: 'Employees',      icon: Users },
  { path: '/restock',   label: 'Restock',        icon: RefreshCw },
  { path: '/forecast',  label: 'Sales Forecast', icon: TrendingUp },
  { path: '/payment',   label: 'Payment',        icon: CreditCard },
  { path: '/logistics', label: 'Logistics',      icon: Truck },
  { path: '/statistics',label: 'Statistics',     icon: BarChart3 },
  { path: '/alerts',    label: 'Alerts',         icon: Bell },
]

function Sidebar() {
  const location = useLocation()

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <span className="sidebar-logo-text">Inventiq</span>
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map(({ path, label, icon: Icon }) => {
          const isActive = path === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(path)
          return (
            <NavLink
              key={path}
              to={path}
              className={`nav-item ${isActive ? 'active' : ''}`}
              aria-label={label}
            >
              <div className="nav-active-bar" />
              <div className="nav-item-icon">
                <Icon size={18} />
              </div>
              <span className="nav-item-label">{label}</span>
            </NavLink>
          )
        })}
      </nav>

      <div className="sidebar-bottom">
        <NavLink 
          to="/settings" 
          className={({isActive}) => `nav-item ${isActive ? 'active' : ''}`} 
        >
          <div className="nav-active-bar" />
          <div className="nav-item-icon"><Settings size={18} /></div>
          <span className="nav-item-label">Settings</span>
        </NavLink>

        {/* User avatar */}
        <div className="nav-item" style={{ marginTop: 8, cursor: 'default' }}>
          <div
            className="nav-item-icon avatar"
            style={{ background: 'linear-gradient(135deg,#6C63FF,#00D4FF)', borderRadius: '50%', width: 32, height: 32 }}
          >
            H
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>Hasidul</span>
            <span style={{ fontSize: 11, color: 'var(--clr-text-muted)' }}>Admin</span>
          </div>
        </div>
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

export default function App() {
  return (
    <BrowserRouter>
      <SplineBackground />

      <div className="app-shell">
        <Sidebar />
        <main className="main-content">
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/"           element={<Dashboard />} />
              <Route path="/inventory"  element={<Inventory />} />
              <Route path="/employees"  element={<Employees />} />
              <Route path="/restock"    element={<Restock />} />
              <Route path="/forecast"   element={<SalesForecast />} />
              <Route path="/payment"    element={<Payment />} />
              <Route path="/logistics"  element={<Logistics />} />
              <Route path="/statistics" element={<Statistics />} />
              <Route path="/alerts"     element={<Alerts />} />
              <Route path="/settings"   element={<SettingsPage />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </BrowserRouter>
  )
}
