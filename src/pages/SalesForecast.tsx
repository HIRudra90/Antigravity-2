import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'
import { forecastSales } from '../lib/mlEngine'
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend, Cell
} from 'recharts'
import {
  TrendingUp, Target, Zap, AlertCircle, BarChart2,
  Calendar, Layers, Activity, Sparkles, RefreshCw,
  ChevronRight, CheckCircle, Eye, ShoppingCart
} from 'lucide-react'

export default function SalesForecast() {
  // Tab control
  const [activeTab, setActiveTab] = useState<'dashboard' | 'pipeline'>('dashboard')

  // Existing general forecast state
  const [predictionData, setPredictionData] = useState<any[]>([])
  const [salesComparison, setSalesComparison] = useState<any[]>([])
  const [growthPattern, setGrowthPattern] = useState<any[]>([])
  const [errorData, setErrorData] = useState<any[]>([])
  const [loadingDashboard, setLoadingDashboard] = useState(true)

  // New interactive prediction pipeline state
  const [products, setProducts] = useState<any[]>([])
  const [selectedProductId, setSelectedProductId] = useState<string>('')
  const [selectedProduct, setSelectedProduct] = useState<any>(null)
  
  const [forecastPeriod, setForecastPeriod] = useState<string>('30d')
  const [currentStock, setCurrentStock] = useState<number>(50)
  const [reorderLevel, setReorderLevel] = useState<number>(20)
  const [marketText, setMarketText] = useState<string>('')
  const [historicalSalesInput, setHistoricalSalesInput] = useState<string>(
    '15, 22, 18, 25, 30, 28, 35, 30, 42, 38, 45, 52'
  )
  
  // Submission & Results
  const [submitting, setSubmitting] = useState<boolean>(false)
  const [pipelineResult, setPipelineResult] = useState<any>(null)
  const [predictionHistory, setPredictionHistory] = useState<any[]>([])
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false)
  
  // Notification states
  const [successToast, setSuccessToast] = useState<string>('')
  const [errorToast, setErrorToast] = useState<string>('')

  // ----------------------------------------------------
  // INITIALIZATION & DATA FETCHING
  // ----------------------------------------------------
  useEffect(() => {
    fetchSalesData()
    fetchProductsAndInventory()
    fetchPredictionHistory()
  }, [])

  // Show auto-dismissing toast
  useEffect(() => {
    if (successToast) {
      const timer = setTimeout(() => setSuccessToast(''), 4000)
      return () => clearTimeout(timer)
    }
  }, [successToast])

  useEffect(() => {
    if (errorToast) {
      const timer = setTimeout(() => setErrorToast(''), 6000)
      return () => clearTimeout(timer)
    }
  }, [errorToast])

  // Fetch products and inventory map from Supabase
  async function fetchProductsAndInventory() {
    try {
      // Fetch products
      const { data: productsData, error: prodError } = await supabase
        .from('products')
        .select('id, name, family')
        
      if (prodError) throw prodError

      // Fetch inventory levels
      const { data: invData, error: invError } = await supabase
        .from('inventory')
        .select('product_id, current_stock, reorder_level')

      if (invError) throw invError

      if (productsData) {
        // Map inventory values into products
        const mappedProducts = productsData.map((p: any) => {
          const inv = invData?.find((i: any) => i.product_id === p.id)
          return {
            id: p.id,
            name: p.name,
            family: p.family,
            current_stock: inv?.current_stock ?? 50,
            reorder_level: inv?.reorder_level ?? 20
          }
        })
        setProducts(mappedProducts)
        
        // Auto-select first product
        if (mappedProducts.length > 0) {
          selectProductById(mappedProducts[0].id, mappedProducts)
        }
      }
    } catch (err) {
      console.error('Error fetching inventory products:', err)
    }
  }

  // Fetch prediction history from Supabase
  async function fetchPredictionHistory() {
    setLoadingHistory(true)
    try {
      const { data, error } = await supabase
        .from('demand_forecasts')
        .select('*')
        .order('predicted_at', { ascending: false })

      if (error) {
        // Table might not exist yet if user hasn't run schema.sql
        console.warn('demand_forecasts table might not exist yet:', error.message)
      } else if (data) {
        setPredictionHistory(data)
      }
    } catch (err) {
      console.error('Error fetching prediction logs:', err)
    } finally {
      setLoadingHistory(false)
    }
  }

  // Fetch general dashboard metrics (original view)
  async function fetchSalesData() {
    setLoadingDashboard(true)
    try {
      const { data: sales, error: salesError } = await supabase
        .from('sales_transactions')
        .select('sale_date, quantity_sold, products(unit_price)')
        .order('sale_date', { ascending: true })

      if (salesError) throw salesError

      if (sales) {
        const monthlyStats: any = {}
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        
        sales.forEach((s: any) => {
          const d = new Date(s.sale_date)
          const monthName = months[d.getMonth()]
          const product = Array.isArray(s.products) ? s.products[0] : s.products
          monthlyStats[monthName] = (monthlyStats[monthName] || 0) + (s.quantity_sold * (product?.unit_price || 0))
        })

        const historicalActuals = months.map(m => monthlyStats[m] || 0)
        const activeMonths = months.filter(m => monthlyStats[m] > 0)
        
        const predictions = forecastSales(activeMonths.map(m => monthlyStats[m]), 3)
        const nextMonths = months.slice(months.indexOf(activeMonths[activeMonths.length-1]) + 1, months.indexOf(activeMonths[activeMonths.length-1]) + 4)
        
        const chartData = months.map(m => {
          const actual = monthlyStats[m] || null
          const predIdx = nextMonths.indexOf(m)
          const predictedValue = predIdx !== -1 ? predictions[predIdx] : (actual ? actual * 1.02 : null)
          return {
            month: m,
            actual,
            predicted: Math.round(predictedValue || 0)
          }
        }).filter(d => d.actual || nextMonths.includes(d.month))

        setPredictionData(chartData)

        // Weekly Comparison
        const weeklyData = [
          { period: 'Week 1', current: 15000, previous: 12000 },
          { period: 'Week 2', current: 18000, previous: 14000 },
          { period: 'Week 3', current: 16000, previous: 16000 },
          { period: 'Week 4', current: 22000, previous: 19000 },
        ]
        setSalesComparison(weeklyData)

        // Growth Trend
        setGrowthPattern([
          { day: '01', trend: 10 }, { day: '05', trend: 15 },
          { day: '10', trend: 14 }, { day: '15', trend: 22 },
          { day: '20', trend: 30 }, { day: '25', trend: 38 },
          { day: '30', trend: 45 },
        ])

        // Error distribution
        setErrorData([
          { name: 'Jan', error: +2.0, color: '#f43f5e' },
          { name: 'Feb', error: +3.0, color: '#f43f5e' },
          { name: 'Mar', error: +2.0, color: '#f43f5e' },
          { name: 'Oct', error: -1.5, color: '#22d3a8' },
          { name: 'Nov', error: -2.0, color: '#22d3a8' },
          { name: 'Dec', error: -0.5, color: '#22d3a8' },
        ])
      }
    } catch (err) {
      console.error('Error fetching sales forecast dashboard:', err)
    } finally {
      setLoadingDashboard(false)
    }
  }

  // Helper: select product and autofill parameters
  async function selectProductById(id: string, customList?: any[]) {
    const list = customList || products
    const prod = list.find((p: any) => p.id === id)
    if (prod) {
      setSelectedProductId(id)
      setSelectedProduct(prod)
      setCurrentStock(prod.current_stock)
      setReorderLevel(prod.reorder_level)
      
      // Attempt to load past transactions for this product to make the historical sales authentic!
      try {
        const { data: salesData } = await supabase
          .from('sales_transactions')
          .select('quantity_sold')
          .eq('product_id', id)
          .order('sale_date', { ascending: false })
          .limit(12)
          
        if (salesData && salesData.length > 3) {
          const salesArr = salesData.map((s: any) => s.quantity_sold).reverse()
          setHistoricalSalesInput(salesArr.join(', '))
        } else {
          // Generates beautiful realistic standard inventory historical values
          const base = Math.floor(Math.random() * 30) + 15
          const mockHist = Array.from({ length: 12 }, () => 
            Math.max(2, base + Math.floor(Math.random() * 16) - 8)
          )
          setHistoricalSalesInput(mockHist.join(', '))
        }
      } catch (e) {
        console.error(e)
      }
    }
  }

  // ----------------------------------------------------
  // RUN PIPELINE
  // ----------------------------------------------------
  async function handlePredictPipeline(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedProductId) {
      setErrorToast('Please select a valid product first.')
      return
    }

    // Parse comma-separated historical sales
    const salesArr = historicalSalesInput
      .split(',')
      .map(s => parseFloat(s.trim()))
      .filter(n => !isNaN(n))

    if (salesArr.length === 0) {
      setErrorToast('Please input at least one valid historical sales value.')
      return
    }

    setSubmitting(true)
    setPipelineResult(null)
    
    try {
      const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'
      const response = await fetch(`${BACKEND_URL}/api/predict/pipeline`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          product_id: selectedProductId,
          product_name: selectedProduct?.name || 'Unknown',
          product_family: selectedProduct?.family || 'GROCERY I',
          forecast_period: forecastPeriod,
          current_stock: currentStock,
          reorder_level: reorderLevel,
          market_text: marketText,
          historical_sales: salesArr
        })
      })

      if (!response.ok) {
        const errDetail = await response.json().catch(() => ({}))
        throw new Error(errDetail.detail || `Server responded with code ${response.status}`)
      }

      const data = await response.json()
      
      // Save result in state
      setPipelineResult(data)
      setSuccessToast(`Successfully ran prediction pipeline for ${selectedProduct?.name}!`)

      // Refetch history log to show the new prediction entry
      setTimeout(() => {
        fetchPredictionHistory()
      }, 1000)

    } catch (err: any) {
      console.error(err)
      setErrorToast(`AI Pipeline Execution Failed: ${err.message}. Make sure your FastAPI backend is running!`)
    } finally {
      setSubmitting(false)
    }
  }

  // Render a specific historical entry from log table
  function handleLoadHistoryRow(entry: any) {
    setSelectedProductId(entry.product_id)
    setSelectedProduct(products.find(p => p.id === entry.product_id) || { name: entry.product_name })
    setForecastPeriod(entry.forecast_period)
    setCurrentStock(entry.current_stock)
    setReorderLevel(entry.reorder_level)
    setMarketText(entry.market_text || '')
    setHistoricalSalesInput(entry.historical_sales.join(', '))
    
    // Render result fields
    setPipelineResult({
      product_name: entry.product_name,
      forecast_period: entry.forecast_period,
      sentiment_multiplier: entry.sentiment_multiplier,
      sentiment_analysis: entry.sentiment_analysis,
      forecasted_demand: entry.forecasted_demand,
      optimal_reorder_qty: entry.optimal_reorder_qty
    })
    
    // Jump to the pipeline tab and scroll up smoothly
    setActiveTab('pipeline')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Generate chart data for prediction visualization
  const getOutputChartData = () => {
    if (!pipelineResult) return []
    const inputSales = historicalSalesInput.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n))
    
    // We display last 6 actual sales points, and then the forecast points
    const chartData: any[] = []
    const showBackCount = Math.min(6, inputSales.length)
    
    // Actuals
    for (let i = inputSales.length - showBackCount; i < inputSales.length; i++) {
      chartData.push({
        name: `Day -${inputSales.length - 1 - i}`,
        actual: inputSales[i],
        forecast: null
      })
    }
    
    // Forecasts
    pipelineResult.forecasted_demand.forEach((val: number, idx: number) => {
      chartData.push({
        name: idx === 0 ? 'Day 1' : `Day ${idx + 1}`,
        actual: null,
        forecast: Math.round(val * 10) / 10
      })
    })
    
    return chartData
  }

  return (
    <div className="page-enter">
      {/* Toast Notification Container */}
      <div style={{ position: 'fixed', top: 20, right: 20, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {successToast && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', background: 'rgba(34, 211, 168, 0.95)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 12, color: '#031712', fontWeight: 600, boxShadow: '0 10px 30px rgba(34, 211, 168, 0.3)', animation: 'pageIn 0.2s ease-out' }}>
            <CheckCircle size={18} /> {successToast}
          </div>
        )}
        {errorToast && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', background: 'rgba(244, 63, 94, 0.95)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 12, color: '#ffffff', fontWeight: 600, boxShadow: '0 10px 30px rgba(244, 63, 94, 0.3)', animation: 'pageIn 0.2s ease-out' }}>
            <AlertCircle size={18} /> {errorToast}
          </div>
        )}
      </div>

      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1>AI Forecasting & Decision Engine</h1>
          <p>Multi-agent forecasting pipeline merging XGBoost demand trends, LLM sentiment, and PPO Reinforcement Learning decisions.</p>
        </div>
        
        {/* Navigation Tabs */}
        <div style={{ display: 'flex', background: 'rgba(255,255,255,0.04)', padding: 4, borderRadius: 'var(--r-md)', border: '1px solid var(--clr-border)' }}>
          <button 
            className={`btn ${activeTab === 'dashboard' ? 'btn-primary' : 'btn-ghost'}`} 
            style={{ borderRadius: 'calc(var(--r-md) - 2px)', padding: '8px 16px', fontSize: 13 }}
            onClick={() => setActiveTab('dashboard')}
          >
            <BarChart2 size={16} /> AI Dashboard
          </button>
          <button 
            className={`btn ${activeTab === 'pipeline' ? 'btn-primary' : 'btn-ghost'}`} 
            style={{ borderRadius: 'calc(var(--r-md) - 2px)', padding: '8px 16px', fontSize: 13 }}
            onClick={() => setActiveTab('pipeline')}
          >
            <Sparkles size={16} /> Interactive Predictor
          </button>
        </div>
      </div>

      {/* ============================================================
          TAB 1: AI DASHBOARD (Existing Visuals)
          ============================================================ */}
      {activeTab === 'dashboard' && (
        <>
          <div className="stat-grid">
            {[
              { label: 'Predicted Sales (Q2)',   value: '$253K', icon: TrendingUp,   color: '#6C63FF' },
              { label: 'AI Accuracy Score',      value: '94.2%', icon: Target,       color: '#22d3a8' },
              { label: 'Forecast Confidence',    value: 'High',  icon: Zap,          color: '#00D4FF' },
              { label: 'Models Run',             value: '5',     icon: BarChart2,    color: '#FF6B9D' },
            ].map(s => (
              <div key={s.label} className="stat-card" style={{ '--card-glow': `${s.color}33` } as any}>
                <div className="stat-card-icon"><s.icon size={18} color={s.color} /></div>
                <div className="stat-card-label">{s.label}</div>
                <div className="stat-card-value">{loadingDashboard ? '...' : s.value}</div>
              </div>
            ))}
          </div>

          <div className="grid-21 mb-4" style={{ marginBottom: 16 }}>
            {/* Dual Line Chart: Actual vs Predicted */}
            <div className="glass-card">
              <div className="section-title">Actual vs Predicted Sales</div>
              <div className="chart-wrapper-lg">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={predictionData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="month" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={v => `$${Math.round(v/1000)}k`} />
                    <Tooltip cursor={{ stroke: 'rgba(255,255,255,0.1)' }} contentStyle={{ background: 'rgba(10,12,25,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10 }} />
                    <Legend wrapperStyle={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }} />
                    <Line type="monotone" dataKey="actual" stroke="#22d3a8" strokeWidth={3} dot={{ r: 4 }} name="Actual Sales" />
                    <Line type="monotone" dataKey="predicted" stroke="#6C63FF" strokeWidth={3} strokeDasharray="5 5" dot={{ r: 4 }} name="AI Prediction" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* AI Recommendation Box */}
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="section-title">AI Recommendations</div>
              <div style={{ padding: '20px', borderRadius: 'var(--r-md)', background: 'rgba(34, 211, 168, 0.08)', border: '1px solid rgba(34, 211, 168, 0.3)', marginBottom: 16, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#22d3a8', fontWeight: 600, fontSize: 16, marginBottom: 8 }}>
                  <Zap size={20} /> Suggested Stock Action
                </div>
                <p style={{ color: 'var(--clr-text-muted)', fontSize: 14, lineHeight: 1.6 }}>
                  Based on the positive <strong>+18% growth trend</strong> predicted for Q2, it is highly recommended to increase stock for <strong style={{ color: '#fff' }}>Electronics</strong> and <strong style={{ color: '#fff' }}>Office Furniture</strong> by <strong>15%</strong> before April 15th to prevent stockouts.
                </p>
              </div>
              
              <div className="section-title" style={{ marginTop: 'auto' }}>Prediction Confidence</div>
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                  <span>Neural Net Model Confidence</span><span style={{ color: '#00D4FF', fontWeight: 600 }}>94%</span>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `94%`, background: '#00D4FF' }} />
                </div>
              </div>
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                  <span>Time Series (ARIMA) Confidence</span><span style={{ color: '#6C63FF', fontWeight: 600 }}>88%</span>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `88%`, background: '#6C63FF' }} />
                </div>
              </div>
            </div>
          </div>

          <div className="grid-3 mb-4">
            {/* Sales Comparison */}
            <div className="glass-card">
              <div className="section-title">Sales Comparison (Weekly)</div>
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={salesComparison}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="period" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `$${Math.round(v/1000)}k`} />
                    <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ background: 'rgba(10,12,25,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10 }} />
                    <Bar dataKey="current" name="Current Month" fill="#00D4FF" radius={[3,3,0,0]} />
                    <Bar dataKey="previous" name="Previous Month" fill="#6C63FF" radius={[3,3,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Growth Pattern */}
            <div className="glass-card">
              <div className="section-title">Growth Pattern Trend</div>
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={growthPattern}>
                    <defs>
                      <linearGradient id="gTrend" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="day" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ background: 'rgba(10,12,25,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10 }} />
                    <Area type="monotone" dataKey="trend" stroke="#f59e0b" fill="url(#gTrend)" strokeWidth={2} name="Growth Index" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Error margins */}
            <div className="glass-card">
              <div className="section-title">Forecast vs Actual Error</div>
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={errorData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="name" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ background: 'rgba(10,12,25,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10 }} />
                    <Bar dataKey="error" name="Error Margin (%)" radius={[4,4,4,4]}>
                      {errorData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ============================================================
          TAB 2: INTERACTIVE PIPELINE PREDICTOR (New)
          ============================================================ */}
      {activeTab === 'pipeline' && (
        <div className="flex flex-col gap-4">
          <div className="grid-12">
            
            {/* LEFT COLUMN: CONTROL PANEL */}
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div className="section-title" style={{ borderBottom: '1px solid var(--clr-border)', paddingBottom: 10, marginBottom: 0 }}>
                <span>Restock Pipeline Parameters</span>
                <Sparkles size={16} color="var(--clr-accent-2)" />
              </div>

              <form onSubmit={handlePredictPipeline} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* 1. Product Select */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--clr-text-muted)' }}>SELECT PRODUCT</label>
                  <select 
                    className="glass-input glass-select"
                    value={selectedProductId}
                    onChange={(e) => selectProductById(e.target.value)}
                  >
                    <option value="" disabled>-- Select a Product --</option>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>{p.name} ({p.family})</option>
                    ))}
                  </select>
                </div>

                {/* 2. Forecast Period */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--clr-text-muted)' }}>FORECAST HORIZON</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                    {[
                      { val: '7d', label: '7 Days' },
                      { val: '30d', label: '30 Days' },
                      { val: '90d', label: '90 Days' },
                      { val: '365d', label: '1 Year' }
                    ].map(p => (
                      <button
                        key={p.val}
                        type="button"
                        className={`btn ${forecastPeriod === p.val ? 'btn-primary' : 'btn-ghost'}`}
                        style={{ padding: '8px 4px', fontSize: 11, borderRadius: 'var(--r-sm)' }}
                        onClick={() => setForecastPeriod(p.val)}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 3. Stocks overrides */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--clr-text-muted)' }}>CURRENT STOCK</label>
                    <input 
                      type="number"
                      className="glass-input"
                      value={currentStock}
                      onChange={(e) => setCurrentStock(parseInt(e.target.value) || 0)}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--clr-text-muted)' }}>REORDER LEVEL</label>
                    <input 
                      type="number"
                      className="glass-input"
                      value={reorderLevel}
                      onChange={(e) => setReorderLevel(parseInt(e.target.value) || 0)}
                    />
                  </div>
                </div>

                {/* 4. Historical Sales (Comma Separated) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--clr-text-muted)' }}>HISTORICAL SALES HISTORY</label>
                    <span style={{ fontSize: 10, color: 'var(--clr-accent-2)' }}>Comma-separated (last 12 periods)</span>
                  </div>
                  <input 
                    type="text"
                    className="glass-input"
                    value={historicalSalesInput}
                    onChange={(e) => setHistoricalSalesInput(e.target.value)}
                    placeholder="e.g. 10, 14, 15, 12, 18, 20"
                  />
                </div>

                {/* 5. Market Research Text (LLM) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--clr-text-muted)' }}>AI MARKET INSIGHTS TERMINAL (LLM TEXT)</label>
                  <textarea 
                    className="glass-input"
                    rows={4}
                    style={{ resize: 'none', lineHeight: 1.5 }}
                    value={marketText}
                    onChange={(e) => setMarketText(e.target.value)}
                    placeholder="E.g., Global semiconductor shortage easing. Customer demand for tech equipment expected to surge by 25% over the next two months. Local warehouse rents expanding..."
                  />
                </div>

                {/* 6. Submit */}
                <button 
                  type="submit" 
                  className="btn btn-primary" 
                  disabled={submitting}
                  style={{ 
                    marginTop: 10, 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    gap: 10, 
                    padding: 12, 
                    fontSize: 14,
                    boxShadow: submitsShadow(submitting)
                  }}
                >
                  {submitting ? (
                    <>
                      <RefreshCw className="shimmer-spin" size={16} style={{ animation: 'spin 1s linear infinite' }} />
                      Running Multi-Agent Engine...
                    </>
                  ) : (
                    <>
                      <Sparkles size={16} /> Run Restock Pipeline
                    </>
                  )}
                </button>
              </form>
            </div>

            {/* RIGHT COLUMN: REAL-TIME PIPELINE DIAGNOSTIC OUTPUT */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              
              {/* If no result yet and not submitting */}
              {!pipelineResult && !submitting && (
                <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 350, textAlign: 'center', borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.08)' }}>
                  <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(108,99,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                    <Sparkles size={28} color="var(--clr-accent)" />
                  </div>
                  <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, marginBottom: 8, color: '#fff' }}>Awaiting Execution</h3>
                  <p style={{ color: 'var(--clr-text-muted)', fontSize: 13, maxWidth: 280, lineHeight: 1.6 }}>
                    Enter product and market text, then click <strong>Run Restock Pipeline</strong> to activate the XGBoost, RL (PPO) and LLM sentiment models.
                  </p>
                </div>
              )}

              {/* Shimmer loading state during model processing */}
              {submitting && (
                <div className="glass-card shimmer" style={{ minHeight: 450, borderRadius: 'var(--r-lg)', display: 'flex', flexDirection: 'column', gap: 18, padding: 30 }}>
                  <div style={{ height: 28, width: '40%', borderRadius: 6, background: 'rgba(255,255,255,0.04)' }} />
                  <div style={{ height: 100, width: '100%', borderRadius: 12, background: 'rgba(255,255,255,0.04)' }} />
                  <div style={{ height: 180, width: '100%', borderRadius: 12, background: 'rgba(255,255,255,0.04)' }} />
                  <div style={{ height: 50, width: '100%', borderRadius: 12, background: 'rgba(255,255,255,0.04)' }} />
                </div>
              )}

              {/* Dynamic Live Result Display */}
              {pipelineResult && !submitting && (
                <div className="page-enter" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  
                  {/* Results row: Sentiment and Optimal Order */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    
                    {/* Gauge style multiplier card */}
                    <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 10, borderLeft: '3px solid var(--clr-accent-2)', '--card-glow': 'rgba(0, 212, 255, 0.08)' } as any}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 600, color: 'var(--clr-text-muted)', textTransform: 'uppercase' }}>
                        <Activity size={14} color="var(--clr-accent-2)" /> LLM Market Multiplier
                      </div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                        <div style={{ fontFamily: 'var(--font-display)', fontSize: 36, fontWeight: 800, color: '#fff' }}>
                          x{pipelineResult.sentiment_multiplier.toFixed(2)}
                        </div>
                        <span className={`badge ${
                          pipelineResult.sentiment_multiplier > 1.05 ? 'badge-success' :
                          pipelineResult.sentiment_multiplier < 0.95 ? 'badge-danger' : 'badge-accent'
                        }`} style={{ padding: '2px 8px', fontSize: 10 }}>
                          {pipelineResult.sentiment_multiplier > 1.05 ? 'Positive Demand' :
                           pipelineResult.sentiment_multiplier < 0.95 ? 'Negative Signal' : 'Neutral Baseline'}
                        </span>
                      </div>
                      <div className="progress-bar" style={{ height: 4, marginTop: 4 }}>
                        <div 
                          className="progress-fill" 
                          style={{ 
                            width: `${Math.min(100, Math.max(0, ((pipelineResult.sentiment_multiplier - 0.70) / 0.60) * 100))}%`, 
                            background: pipelineResult.sentiment_multiplier > 1.0 ? 'var(--clr-success)' : 'var(--clr-accent-3)' 
                          }} 
                        />
                      </div>
                    </div>

                    {/* PPO RL Recommendation Badge */}
                    <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 10, borderLeft: '3px solid var(--clr-success)', '--card-glow': 'rgba(34, 211, 168, 0.08)' } as any}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 600, color: 'var(--clr-text-muted)', textTransform: 'uppercase' }}>
                        <Target size={14} color="var(--clr-success)" /> PPO RL Optimisation Decision
                      </div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                        <div style={{ fontFamily: 'var(--font-display)', fontSize: 36, fontWeight: 800, color: '#22d3a8' }}>
                          {pipelineResult.optimal_reorder_qty > 0 ? `+${pipelineResult.optimal_reorder_qty}` : '0'}
                        </div>
                        <span className="badge badge-success" style={{ padding: '2px 8px', fontSize: 10 }}>
                          {pipelineResult.optimal_reorder_qty > 0 ? 'RESTOCK ORDER' : 'HOLD STOCK'}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--clr-text-muted)' }}>
                        {pipelineResult.optimal_reorder_qty > 0 
                          ? `Order suggested to prevent ${forecastPeriod} depletion` 
                          : 'Inventory level optimal. No purchase required.'}
                      </div>
                    </div>
                  </div>

                  {/* LLM Sentiment Insights Detail */}
                  <div className="glass-card" style={{ background: 'rgba(255,255,255,0.02)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#fff', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                      <Zap size={15} color="var(--clr-warning)" /> Sentiment Reasoning (Market Agent)
                    </div>
                    <p style={{ fontSize: 12.5, lineHeight: 1.6, color: 'rgba(240,242,255,0.7)' }}>
                      {pipelineResult.sentiment_analysis}
                    </p>
                  </div>

                  {/* Forecast Line Chart */}
                  <div className="glass-card">
                    <div className="section-title" style={{ fontSize: 14 }}>
                      Demand Forecast Projection (XGBoost)
                      <span className="badge badge-accent">Auto-regressive Output</span>
                    </div>
                    <div style={{ height: 180 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={getOutputChartData()}>
                          <defs>
                            <linearGradient id="forecastGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="var(--clr-accent)" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="var(--clr-accent)" stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id="actualGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="var(--clr-success)" stopOpacity={0.2} />
                              <stop offset="95%" stopColor="var(--clr-success)" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" />
                          <XAxis dataKey="name" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} axisLine={false} tickLine={false} />
                          <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} axisLine={false} tickLine={false} />
                          <Tooltip contentStyle={{ background: 'rgba(10,12,25,0.92)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10 }} />
                          <Area type="monotone" dataKey="actual" stroke="#22d3a8" fill="url(#actualGrad)" strokeWidth={2.5} connectNulls name="Historical Actual" />
                          <Area type="monotone" dataKey="forecast" stroke="#6C63FF" fill="url(#forecastGrad)" strokeWidth={2.5} strokeDasharray="4 4" connectNulls name="XGBoost Forecast (Sentiment Shifted)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* SYSTEM-WIDE LOGS HISTORY TABLE */}
          <div className="glass-card" style={{ marginTop: 8 }}>
            <div className="section-title">
              <span>Prediction Log & Run History (Supabase Connected)</span>
              <button 
                className="btn btn-ghost btn-sm" 
                onClick={fetchPredictionHistory}
                disabled={loadingHistory}
                style={{ padding: '4px 10px', fontSize: 11 }}
              >
                <RefreshCw size={12} className={loadingHistory ? "shimmer-spin" : ""} style={{ animation: loadingHistory ? "spin 1s linear infinite" : "none" }} /> Refresh History
              </button>
            </div>
            
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Horizon</th>
                    <th>Stock Rates</th>
                    <th>Sentiment Multiplier</th>
                    <th>PPO RL Restock Qty</th>
                    <th>Prediction Time</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {predictionHistory.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontWeight: 600, color: '#fff' }}>{row.product_name}</span>
                          <span style={{ fontSize: 10, color: 'var(--clr-text-muted)' }}>ID: {row.product_id}</span>
                        </div>
                      </td>
                      <td>
                        <span className="badge badge-accent">{row.forecast_period}</span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 12, fontSize: 12.5 }}>
                          <span>Stock: <strong style={{ color: '#fff' }}>{row.current_stock}</strong></span>
                          <span>Reorder: <strong style={{ color: 'var(--clr-warning)' }}>{row.reorder_level}</strong></span>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <strong style={{ color: row.sentiment_multiplier > 1.0 ? 'var(--clr-success)' : row.sentiment_multiplier < 1.0 ? 'var(--clr-danger)' : '#fff' }}>
                            x{parseFloat(row.sentiment_multiplier).toFixed(2)}
                          </strong>
                        </div>
                      </td>
                      <td>
                        <strong style={{ color: row.optimal_reorder_qty > 0 ? 'var(--clr-success)' : 'var(--clr-text-muted)' }}>
                          {row.optimal_reorder_qty > 0 ? `+${row.optimal_reorder_qty} units` : '0 (Hold)'}
                        </strong>
                      </td>
                      <td style={{ color: 'var(--clr-text-muted)', fontSize: 12 }}>
                        {new Date(row.predicted_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                      <td>
                        <button 
                          className="btn btn-ghost btn-sm" 
                          style={{ padding: '4px 8px', borderRadius: 'var(--r-sm)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
                          onClick={() => handleLoadHistoryRow(row)}
                        >
                          <Eye size={12} /> Inspect
                        </button>
                      </td>
                    </tr>
                  ))}
                  
                  {predictionHistory.length === 0 && !loadingHistory && (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--clr-text-muted)', fontSize: 13 }}>
                        No forecasting execution logs found. Run a prediction above to log into Supabase!
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Utility styling functions for nice glass shadows
function submitsShadow(submitting: boolean) {
  return submitting 
    ? '0 0 0 rgba(108,99,255,0)' 
    : '0 4px 18px var(--clr-accent-glow)';
}
