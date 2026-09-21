import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useLocale } from '../lib/locale'
import { skuFor } from '../lib/restock'
import {
  backendFetch, wakeBackend, describeBackendError, ModelStatus, MarketInsight,
} from '../lib/backend'
import {
  AreaChart, Area, LineChart, Line,
  ScatterChart, Scatter,
  XAxis, YAxis, ZAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, Cell, ReferenceLine
} from 'recharts'
import {
  TrendingUp, Target, Zap, AlertCircle, BarChart2,
  Layers, Activity, Sparkles, RefreshCw, Trash2,
  CheckCircle, Eye, X, ChevronDown, ChevronUp
} from 'lucide-react'

// Reorder policy for the stock recommendations, as a classic (s, S) rule.
// These two must stay apart: raise an alert below the reorder point, but order
// up to a strictly higher level. If an order only refills to the trigger, the
// item drops straight back under it and the alert repeats forever.
const REORDER_POINT_DAYS = 30   // s — below this many days of cover, act
const ORDER_UP_TO_DAYS   = 45   // S — order enough to reach this much cover


export default function SalesForecast() {
  const { symbol, fmtDateTime } = useLocale()
  const navigate = useNavigate()

  // Tab control
  const [activeTab, setActiveTab] = useState<'dashboard' | 'pipeline'>('dashboard')

  // Actual monthly sales + real AI revenue forecast
  const [predictionData, setPredictionData] = useState<any[]>([])
  const [revenueForecast, setRevenueForecast] = useState<{
    xgboost_monthly: number[]
    ppo_llm_monthly: number[]
    sentiment_multiplier: number
    oil_price: number
    seasonal_factors: number[]
  } | null>(null)

  // New interactive prediction pipeline state
  const [products, setProducts] = useState<any[]>([])
  const [selectedProductId, setSelectedProductId] = useState<string>('')
  const [selectedProduct, setSelectedProduct] = useState<any>(null)
  
  // Seeded from Settings → AI → Default Forecast Horizon, then freely
  // overridable per run from the selector on this page.
  const [forecastPeriod, setForecastPeriod] = useState<string>('30d')
  const [aiEnabled, setAiEnabled] = useState(true)
  const [aiConfidence, setAiConfidence] = useState(85)
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
  const [inspectedRow, setInspectedRow] = useState<any>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deletingAll, setDeletingAll] = useState<boolean>(false)

  // Batch run state
  const [batchRunning, setBatchRunning] = useState<boolean>(false)
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number; current: string; errors: number }>({
    done: 0, total: 0, current: '', errors: 0
  })

  // Notification states
  const [successToast, setSuccessToast] = useState<string>('')
  const [errorToast, setErrorToast] = useState<string>('')

  // Dashboard intelligence state (real data from demand_forecasts)
  const [productForecasts, setProductForecasts] = useState<any[]>([])
  const [historyForecasts, setHistoryForecasts] = useState<any[]>([])
  const [stockActions, setStockActions] = useState<any[]>([])
  const [dashLoading, setDashLoading] = useState<boolean>(true)
  const [dashStats, setDashStats] = useState({
    forecastedRevenue: 0, totalForecasts: 0, avgSentiment: 1.0, productsNeedingRestock: 0
  })
  const [statusTableOpen, setStatusTableOpen] = useState<boolean>(false)
  const [statCardModal, setStatCardModal] = useState<'revenue' | 'accuracy' | 'sentiment' | 'executions' | 'xgboost' | 'llm' | 'ppo' | null>(null)
  const [selectedAction, setSelectedAction] = useState<any | null>(null)
  const [approving, setApproving] = useState(false)
  const [approveMsg, setApproveMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [fixingAll, setFixingAll] = useState(false)
  const [fixAllResult, setFixAllResult] = useState<{ done: number; skipped: number; errors: string[] } | null>(null)
  const [historyOpen, setHistoryOpen] = useState<boolean>(false)

  // Measured model quality — never asserted, always from a holdout backtest.
  const [modelStatus, setModelStatus] = useState<any | null>(null)
  const [accuracy, setAccuracy] = useState<{
    holdoutLabel: string
    calibrationLabel: string
    totalAccuracyPct: number      // 100 - |calibrated total - actual total| / actual
    medianFamilyAccuracyPct: number
    rawMape: number               // uncalibrated, per family
    scaleFactor: number           // fitted on the calibration month only
    actualTotal: number
    calibratedTotal: number
    rawPredictedTotal: number
    perFamily: { family: string; actual: number; calibrated: number; apePct: number }[]
  } | null>(null)
  const [accuracyState, setAccuracyState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [accuracyError, setAccuracyError] = useState('')
  // Why the model-status probe failed, so the card can say more than "unreachable".
  const [modelStatusErr, setModelStatusErr] = useState('')
  // The CURRENT market reading, decomposed. Distinct from dashStats.avgSentiment,
  // which is the mean over stored past runs and cannot describe today.
  const [market, setMarket] = useState<MarketInsight | null>(null)
  const [marketErr, setMarketErr] = useState('')
  // True while a sleeping Space is being woken — a materially different state
  // from "working", and the one the user was actually stuck in.
  const [backendWaking, setBackendWaking] = useState(false)

  // ----------------------------------------------------
  // INITIALIZATION & DATA FETCHING
  // ----------------------------------------------------
  useEffect(() => {
    fetchSalesData()
    fetchProductsAndInventory()
    fetchPredictionHistory()
    fetchDashboardIntelligence()
    fetchModelStatus()
    fetchModelAccuracy()
    fetchMarketInsight()
    fetchAiSettings()
  }, [])

  // The AI panel in Settings drives real behaviour here: whether predictions
  // run at all, the default horizon sent to the model, and the confidence
  // floor for turning a forecast into a restock suggestion.
  //
  // Compared against the measured out-of-sample accuracy, not a self-reported
  // score: a model's own confidence says nothing about whether it is right.
  const belowConfidence =
    accuracy != null && accuracy.totalAccuracyPct < aiConfidence

  async function fetchAiSettings() {
    const { data } = await supabase
      .from('app_settings')
      .select('setting_key, setting_value')
      .in('setting_key', ['ai_enabled', 'ai_forecast_period', 'ai_confidence'])
    const get = (k: string) => (data || []).find((r: any) => r.setting_key === k)?.setting_value
    setAiEnabled(get('ai_enabled') !== 'false')
    setAiConfidence(parseInt(get('ai_confidence') ?? '85') || 85)
    const period = get('ai_forecast_period')
    if (period && ['7d', '30d', '90d', '365d'].includes(period)) setForecastPeriod(period)
  }

  // ── Keep the chart current ──────────────────────────────────────
  // A new sale changes the actual line, and the forecast window is anchored to
  // today, so a tab left open overnight would keep drawing yesterday's chart.
  // Refresh on: a sales_transactions change, tab refocus, and the date rolling
  // over. Events arrive in bursts during a batch, so refetches are debounced.
  const salesRefetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const refresh = () => {
      if (salesRefetchTimer.current) clearTimeout(salesRefetchTimer.current)
      salesRefetchTimer.current = setTimeout(() => {
        fetchSalesData()
        fetchDashboardIntelligence()
      }, 700)
    }

    const channel = supabase
      .channel('forecast-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_transactions' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, refresh)
      .subscribe()

    let lastDay = new Date().toDateString()
    const tick = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      const nowDay = new Date().toDateString()
      // Past midnight the forecast window itself moves, so rebuild everything.
      if (nowDay !== lastDay) { lastDay = nowDay; fetchSalesData(); fetchModelAccuracy() }
      else refresh()
    }, 120_000)

    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      if (salesRefetchTimer.current) clearTimeout(salesRefetchTimer.current)
      clearInterval(tick)
      document.removeEventListener('visibilitychange', onVisible)
      supabase.removeChannel(channel)
    }
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

  // Reports which model binaries actually loaded on the backend. Both loaders
  // fall back to a statistical policy on failure, so without this the UI would
  // keep claiming XGBoost/PPO for numbers those models never produced.
  //
  // Retries through a cold start: the Space sleeps, and a single failed probe
  // used to leave the card reading "backend unreachable" for the rest of the
  // session even once the server had come up.
  /**
   * Today's market conditions, straight from the source feeds.
   *
   * The dashboard used to headline the mean `sentiment_multiplier` across
   * stored forecasts. 66 of 76 rows came from one batch run, so that figure
   * was really "what the market looked like the day you pressed Run All",
   * frozen. This asks what it looks like now.
   */
  async function fetchMarketInsight() {
    setMarketErr('')
    try {
      // Same family/product basis the revenue-forecast endpoint scores its news
      // on, so the headline multiplier and the adjustment applied to the chart
      // are the same number. News is family-specific, so asking on a different
      // family would put two different "market sentiment" figures on one page.
      setMarket(await backendFetch<MarketInsight>('/api/market-insight?family=GROCERY%20I&product=retail', {
        timeoutMs: 45_000, retries: 2, onRetry: () => setBackendWaking(true),
      }))
    } catch (err) {
      setMarket(null)
      setMarketErr(describeBackendError(err))
    } finally {
      setBackendWaking(false)
    }
  }

  async function fetchModelStatus() {
    setModelStatusErr('')
    try {
      const status = await backendFetch<ModelStatus>('/api/model-status', {
        timeoutMs: 20_000,
        retries: 3,
        onRetry: () => setBackendWaking(true),
      })
      setModelStatus(status)
      setModelStatusErr('')
    } catch (err) {
      setModelStatus(null)
      setModelStatusErr(describeBackendError(err))
    } finally {
      setBackendWaking(false)
    }
  }

  /**
   * Months whose sales data covers every day of the month.
   *
   * A partial month looks like a collapse in revenue rather than missing data,
   * which is exactly what the chart was drawing for June (20 of 30 days) and
   * what both forecast lines were anchoring to.
   */
  async function completeSalesMonths(): Promise<
    { label: string; first: string; last: string; days: number; revenue: number; units: number }[]
  > {
    const { data, error } = await supabase.rpc('get_monthly_sales_coverage', { months_back: 24 })
    if (error || !data) return []
    return (data as any[])
      .filter(r => r.is_complete)
      .map(r => ({
        label: r.month_key,
        first: r.month_start,
        last: r.month_end,
        days: Number(r.days_in_month),
        revenue: Number(r.revenue) || 0,
        units: Number(r.units) || 0,
      }))
  }

  /**
   * Per-family units actually sold in [from, to].
   *
   * Aggregated in Postgres rather than by paging ~8k transaction rows per
   * month through PostgREST, which took a dozen round trips per month.
   */
  async function familyActuals(from: string, to: string): Promise<Map<string, number>> {
    const out = new Map<string, number>()
    const { data, error } = await supabase.rpc('get_family_units', { from_date: from, to_date: to })
    if (error || !data) return out
    for (const row of data as any[]) out.set(row.family, Number(row.units) || 0)
    return out
  }

  /**
   * Real out-of-sample accuracy.
   *
   * The model was trained on a 54-store Ecuadorian dataset, so its raw unit
   * counts are on a different scale entirely from this catalogue. A single
   * scale factor is therefore fitted on one complete month and applied,
   * untouched, to a later month the factor never saw. The holdout month's
   * sales are never used to derive anything the prediction depends on.
   */
  async function fetchModelAccuracy() {
    setAccuracyState('loading'); setAccuracyError('')
    try {
      // Absorb a cold start on the cheap health route first. Two heavy
      // backtest POSTs racing a booting Space is what used to hang here.
      const awake = await wakeBackend({ onRetry: () => setBackendWaking(true) })
      setBackendWaking(false)
      if (!awake) {
        setAccuracyError('Model server is not responding. It may be asleep or redeploying.')
        setAccuracyState('error'); return
      }

      const months = await completeSalesMonths()
      if (months.length < 2) {
        setAccuracyError('Needs two complete months of sales history to measure accuracy.')
        setAccuracyState('error'); return
      }
      const calib = months[months.length - 2]
      const hold = months[months.length - 1]

      const [calibActual, holdActual] = await Promise.all([
        familyActuals(calib.first, calib.last),
        familyActuals(hold.first, hold.last),
      ])
      const families = Array.from(new Set([...calibActual.keys(), ...holdActual.keys()]))
      if (families.length === 0) {
        setAccuracyError('No family-level sales found for the holdout window.')
        setAccuracyState('error'); return
      }

      // Measured: 33 families x 31 days is ~23s per month on the free
      // cpu-basic Space. The deadline is generous, but it IS a deadline.
      const runBacktest = async (start: string, days: number) => {
        const json = await backendFetch<{ per_family: { family: string; predicted_total: number }[] }>(
          '/api/predict/backtest',
          { method: 'POST', body: { start_date: start, days, families }, timeoutMs: 90_000, retries: 1 },
        )
        const m = new Map<string, number>()
        for (const f of json.per_family) m.set(f.family, Number(f.predicted_total) || 0)
        return m
      }

      // Sequential, not Promise.all. The backend has ~2 shared vCPUs, so firing
      // both months at once makes them contend and each takes roughly as long
      // as the pair would sequentially — while burning both deadlines at once.
      const calibPred = await runBacktest(calib.first, calib.days)
      const holdPred = await runBacktest(hold.first, hold.days)

      const sum = (m: Map<string, number>) => Array.from(m.values()).reduce((a, b) => a + b, 0)
      const calibPredTotal = sum(calibPred)
      const scaleFactor = calibPredTotal > 0 ? sum(calibActual) / calibPredTotal : 1

      const perFamily = families
        .map(family => {
          const actual = holdActual.get(family) || 0
          const calibrated = (holdPred.get(family) || 0) * scaleFactor
          return {
            family, actual, calibrated,
            apePct: actual > 0 ? (Math.abs(calibrated - actual) / actual) * 100 : NaN,
          }
        })
        .filter(r => Number.isFinite(r.apePct))
        .sort((a, b) => a.apePct - b.apePct)

      const actualTotal = sum(holdActual)
      const rawPredictedTotal = sum(holdPred)
      const calibratedTotal = rawPredictedTotal * scaleFactor
      const totalErrPct = actualTotal > 0 ? (Math.abs(calibratedTotal - actualTotal) / actualTotal) * 100 : 100
      const apes = perFamily.map(r => r.apePct)
      const medianApe = apes.length ? apes[Math.floor(apes.length / 2)] : 100
      const rawMape = families.length
        ? families.reduce((acc, f) => {
            const a = holdActual.get(f) || 0
            return a > 0 ? acc + (Math.abs((holdPred.get(f) || 0) - a) / a) * 100 : acc
          }, 0) / perFamily.length
        : 0

      setAccuracy({
        holdoutLabel: hold.label, calibrationLabel: calib.label,
        totalAccuracyPct: Math.max(0, 100 - totalErrPct),
        medianFamilyAccuracyPct: Math.max(0, 100 - medianApe),
        rawMape, scaleFactor, actualTotal, calibratedTotal, rawPredictedTotal, perFamily,
      })
      setAccuracyState('idle')
    } catch (err: any) {
      setAccuracyError(describeBackendError(err))
      setAccuracyState('error')
    } finally {
      setBackendWaking(false)
    }
  }

  // Fetch actual monthly sales + real AI revenue forecast
  async function fetchSalesData() {
    try {
      // Only months with data for every day. A month missing days is not a
      // downturn, and charting one as if it were complete drags the whole
      // forecast baseline down with it.
      const months = await completeSalesMonths()
      if (!months.length) return
      const last6 = months.slice(-6)

      const chartData = last6.map(m => ({
        month: m.label.split(' ')[0],
        monthStart: m.first,
        actual: m.revenue,
      }))
      setPredictionData(chartData)

      // Call real AI revenue forecast endpoint
      const lastActual = chartData.length > 0 ? chartData[chartData.length - 1].actual : 0
      if (lastActual > 0) {
        try {
          const data = await backendFetch<any>('/api/predict/revenue-forecast', {
            method: 'POST',
            timeoutMs: 45_000,
            retries: 2,
            body: {
              last_actual_revenue: lastActual,
              product_families: ['GROCERY I', 'BEVERAGES', 'DAIRY', 'PRODUCE', 'FROZEN FOODS'],
            },
          })
          setRevenueForecast(data)
        } catch {
          // Backend not reachable — forecast lines will use sentiment-only fallback
        }
      }
    } catch (err) {
      console.error('Error fetching sales data:', err)
    }
  }

  // Fetch real AI intelligence data from demand_forecasts + products + inventory
  async function fetchDashboardIntelligence() {
    setDashLoading(true)
    try {
      const { data: allForecasts, error: fError } = await supabase
        .from('demand_forecasts')
        .select('*')
        .order('predicted_at', { ascending: false })
        .limit(100)

      if (fError || !allForecasts || allForecasts.length === 0) {
        console.warn('demand_forecasts empty or unavailable:', fError?.message)
        return
      }

      const { data: productData } = await supabase
        .from('products').select('id, name, family, unit_price')
      const { data: inventoryData } = await supabase
        .from('inventory').select('id, product_id, current_stock, reorder_level')
      // Observed sales velocity per product. The model predicts at product-family
      // scale (one number for a whole family, on the training set's scale), so
      // its per-product figure can be many times the real rate. Recorded sales
      // are the ground truth for how fast a specific product actually moves.
      const { data: demandData } = await supabase.rpc('get_product_daily_demand', { days_back: 90 })
      const demandMap = new Map<string, number>(
        (demandData || []).map((d: any) => [String(d.product_id), Number(d.daily_rate) || 0] as [string, number])
      )

      const productMap = new Map((productData || []).map((p: any) => [String(p.id), p]))
      const invMap = new Map((inventoryData || []).map((i: any) => [String(i.product_id), i]))

      // Latest forecast per product
      const latestByProduct = new Map<string, any>()
      for (const f of allForecasts) {
        if (!latestByProduct.has(f.product_id)) latestByProduct.set(f.product_id, f)
      }
      // Only keep forecasts that still map to a product in the catalogue.
      // Orphaned rows (deleted products, ad-hoc API calls) would otherwise
      // inflate coverage above 100% and misreport the fleet.
      const latestForecasts = Array.from(latestByProduct.values())
        .filter((f: any) => productMap.has(String(f.product_id)))

      const enriched = latestForecasts.map((f: any) => {
        const prod = productMap.get(String(f.product_id)) || {} as any
        const inv = invMap.get(String(f.product_id)) || {} as any
        const periodDays = f.forecast_period === '7d' ? 7 : f.forecast_period === '90d' ? 90 : f.forecast_period === '365d' ? 365 : 30
        const forecastArr: number[] = Array.isArray(f.forecasted_demand) ? f.forecasted_demand : []
        const totalDemand = forecastArr.reduce((a: number, b: number) => a + b, 0)
        const modelDaily = periodDays > 0 ? totalDemand / periodDays : 0
        const observedDaily = demandMap.get(String(f.product_id)) ?? 0
        // Prefer what the product actually sells. The model only falls back in
        // when a product has no recorded sales at all, and never sets the order
        // size on its own, so a family-scale forecast cannot inflate a purchase
        // order by an order of magnitude.
        const dailyDemand = observedDaily > 0 ? observedDaily : modelDaily
        const currentStockLive = inv.current_stock ?? f.current_stock ?? 0
        const reorderLevelLive = inv.reorder_level ?? f.reorder_level ?? 0
        const daysOfStock = dailyDemand > 0 ? currentStockLive / dailyDemand : 999
        const unitPrice = prod.unit_price ?? 0
        const urgency = currentStockLive === 0 ? 'CRITICAL'
          : daysOfStock < REORDER_POINT_DAYS / 2 ? 'CRITICAL'
          : daysOfStock < REORDER_POINT_DAYS ? 'HIGH'
          : daysOfStock < 60 ? 'MEDIUM' : 'LOW'

        // Quantity that actually clears the alert. The stored PPO figure is
        // what the model returned against whatever the stock level was at the
        // time of its pipeline run, and it is never recomputed -- ordering it
        // left every item still under the reorder point, so the same alert
        // reappeared on the next refresh. Order up to ORDER_UP_TO_DAYS of
        // cover instead, so the condition that raised the alert is resolved.
        const orderUpToQty = dailyDemand > 0
          ? Math.max(0, Math.ceil(ORDER_UP_TO_DAYS * dailyDemand - currentStockLive))
          : Math.max(0, (reorderLevelLive || 0) * 2 - currentStockLive)
        const needsAction = urgency === 'CRITICAL' || urgency === 'HIGH'

        return {
          ...f,
          unit_price: unitPrice,
          family: prod.family || '',
          inventory_id: inv.id,
          total_forecasted_demand: Math.round(totalDemand),
          daily_demand: Math.round(dailyDemand * 10) / 10,
          model_daily_demand: Math.round(modelDaily * 10) / 10,
          observed_daily_demand: Math.round(observedDaily * 10) / 10,
          demand_basis: observedDaily > 0 ? 'recorded sales' : 'model forecast',
          days_of_stock: Math.round(daysOfStock),
          forecasted_revenue: Math.round(totalDemand * unitPrice),
          current_stock_live: currentStockLive,
          reorder_level_live: reorderLevelLive,
          ppo_reorder_qty: f.optimal_reorder_qty || 0,
          recommended_qty: needsAction ? orderUpToQty : 0,
          days_after_restock: dailyDemand > 0
            ? Math.round((currentStockLive + orderUpToQty) / dailyDemand)
            : 999,
          urgency,
        }
      })

      setProductForecasts(enriched)
      setHistoryForecasts(allForecasts)

      // Top-level stats
      const totalRevenue = enriched.reduce((s: number, f: any) => s + f.forecasted_revenue, 0)
      const avgSent = enriched.length
        ? enriched.reduce((s: number, f: any) => s + parseFloat(f.sentiment_multiplier || 1), 0) / enriched.length
        : 1.0
      setDashStats({
        forecastedRevenue: totalRevenue,
        totalForecasts: allForecasts.length,
        avgSentiment: Math.round(avgSent * 1000) / 1000,
        // Live shortfall, not the stored pipeline figure — otherwise this count
        // never moves no matter how much stock is added.
        productsNeedingRestock: enriched.filter((f: any) => f.recommended_qty > 0).length,
      })


      // Stock action recommendations.
      //
      // Driven purely by live stock against live demand. The previous filter
      // also admitted anything whose stored optimal_reorder_qty was > 0 --
      // a value written once by the pipeline and never updated by restocking,
      // so 58 of 67 products qualified permanently no matter how much stock
      // they had. Restocking could not clear that, which is why the list
      // always came back.
      const urgencyOrder: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }
      const actions = enriched
        .filter((f: any) => f.recommended_qty > 0)
        .sort((a: any, b: any) =>
          (urgencyOrder[a.urgency] ?? 3) - (urgencyOrder[b.urgency] ?? 3) ||
          a.days_of_stock - b.days_of_stock)
      setStockActions(actions)

    } catch (err) {
      console.error('Dashboard intelligence error:', err)
    } finally {
      setDashLoading(false)
    }
  }

  // Helper: select product and autofill parameters
  async function selectProductById(id: string, customList?: any[]) {
    const list = customList || products
    const prod = list.find((p: any) => String(p.id) === String(id))
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
          
        // Only ever show real recorded sales. If this product has no transaction
        // history yet, leave the field empty rather than inventing numbers —
        // the pipeline must never be fed fabricated input.
        if (salesData && salesData.length > 0) {
          const salesArr = salesData.map((s: any) => s.quantity_sold).reverse()
          setHistoricalSalesInput(salesArr.join(', '))
        } else {
          setHistoricalSalesInput('')
        }
      } catch (e) {
        console.error(e)
        setHistoricalSalesInput('')
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
    // Settings > AI > Enable AI Predictions. The toggle previously wrote a
    // value nothing read, so turning it off changed nothing.
    if (!aiEnabled) {
      setErrorToast('AI predictions are turned off in Settings → AI Settings.')
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
      // The pipeline also calls an LLM for sentiment, so it is the slowest
      // route on the server — a long deadline, but still a deadline.
      const data = await backendFetch<any>('/api/predict/pipeline', {
        method: 'POST',
        timeoutMs: 120_000,
        retries: 1,
        onRetry: () => setBackendWaking(true),
        body: {
          product_id: String(selectedProductId),
          product_name: String(selectedProduct?.name || 'Unknown'),
          product_family: String(selectedProduct?.family || 'GROCERY I'),
          forecast_period: String(forecastPeriod),
          current_stock: Number(currentStock),
          reorder_level: Number(reorderLevel),
          market_text: marketText || '',
          historical_sales: salesArr,
        },
      })
      setPipelineResult(data)
      // Show auto-fetched news in the textarea so user can see what was used
      if (data.market_context_used && !marketText.trim()) {
        setMarketText(data.market_context_used)
      }
      setSuccessToast(`Successfully ran prediction pipeline for ${selectedProduct?.name}!`)

      setTimeout(() => { fetchPredictionHistory(); fetchDashboardIntelligence() }, 1500)

    } catch (err: any) {
      console.error('Pipeline error:', err)
      setErrorToast(`Pipeline failed: ${describeBackendError(err)}`)
    } finally {
      setSubmitting(false)
      setBackendWaking(false)
    }
  }

  // Render a specific historical entry from log table
  const RLS_SQL_FIX = `ALTER TABLE public.demand_forecasts DISABLE ROW LEVEL SECURITY;`

  async function handleDeleteRow(id: string) {
    setDeletingId(id)
    try {
      const { error } = await supabase.from('demand_forecasts').delete().eq('id', id)
      if (error) { setErrorToast(`Delete failed: ${error.message}`); return }

      // Verify the row is actually gone
      const { data: check } = await supabase.from('demand_forecasts').select('id').eq('id', id)
      if (check && check.length > 0) {
        setErrorToast('Supabase blocked the delete (RLS). Run the SQL shown below the table.')
        return
      }

      setPredictionHistory(prev => prev.filter((r: any) => r.id !== id))
      if (inspectedRow?.id === id) setInspectedRow(null)
      fetchDashboardIntelligence()
      setSuccessToast('Entry deleted.')
    } catch {
      setErrorToast('Delete failed.')
    } finally {
      setDeletingId(null)
    }
  }

  async function handleDeleteAll() {
    if (!window.confirm('Delete ALL prediction history? This cannot be undone.')) return
    const ids = predictionHistory.map((r: any) => r.id).filter(Boolean)
    if (ids.length === 0) return
    setDeletingAll(true)
    try {
      const { error } = await supabase.from('demand_forecasts').delete().in('id', ids)
      if (error) { setErrorToast(`Clear failed: ${error.message}`); setDeletingAll(false); return }

      // Verify records are actually gone
      const { data: remaining } = await supabase
        .from('demand_forecasts').select('id').in('id', ids)

      if (remaining && remaining.length > 0) {
        setErrorToast('Supabase RLS blocked the delete. Run the SQL shown below the table.')
        setDeletingAll(false)
        return
      }

      setPredictionHistory([])
      setInspectedRow(null)
      fetchDashboardIntelligence()
      setSuccessToast(`Cleared ${ids.length} prediction log${ids.length !== 1 ? 's' : ''}.`)
    } catch {
      setErrorToast('Clear all failed.')
    } finally {
      setDeletingAll(false)
    }
  }

  async function handleRunAllProducts() {
    if (products.length === 0) { setErrorToast('No products loaded yet.'); return }

    setBatchRunning(true)
    setBatchProgress({ done: 0, total: products.length, current: '', errors: 0 })

    // One wake before the loop. Without it a sleeping backend turned every
    // product in the batch into its own stalled request.
    setBackendWaking(true)
    const awake = await wakeBackend()
    setBackendWaking(false)
    if (!awake) {
      setBatchRunning(false)
      setErrorToast('Model server is not responding — batch run cancelled.')
      return
    }

    let successCount = 0
    let errorCount = 0
    let skippedCount = 0

    for (let i = 0; i < products.length; i++) {
      const prod = products[i]
      setBatchProgress(prev => ({ ...prev, done: i, current: prod.name }))

      // Real recorded sales only. A product with no transaction history is
      // skipped — running the pipeline on invented input would produce a
      // forecast that looks authoritative but describes nothing.
      let salesArr: number[] = []
      try {
        const { data: salesData } = await supabase
          .from('sales_transactions').select('quantity_sold')
          .eq('product_id', prod.id).order('sale_date', { ascending: false }).limit(12)
        if (salesData && salesData.length > 0)
          salesArr = salesData.map((s: any) => s.quantity_sold).reverse()
      } catch {}

      if (salesArr.length === 0) {
        skippedCount++
        continue
      }

      try {
        await backendFetch('/api/predict/pipeline', {
          method: 'POST',
          timeoutMs: 120_000,
          retries: 0,   // the batch is already long; a stuck product is skipped, not retried
          body: {
            product_id: String(prod.id),
            product_name: String(prod.name),
            product_family: String(prod.family || 'GROCERY I'),
            forecast_period: forecastPeriod,
            current_stock: Number(prod.current_stock),
            reorder_level: Number(prod.reorder_level),
            market_text: '',
            historical_sales: salesArr,
          },
        })
        successCount++
      } catch { errorCount++ }
    }

    setBatchProgress(prev => ({ ...prev, done: products.length, current: '', errors: errorCount }))
    setBatchRunning(false)
    setSuccessToast(
      [
        `${successCount} run on real sales history`,
        errorCount > 0 ? `${errorCount} failed` : '',
        skippedCount > 0 ? `${skippedCount} skipped (no recorded sales)` : '',
      ].filter(Boolean).join(' · ')
    )
    setTimeout(() => { fetchPredictionHistory(); fetchDashboardIntelligence() }, 1200)
  }

  function handleLoadHistoryRow(entry: any) {
    setSelectedProductId(entry.product_id)
    setSelectedProduct(products.find(p => String(p.id) === String(entry.product_id)) || { name: entry.product_name })
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

  // ── Chart data derivations ──────────────────────────────────────

  // Bubble chart — one bubble per product (latest run)
  const bubbleChartData = productForecasts.map((f: any) => ({
    x: f.current_stock_live,
    y: f.total_forecasted_demand,
    z: Math.max(1, f.optimal_reorder_qty || 0),
    name: f.product_name,
    urgency: f.urgency,
    fill: f.urgency === 'CRITICAL' ? '#f43f5e' : f.urgency === 'HIGH' ? '#f59e0b' : f.urgency === 'MEDIUM' ? '#00D4FF' : '#22d3a8',
  }))

  // Sentiment vs Reorder — ALL pipeline runs + ALL products (grey if never run)
  const SCATTER_COLORS = ['#22d3a8','#6C63FF','#f59e0b','#f43f5e','#00D4FF','#a78bfa','#FF6B9D','#34d399','#fb923c','#38bdf8']
  const sentimentReorderData = (() => {
    const colorMap: Record<string, string> = {}
    let idx = 0
    // All historical pipeline runs
    const withData = historyForecasts.map((f: any) => {
      const name = f.product_name || 'Unknown'
      if (!colorMap[name]) colorMap[name] = SCATTER_COLORS[idx++ % SCATTER_COLORS.length]
      return { sentiment: parseFloat(f.sentiment_multiplier) || 1.0, reorder: f.optimal_reorder_qty || 0, name, fill: colorMap[name], hasData: true }
    })
    // Products that exist but have never been run through the pipeline
    const runNames = new Set(historyForecasts.map((f: any) => f.product_name))
    const withoutData = products
      .filter((p: any) => !runNames.has(p.name))
      .map((p: any) => ({ sentiment: 1.0, reorder: 0, name: p.name, fill: 'rgba(255,255,255,0.25)', hasData: false }))
    return [...withData, ...withoutData]
  })()

  // Scatter legend: pipeline-run products (coloured) + indicator for unrun products
  const scatterLegend = [
    ...Object.entries(
      sentimentReorderData.filter((d: any) => d.hasData).reduce((acc: Record<string, string>, d: any) => {
        if (!acc[d.name]) acc[d.name] = d.fill
        return acc
      }, {})
    ),
    ...(sentimentReorderData.some((d: any) => !d.hasData)
      ? [['No pipeline run yet', 'rgba(255,255,255,0.25)'] as [string, string]]
      : []
    ),
  ]

  // Line chart — actual sales (historical) + XGBoost base + PPO+LLM adjusted
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const currentMonthName = MONTHS[new Date().getMonth()]

  // Sentiment: prefer real forecast API result, fall back to avg from pipeline runs
  const activeSentiment = revenueForecast?.sentiment_multiplier
    ?? (productForecasts.length > 0
      ? productForecasts.reduce((s: number, f: any) => s + (parseFloat(f.sentiment_multiplier) || 1.0), 0) / productForecasts.length
      : 1.0)

  const lastActualRevenue = predictionData.length > 0
    ? predictionData[predictionData.length - 1].actual
    : 0

  // The forecast window starts TODAY, not after the last month that happens to
  // have sales in it. The backend runs the model over the 90 days from now, so
  // labelling those three points as lastActualMonth+1..+3 named months the
  // model never predicted — with data ending in June, a September forecast was
  // being drawn as June, July, August.
  const today = new Date()
  const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  const forecastDates = [0, 1, 2].map(i => new Date(today.getFullYear(), today.getMonth() + i, 1))

  const forecastByMonth = new Map<string, { xgboost: number; adjusted: number }>()
  forecastDates.forEach((d, i) => {
    const xgboost = revenueForecast
      ? revenueForecast.xgboost_monthly[i] ?? 0
      : Math.round(lastActualRevenue * Math.pow(activeSentiment > 0 ? 1.015 : 1.0, i + 1))
    const adjusted = revenueForecast
      ? revenueForecast.ppo_llm_monthly[i] ?? 0
      : Math.round(xgboost * activeSentiment)
    forecastByMonth.set(monthKey(d), { xgboost, adjusted })
  })

  const actualByMonth = new Map<string, number>(
    predictionData
      .filter((d: any) => d.monthStart)
      .map((d: any) => [d.monthStart.slice(0, 7), d.actual] as [string, number])
  )

  // Walk a continuous timeline from the first actual month to the last forecast
  // month. Months with neither actuals nor a forecast stay null and render as a
  // visible break — that gap is real (no sales were recorded) and hiding it by
  // butting the two series together would imply continuity that does not exist.
  const firstActual = predictionData.length > 0 && predictionData[0].monthStart
    ? new Date(predictionData[0].monthStart + 'T00:00:00')
    : forecastDates[0]
  const lastForecast = forecastDates[forecastDates.length - 1]
  const monthsBetween =
    (lastForecast.getFullYear() - firstActual.getFullYear()) * 12 +
    (lastForecast.getMonth() - firstActual.getMonth())

  // Guard against a very stale dataset producing a chart that is mostly empty.
  const spanCapped = monthsBetween > 14
  const timelineStart = spanCapped
    ? new Date(lastForecast.getFullYear(), lastForecast.getMonth() - 14, 1)
    : firstActual
  const steps = spanCapped ? 14 : monthsBetween

  // When the actuals run right up to the forecast window, carry the last actual
  // value onto both forecast lines so they start where the history ends instead
  // of floating detached. Only when they are genuinely adjacent — bridging a
  // real gap would draw months of continuity that never happened.
  const lastActualKey = predictionData.length > 0 && predictionData[predictionData.length - 1].monthStart
    ? predictionData[predictionData.length - 1].monthStart.slice(0, 7)
    : null
  const monthBeforeForecast = new Date(forecastDates[0].getFullYear(), forecastDates[0].getMonth() - 1, 1)
  const forecastJoinsActuals = lastActualKey === monthKey(monthBeforeForecast)

  const multiYear = timelineStart.getFullYear() !== lastForecast.getFullYear()
  const combinedChartData = Array.from({ length: steps + 1 }, (_, i) => {
    const d = new Date(timelineStart.getFullYear(), timelineStart.getMonth() + i, 1)
    const k = monthKey(d)
    const fc = forecastByMonth.get(k)
    const actual = actualByMonth.has(k) ? (actualByMonth.get(k) as number) : null
    const isJoin = forecastJoinsActuals && k === lastActualKey && actual !== null
    return {
      month: multiYear ? `${MONTHS[d.getMonth()]} '${String(d.getFullYear()).slice(2)}` : MONTHS[d.getMonth()],
      actual,
      xgboost: fc ? fc.xgboost : (isJoin ? actual : null),
      adjusted: fc ? fc.adjusted : (isJoin ? actual : null),
    }
  })

  const forecastRows = forecastDates.map((d, i) => ({
    month: MONTHS[d.getMonth()],
    ...(forecastByMonth.get(monthKey(d)) ?? { xgboost: 0, adjusted: 0 }),
    _i: i,
  }))

  // How far behind the data is, so the chart can say so rather than look broken.
  const lastActualDate = predictionData.length > 0 && predictionData[predictionData.length - 1].monthStart
    ? new Date(predictionData[predictionData.length - 1].monthStart + 'T00:00:00')
    : null
  const staleMonths = lastActualDate
    ? (today.getFullYear() - lastActualDate.getFullYear()) * 12 + (today.getMonth() - lastActualDate.getMonth()) - 1
    : 0

  // Headline revenue reads off the same forecast the chart draws.
  const forecastRevenue3m = forecastRows.reduce((s, r) => s + (r.adjusted || 0), 0)
  const forecastMonthsLabel = forecastRows.length
    ? `${forecastRows[0].month}–${forecastRows[forecastRows.length - 1].month}`
    : ''
  const fmtMoney = (v: number) =>
    v >= 1_000_000 ? `${symbol}${(v / 1_000_000).toFixed(1)}M`
    : v >= 1_000 ? `${symbol}${(v / 1_000).toFixed(1)}K`
    : `${symbol}${Math.round(v)}`

  // Y-axis range: zoom in to the data range (±15%) so differences are visible
  const allValues = combinedChartData.flatMap(d => [d.actual, d.xgboost, d.adjusted].filter((v): v is number => v !== null && v > 0))
  const yMin = allValues.length > 0 ? Math.floor(Math.min(...allValues) * 0.90) : 0
  const yMax = allValues.length > 0 ? Math.ceil(Math.max(...allValues) * 1.08) : 30_000_000

  return (
    <div className="page-enter">
      {/* Toast container — cleared below the top bar so it never lands on the
          notification bell. */}
      <div style={{ position: 'fixed', top: 'calc(var(--topbar-h) + 14px)', right: 20, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 10 }}>
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

      <div className="page-header page-header-row">
        <div>
          <h1>AI Forecasting & Decision Engine</h1>
          <p>Multi-agent forecasting pipeline merging XGBoost demand trends, LLM sentiment, and PPO Reinforcement Learning decisions.</p>
        </div>
        
        {/* Navigation Tabs */}
        <div style={{ display: 'flex', background: 'rgba(255,255,255,0.04)', padding: 4, borderRadius: 'var(--r-md)', border: '1px solid var(--clr-border)' }}>
          <button
            className={`btn ${activeTab === 'dashboard' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ borderRadius: 'calc(var(--r-md) - 2px)', padding: '8px 16px', fontSize: 13, transition: 'box-shadow 0.25s ease, transform 0.25s ease' }}
            onClick={() => setActiveTab('dashboard')}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 1px rgba(108,99,255,0.5), 0 0 16px rgba(108,99,255,0.55), 0 0 32px rgba(108,99,255,0.3)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '' }}
          >
            <BarChart2 size={16} /> AI Dashboard
          </button>
          <button
            className={`btn ${activeTab === 'pipeline' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ borderRadius: 'calc(var(--r-md) - 2px)', padding: '8px 16px', fontSize: 13, transition: 'box-shadow 0.25s ease, transform 0.25s ease' }}
            onClick={() => setActiveTab('pipeline')}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 1px rgba(108,99,255,0.5), 0 0 16px rgba(108,99,255,0.55), 0 0 32px rgba(108,99,255,0.3)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '' }}
          >
            <Sparkles size={16} /> Interactive Predictor
          </button>
        </div>
      </div>

      {/* ============================================================
          TAB 1: AI DASHBOARD — Real Data from Pipeline Runs
          ============================================================ */}
      {activeTab === 'dashboard' && (
        <>
          {/* ── STAT CARDS ── */}
          <div className="stat-grid">
            {(() => {
              // Headline the LIVE reading, not the mean of past runs.
              const liveMult = market?.multiplier ?? null
              const sentColor = liveMult == null ? '#00D4FF'
                : liveMult > 1.02 ? '#22d3a8' : liveMult < 0.98 ? '#f43f5e' : '#00D4FF'
              const leadMover = market?.components
                ?.slice()
                .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))[0]
              const cards = [
                {
                  // Same series the chart plots, so the headline figure and the
                  // graph can no longer disagree. The old value summed per-product
                  // model output, which sits on the training set's scale rather
                  // than this catalogue's and read ~4x below actual monthly sales.
                  id: 'revenue', color: '#6C63FF',
                  icon: <TrendingUp size={18} color="#6C63FF" />,
                  label: 'Forecast Revenue · Next 3 Months',
                  value: forecastRevenue3m > 0 ? fmtMoney(forecastRevenue3m) : '—',
                  sub: forecastMonthsLabel
                    ? `${forecastMonthsLabel} · PPO + LLM adjusted`
                    : 'Awaiting a complete month of sales',
                  valueColor: undefined as string | undefined,
                },
                {
                  id: 'accuracy', color: '#22d3a8',
                  icon: <Target size={18} color="#22d3a8" />,
                  label: 'XGBoost Accuracy',
                  value: accuracyState === 'loading' ? '...'
                    : accuracy ? `${accuracy.totalAccuracyPct.toFixed(1)}%` : '—',
                  sub: accuracy
                    ? `${accuracy.holdoutLabel} held out · calibrated on ${accuracy.calibrationLabel}`
                    // "Waking" and "working" looked identical before, which is
                    // why a 60s cold start read as a frozen card.
                    : accuracyState === 'loading'
                      ? (backendWaking ? 'Waking the model server…' : 'Running holdout backtest…')
                    : accuracyError || 'Backtest unavailable',
                  valueColor: accuracy
                    ? (accuracy.totalAccuracyPct >= 90 ? '#22d3a8' : accuracy.totalAccuracyPct >= 70 ? '#f59e0b' : '#f43f5e')
                    : undefined,
                },
                {
                  id: 'sentiment', color: sentColor,
                  icon: <Activity size={18} color={sentColor} />,
                  label: 'Market Sentiment · Live',
                  value: liveMult == null ? (marketErr ? '—' : '...') : `x${liveMult.toFixed(3)}`,
                  // Name the driver instead of restating the direction. "Market
                  // trending DOWN" told you nothing you couldn't read off the
                  // number; which input moved it is the actual insight.
                  sub: liveMult == null
                    ? (marketErr || 'Reading live market conditions…')
                    : leadMover && Math.abs(leadMover.contribution) >= 0.005
                      ? `${leadMover.contribution > 0 ? '▲' : '▼'} ${leadMover.label} ${leadMover.contribution > 0 ? '+' : ''}${(leadMover.contribution * 100).toFixed(1)}%`
                      : 'All inputs at baseline',
                  valueColor: sentColor,
                },
                {
                  id: 'executions', color: '#FF6B9D',
                  icon: <BarChart2 size={18} color="#FF6B9D" />,
                  label: 'Pipeline Executions',
                  value: dashLoading ? '...' : String(dashStats.totalForecasts),
                  sub: `${dashStats.productsNeedingRestock} product${dashStats.productsNeedingRestock !== 1 ? 's' : ''} flagged for restock`,
                  valueColor: undefined as string | undefined,
                },
              ]
              return cards.map(c => (
                <div
                  key={c.id}
                  className="stat-card"
                  onClick={() => setStatCardModal(c.id as any)}
                  style={{ '--card-glow': `${c.color}33`, cursor: 'pointer', transition: 'box-shadow 0.25s ease, transform 0.18s ease' } as any}
                  onMouseEnter={e => {
                    const el = e.currentTarget as HTMLElement
                    el.style.boxShadow = `0 0 0 1px ${c.color}99, 0 0 30px ${c.color}77, 0 0 60px ${c.color}44`
                    el.style.transform = 'translateY(-2px)'
                  }}
                  onMouseLeave={e => {
                    const el = e.currentTarget as HTMLElement
                    el.style.boxShadow = ''; el.style.transform = ''
                  }}
                >
                  <div className="stat-card-icon">{c.icon}</div>
                  <div className="stat-card-label">{c.label}</div>
                  <div className="stat-card-value" style={c.valueColor ? { color: c.valueColor } : {}}>{c.value}</div>
                  <div style={{ fontSize: 11, color: 'var(--clr-text-muted)', marginTop: 2 }}>{c.sub}</div>
                  <div style={{ fontSize: 10, color: `${c.color}99`, marginTop: 6, fontWeight: 500 }}>Click for details →</div>
                </div>
              ))
            })()}
          </div>

          {/* ── MAIN ROW: Line Chart + AI Models Panel ── */}
          <div className="grid-21 mb-4" style={{ marginBottom: 16 }}>
            <div className="glass-card">
              <div className="section-title">
                Actual Sales vs AI Forecast
                <span className="badge badge-accent" style={{ fontSize: 10 }}>
                  {revenueForecast ? 'XGBoost Seasonal · LLM Adjusted' : 'Sentiment Adjusted'}
                </span>
                {revenueForecast && (
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', fontWeight: 400, marginLeft: 4 }}>
                    · Oil ${revenueForecast.oil_price}/bbl · Sentiment x{revenueForecast.sentiment_multiplier.toFixed(3)}
                  </span>
                )}
              </div>
              {/* The forecast window is anchored to today. Say where the actuals
                  stop, so a gap in the line reads as missing data rather than a
                  crash in sales. */}
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: -4, marginBottom: 8 }}>
                Forecast {forecastRows.length > 0 ? `${forecastRows[0].month}–${forecastRows[forecastRows.length - 1].month} ${today.getFullYear()}` : ''} (next 90 days from today)
                {staleMonths > 0 && (
                  <span style={{ color: '#f59e0b' }}>
                    {' · '}sales data ends {lastActualDate ? `${MONTHS[lastActualDate.getMonth()]} ${lastActualDate.getFullYear()}` : ''}
                    , so {staleMonths} month{staleMonths !== 1 ? 's' : ''} of the timeline have no recorded sales
                  </span>
                )}
              </div>
              <div className="chart-wrapper-lg">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={combinedChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="month" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }} axisLine={false} tickLine={false} />
                    <YAxis
                      domain={[yMin, yMax]}
                      tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 12 }}
                      axisLine={false} tickLine={false}
                      tickFormatter={v => `${symbol}${(v / 1_000_000).toFixed(1)}M`}
                    />
                    <Tooltip
                      cursor={{ stroke: 'rgba(255,255,255,0.1)' }}
                      contentStyle={{ background: 'rgba(5,8,16,0.95)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '10px 16px', boxShadow: '0 12px 32px rgba(0,0,0,0.6)' }}
                      labelStyle={{ color: '#fff', fontWeight: 700, fontSize: 13, marginBottom: 4 }}
                      itemStyle={{ fontSize: 12, fontWeight: 600 }}
                      formatter={(value: number) => [`${symbol}${(value / 1_000_000).toFixed(2)}M`, undefined]}
                    />
                    <Legend wrapperStyle={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }} />
                    <ReferenceLine x={currentMonthName} stroke="rgba(255,255,255,0.35)" strokeDasharray="4 2"
                      label={{ value: 'Today', position: 'insideTopRight', fill: 'rgba(255,255,255,0.45)', fontSize: 10 }} />
                    <Line type="monotone" dataKey="actual" stroke="#22d3a8" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 7, stroke: '#fff', strokeWidth: 1.5, filter: 'drop-shadow(0 0 10px #22d3a8)' }} name="Actual Sales" connectNulls={false} />
                    <Line type="monotone" dataKey="xgboost" stroke="#6C63FF" strokeWidth={2.5} strokeDasharray="6 3" dot={{ r: 3 }} activeDot={{ r: 7, stroke: '#fff', strokeWidth: 1.5, filter: 'drop-shadow(0 0 10px #6C63FF)' }} name="XGBoost Base Forecast" connectNulls />
                    <Line type="monotone" dataKey="adjusted" stroke="#00D4FF" strokeWidth={2.5} strokeDasharray="3 3" dot={{ r: 3 }} activeDot={{ r: 7, stroke: '#fff', strokeWidth: 1.5, filter: 'drop-shadow(0 0 10px #00D4FF)' }} name="PPO + LLM Adjusted" connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* AI Models Intelligence Panel */}
            <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="section-title">AI Models Active</div>

              {/* XGBoost */}
              <div onClick={() => setStatCardModal('xgboost')}
                style={{ padding: 14, borderRadius: 'var(--r-md)', background: 'rgba(108,99,255,0.08)', border: '1px solid rgba(108,99,255,0.25)', cursor: 'pointer', transition: 'box-shadow 0.25s ease' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 1px rgba(108,99,255,0.5), 0 0 18px rgba(108,99,255,0.45), 0 0 40px rgba(108,99,255,0.25)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13, color: '#a78bfa' }}>
                    <BarChart2 size={14} /> XGBoost Demand Forecast
                  </div>
                  <span
                    className="badge"
                    style={{
                      fontSize: 10,
                      background: accuracy ? 'rgba(34,211,168,0.18)' : 'rgba(255,255,255,0.08)',
                      color: accuracy
                        ? (accuracy.totalAccuracyPct >= 90 ? '#22d3a8' : accuracy.totalAccuracyPct >= 70 ? '#f59e0b' : '#f43f5e')
                        : 'rgba(255,255,255,0.5)',
                      border: '1px solid rgba(255,255,255,0.15)',
                    }}
                  >
                    {accuracyState === 'loading' ? (backendWaking ? 'waking…' : 'measuring…')
                      : accuracy ? `${accuracy.totalAccuracyPct.toFixed(1)}% accurate` : 'not measured'}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--clr-text-muted)', marginBottom: 8 }}>
                  12 features • 54 stores • Ecuador supply chain training set
                </div>
                {/* Say which engine actually answered. Both loaders fall back
                    silently, so "XGBoost" is a claim until the backend confirms it. */}
                <div style={{ fontSize: 11, marginBottom: 8, color: modelStatus
                  ? (modelStatus.xgboost?.loaded ? '#22d3a8' : '#f43f5e')
                  : backendWaking ? '#f59e0b' : 'var(--clr-text-muted)' }}>
                  {modelStatus
                    ? (modelStatus.xgboost?.loaded
                        ? '● Model binary loaded — predictions are XGBoost'
                        : `● Model NOT loaded — serving ${modelStatus.xgboost?.engine}`)
                    : backendWaking
                      ? '◌ Waking the model server (it sleeps when idle)…'
                      : `○ Engine unconfirmed — ${modelStatusErr || 'backend unreachable'}`}
                  {!modelStatus && !backendWaking && (
                    // A dead card with no way to retry meant a page reload was
                    // the only recovery once the server came back.
                    <button
                      onClick={e => { e.stopPropagation(); fetchModelStatus(); fetchModelAccuracy() }}
                      style={{
                        marginLeft: 8, padding: '2px 8px', fontSize: 10, fontWeight: 600,
                        borderRadius: 6, cursor: 'pointer', color: '#6C63FF',
                        background: 'rgba(108,99,255,0.14)', border: '1px solid rgba(108,99,255,0.4)',
                      }}
                    >
                      Retry
                    </button>
                  )}
                </div>
                {accuracy && (
                  <div style={{ fontSize: 11, color: 'var(--clr-text-muted)', marginBottom: 8 }}>
                    {accuracy.holdoutLabel} holdout · total demand within{' '}
                    <strong style={{ color: '#fff' }}>{(100 - accuracy.totalAccuracyPct).toFixed(1)}%</strong>
                    {' '}· per-family median {accuracy.medianFamilyAccuracyPct.toFixed(0)}%
                  </div>
                )}
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${accuracy ? Math.min(100, accuracy.totalAccuracyPct) : 0}%`, background: '#6C63FF' }} />
                </div>
              </div>

              {/* LLM */}
              <div onClick={() => setStatCardModal('llm')}
                style={{ padding: 14, borderRadius: 'var(--r-md)', background: 'rgba(0,212,255,0.06)', border: '1px solid rgba(0,212,255,0.2)', cursor: 'pointer', transition: 'box-shadow 0.25s ease' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 1px rgba(0,212,255,0.5), 0 0 18px rgba(0,212,255,0.45), 0 0 40px rgba(0,212,255,0.25)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13, color: '#00D4FF' }}>
                    <Zap size={14} /> LLM Market Sentiment
                  </div>
                  <span style={{ fontWeight: 800, fontSize: 14, color: market
                    ? (market.multiplier > 1.02 ? '#22d3a8' : market.multiplier < 0.98 ? '#f43f5e' : '#fff')
                    : 'rgba(255,255,255,0.5)' }}>
                    {market ? `x${market.multiplier.toFixed(3)}` : '—'}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--clr-text-muted)', marginBottom: 8 }}>
                  {market
                    ? `WTI $${market.oil.price.toFixed(2)} · ${market.holidays.length} holiday${market.holidays.length === 1 ? '' : 's'} · ${market.headlines.length} headline${market.headlines.length === 1 ? '' : 's'}`
                    : 'Live oil (WTI) + holidays + NewsAPI'}
                </div>
                {/* Each input's share of the multiplier, so the number is
                    traceable to its evidence rather than asserted. */}
                {market && (
                  <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                    {market.components.map(c => {
                      const pct = Math.abs(c.contribution) * 100
                      const tone = c.contribution > 0.001 ? '#22d3a8' : c.contribution < -0.001 ? '#f43f5e' : 'rgba(255,255,255,0.25)'
                      return (
                        <div key={c.label} style={{ flex: 1, textAlign: 'center' }} title={c.detail}>
                          <div style={{ height: 3, borderRadius: 2, background: tone, opacity: pct > 0.1 ? 1 : 0.3, marginBottom: 4 }} />
                          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {c.label.split(' ')[0]} {c.contribution >= 0 ? '+' : ''}{(c.contribution * 100).toFixed(1)}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
                <div className="progress-bar">
                  <div className="progress-fill" style={{
                    width: `${Math.min(100, Math.max(0, (((market?.multiplier ?? 1) - 0.70) / 0.60) * 100))}%`,
                    background: market && market.multiplier > 1.02 ? '#22d3a8' : market && market.multiplier < 0.98 ? '#f43f5e' : '#00D4FF'
                  }} />
                </div>
              </div>

              {/* PPO */}
              <div onClick={() => setStatCardModal('ppo')}
                style={{ padding: 14, borderRadius: 'var(--r-md)', background: 'rgba(34,211,168,0.06)', border: '1px solid rgba(34,211,168,0.2)', cursor: 'pointer', transition: 'box-shadow 0.25s ease' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 1px rgba(34,211,168,0.5), 0 0 18px rgba(34,211,168,0.45), 0 0 40px rgba(34,211,168,0.25)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13, color: '#22d3a8' }}>
                    <Target size={14} /> PPO Reinforcement Learning
                  </div>
                  <span className="badge badge-success" style={{ fontSize: 10 }}>Active</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--clr-text-muted)', marginBottom: 8 }}>
                  Stable-Baselines3 • Obs: [xgb_pred, sentiment, stock] → reorder qty
                </div>
                <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
                  <span>Restock: <strong style={{ color: '#22d3a8' }}>{dashStats.productsNeedingRestock}</strong></span>
                  <span>Hold: <strong style={{ color: 'rgba(255,255,255,0.5)' }}>{Math.max(0, productForecasts.length - dashStats.productsNeedingRestock)}</strong></span>
                  <span>Total: <strong style={{ color: '#fff' }}>{productForecasts.length}</strong></span>
                </div>
              </div>
            </div>
          </div>

          {/* ── 4 VISUALIZATIONS ── */}
          {productForecasts.length > 0 && (
            <>
              {/* Row 1: Bubble Chart + Family Breakdown */}
              <div className="grid-12" style={{ marginBottom: 16 }}>

                {/* Chart 2: Stock vs Demand Bubble */}
                <div className="glass-card">
                  <div className="section-title">
                    Stock vs Demand Bubble Chart
                    <span className="badge badge-accent" style={{ fontSize: 10 }}>Bubble size = PPO Reorder Qty</span>
                  </div>
                  <div style={{ height: 260 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart margin={{ top: 10, right: 20, bottom: 30, left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                        <XAxis type="number" dataKey="x" name="Current Stock"
                          label={{ value: 'Current Stock (units)', position: 'insideBottom', offset: -15, fill: 'rgba(255,255,255,0.3)', fontSize: 10 }}
                          tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} axisLine={false} tickLine={false} />
                        <YAxis type="number" dataKey="y" name="Forecasted Demand"
                          label={{ value: 'Demand', angle: -90, position: 'insideLeft', fill: 'rgba(255,255,255,0.3)', fontSize: 10 }}
                          tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} axisLine={false} tickLine={false} />
                        <ZAxis type="number" dataKey="z" range={[60, 700]} name="Reorder Qty" />
                        <Tooltip cursor={{ strokeDasharray: '3 3' }} content={(props: any) => {
                          if (!props.active || !props.payload?.length) return null
                          const d = props.payload[0]?.payload
                          return (
                            <div style={{ padding: 10, background: 'rgba(10,12,25,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}>
                              <div style={{ fontWeight: 700, color: '#fff', marginBottom: 4 }}>{d?.name}</div>
                              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>Stock: <strong style={{ color: '#fff' }}>{d?.x}</strong> units</div>
                              <div style={{ fontSize: 11, color: '#a78bfa' }}>Forecast: <strong>{d?.y}</strong> units</div>
                              <div style={{ fontSize: 11, color: '#22d3a8' }}>PPO Reorder: <strong>+{d?.z}</strong> units</div>
                              <div style={{ fontSize: 10, marginTop: 4, fontWeight: 600, color: d?.fill }}>{d?.urgency}</div>
                            </div>
                          )
                        }} />
                        <Scatter data={bubbleChartData} name="Products"
                          shape={(props: any) => {
                            const { cx, cy, r, fill } = props
                            const radius = r || 6
                            const color = fill || '#f43f5e'
                            return (
                              <circle cx={cx} cy={cy} r={radius} fill={color} fillOpacity={0.8}
                                style={{ transition: 'filter 0.2s ease', cursor: 'pointer' }}
                                onMouseEnter={e => { (e.currentTarget as SVGCircleElement).style.filter = `drop-shadow(0 0 ${Math.max(6, radius * 0.7)}px ${color}) drop-shadow(0 0 ${Math.max(14, radius * 1.5)}px ${color}99)` }}
                                onMouseLeave={e => { (e.currentTarget as SVGCircleElement).style.filter = '' }}
                              />
                            )
                          }}
                        >
                          {bubbleChartData.map((entry: any, i: number) => (
                            <Cell key={i} fill={entry.fill} />
                          ))}
                        </Scatter>
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
                    {[['#f43f5e','CRITICAL'],['#f59e0b','HIGH'],['#00D4FF','MEDIUM'],['#22d3a8','LOW']].map(([c,l]) => (
                      <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'rgba(255,255,255,0.5)' }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: c }} />{l}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Chart 6: Sentiment vs PPO Reorder Decision */}
                <div className="glass-card">
                  <div className="section-title">
                    Sentiment vs Reorder Decision
                    <span className="badge badge-accent" style={{ fontSize: 10 }}>All runs · colour = product</span>
                  </div>
                  <div style={{ height: 260 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart margin={{ top: 10, right: 20, bottom: 30, left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                        <XAxis type="number" dataKey="sentiment" name="Sentiment"
                          domain={[0.7, 1.3]}
                          label={{ value: 'LLM Sentiment Multiplier', position: 'insideBottom', offset: -15, fill: 'rgba(255,255,255,0.3)', fontSize: 10 }}
                          tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} axisLine={false} tickLine={false}
                          tickFormatter={(v: number) => `x${v.toFixed(2)}`} />
                        <YAxis type="number" dataKey="reorder" name="Reorder Qty"
                          label={{ value: 'PPO Reorder Qty', angle: -90, position: 'insideLeft', fill: 'rgba(255,255,255,0.3)', fontSize: 10 }}
                          tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} axisLine={false} tickLine={false} />
                        <ZAxis range={[50, 50]} />
                        <Tooltip content={(props: any) => {
                          if (!props.active || !props.payload?.length) return null
                          const d = props.payload[0]?.payload
                          return (
                            <div style={{ padding: 10, background: 'rgba(10,12,25,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}>
                              <div style={{ fontWeight: 700, color: '#fff', marginBottom: 4 }}>{d?.name}</div>
                              <div style={{ fontSize: 11, color: '#00D4FF' }}>Sentiment: <strong>x{d?.sentiment?.toFixed(3)}</strong></div>
                              <div style={{ fontSize: 11, color: '#22d3a8' }}>PPO Reorder: <strong>+{d?.reorder} units</strong></div>
                            </div>
                          )
                        }} />
                        <ReferenceLine x={1.0} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 4"
                          label={{ value: 'Neutral', position: 'insideTopRight', fill: 'rgba(255,255,255,0.3)', fontSize: 9 }} />
                        <Scatter data={sentimentReorderData} name="Pipeline Runs"
                          shape={(props: any) => {
                            const { cx, cy, fill, payload } = props
                            const color = fill || payload?.fill || '#fff'
                            const opacity = payload?.hasData ? 0.82 : 0.35
                            return (
                              <circle cx={cx} cy={cy} r={6} fill={color} fillOpacity={opacity}
                                style={{ transition: 'filter 0.2s ease', cursor: 'pointer' }}
                                onMouseEnter={e => { if (payload?.hasData) (e.currentTarget as SVGCircleElement).style.filter = `drop-shadow(0 0 6px ${color}) drop-shadow(0 0 14px ${color}99)` }}
                                onMouseLeave={e => { (e.currentTarget as SVGCircleElement).style.filter = '' }}
                              />
                            )
                          }}
                        >
                          {sentimentReorderData.map((entry: any, i: number) => (
                            <Cell key={i} fill={entry.fill} fillOpacity={entry.hasData ? 0.82 : 0.35} />
                          ))}
                        </Scatter>
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ── STOCK RECOMMENDATIONS + MODEL ACCURACY ── */}
          <div className="grid-21" style={{ marginBottom: 16 }}>
            {/* Stock Action Recommendations */}
            <div className="glass-card">
              <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>AI Stock Action Recommendations</span>
                  <Sparkles size={15} color="var(--clr-accent-2)" />
                </div>
                {stockActions.length > 0 && (
                  <button
                    disabled={fixingAll}
                    onClick={async () => {
                      setFixingAll(true)
                      setFixAllResult(null)
                      const norm = (s: string) => (s || '').trim().toUpperCase()
                      const { data: vdata } = await supabase.from('vendors').select('*').eq('status', 'Active')
                      const allVendors: any[] = vdata || []
                      let done = 0, skipped = 0
                      const errors: string[] = []

                      for (const item of stockActions) {
                        // The order-up-to quantity, not the stored PPO figure.
                        // PPO's number is computed against the stock level at
                        // pipeline time and lands below the reorder point, so
                        // ordering it left the alert standing.
                        const reorderQty = item.recommended_qty > 0
                          ? item.recommended_qty
                          : Math.max(item.total_forecasted_demand || 0, Math.round((item.reorder_level_live || 0) * 1.5))

                        const matching = allVendors.filter(v => norm(v.category) === norm(item.family || ''))
                        if (matching.length === 0) {
                          errors.push(`${item.product_name}: no vendor for "${item.family}"`)
                          skipped++
                          continue
                        }

                        const vendor = [...matching].sort((a, b) => a.lead_time_days - b.lead_time_days)[0]

                        const { data: prod } = await supabase
                          .from('products').select('unit_price, id').ilike('name', item.product_name).limit(1).single()
                        const unitCost = prod ? parseFloat(prod.unit_price || '0') * 0.6 : 0
                        const total    = Math.round(reorderQty * unitCost)
                        const now      = new Date().toISOString()
                        const delivDate = new Date(); delivDate.setDate(delivDate.getDate() + (vendor.lead_time_days || 7))

                        await supabase.from('restock_orders').insert({
                          vendor_id: vendor.id, vendor_name: vendor.company, vendor_email: vendor.email,
                          items: [{
                            product_name: item.product_name,
                            sku: prod?.id ? skuFor(prod.id) : '',
                            quantity: reorderQty,
                            unit_cost: unitCost,
                          }],
                          total_cost: total, status: 'Pending',
                          notes: `AI Fix-All restock — ${item.urgency} · to ${ORDER_UP_TO_DAYS}d cover`,
                          expected_delivery: delivDate.toISOString().split('T')[0],
                          ordered_at: now,
                        })

                        // Note: no financial_transactions write — Payment page reads procurement
                        // totals directly from restock_orders.total_cost to avoid double-counting.

                        if (item.inventory_id) {
                          await supabase.from('inventory')
                            .update({ current_stock: (item.current_stock_live || 0) + reorderQty, last_updated: now })
                            .eq('id', item.inventory_id)
                        } else if (prod?.id) {
                          await supabase.from('inventory')
                            .update({ current_stock: (item.current_stock_live || 0) + reorderQty, last_updated: now })
                            .eq('product_id', prod.id)
                        }

                        done++
                      }

                      // Re-derive the list from the database rather than
                      // filtering it locally. The old optimistic filter guessed
                      // at what should remain and was overwritten by the next
                      // refresh anyway; refetching shows what is actually true,
                      // including any item the new stock level did not clear.
                      setFixAllResult({ done, skipped, errors })
                      await fetchDashboardIntelligence()
                      setFixingAll(false)
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 7,
                      padding: '7px 16px', borderRadius: 10, fontSize: 12, fontWeight: 700,
                      border: '1px solid rgba(108,99,255,0.6)',
                      background: fixingAll ? 'rgba(108,99,255,0.12)' : 'rgba(108,99,255,0.22)',
                      color: '#a78bfa', cursor: fixingAll ? 'wait' : 'pointer',
                      opacity: fixingAll ? 0.7 : 1,
                      boxShadow: fixingAll ? 'none' : '0 0 0 1px rgba(108,99,255,0.5), 0 0 18px rgba(108,99,255,0.4), 0 0 40px rgba(108,99,255,0.2)',
                      transition: 'box-shadow 0.3s ease, background 0.2s',
                      animation: fixingAll ? 'none' : undefined,
                    }}
                    onMouseEnter={e => { if (!fixingAll) (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 1px rgba(108,99,255,0.8), 0 0 28px rgba(108,99,255,0.6), 0 0 60px rgba(108,99,255,0.3)' }}
                    onMouseLeave={e => { if (!fixingAll) (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 1px rgba(108,99,255,0.5), 0 0 18px rgba(108,99,255,0.4), 0 0 40px rgba(108,99,255,0.2)' }}
                  >
                    {fixingAll
                      ? <><RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} /> Fixing…</>
                      : <><Zap size={12} /> Fix All ({stockActions.length})</>
                    }
                  </button>
                )}
              </div>

              {fixAllResult && (
                <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 10, fontSize: 12,
                  background: fixAllResult.skipped === 0 ? 'rgba(34,211,168,0.1)' : 'rgba(245,158,11,0.1)',
                  border: `1px solid ${fixAllResult.skipped === 0 ? 'rgba(34,211,168,0.35)' : 'rgba(245,158,11,0.35)'}`,
                  color: fixAllResult.skipped === 0 ? '#22d3a8' : '#f59e0b' }}>
                  ✓ {fixAllResult.done} order{fixAllResult.done !== 1 ? 's' : ''} placed
                  {fixAllResult.skipped > 0 && ` · ${fixAllResult.skipped} need a vendor`}
                </div>
              )}

              {stockActions.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--clr-text-muted)', fontSize: 13 }}>
                  {dashLoading ? 'Computing recommendations...' : 'Run the pipeline on your products to generate AI-driven restock recommendations.'}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', maxHeight: 340, paddingRight: 4 }}>
                  {stockActions.map((item: any, i: number) => {
                    const glowColor = item.urgency === 'CRITICAL' ? '244,63,94' : item.urgency === 'HIGH' ? '245,158,11' : '34,211,168'
                    return (
                    <div key={i}
                      onClick={() => setSelectedAction(item)}
                      style={{
                        padding: 14, borderRadius: 'var(--r-md)', cursor: 'pointer',
                        background: item.urgency === 'CRITICAL' ? 'rgba(244,63,94,0.08)' : item.urgency === 'HIGH' ? 'rgba(245,158,11,0.08)' : 'rgba(34,211,168,0.06)',
                        border: `1px solid ${item.urgency === 'CRITICAL' ? 'rgba(244,63,94,0.85)' : item.urgency === 'HIGH' ? 'rgba(245,158,11,0.85)' : 'rgba(34,211,168,0.75)'}`,
                        transition: 'box-shadow 0.25s ease, transform 0.18s ease',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.boxShadow = `0 0 0 1px rgba(${glowColor},0.4), 0 0 18px rgba(${glowColor},0.45), 0 0 40px rgba(${glowColor},0.25)`; e.currentTarget.style.transform = 'translateX(3px)' }}
                      onMouseLeave={e => { e.currentTarget.style.boxShadow = ''; e.currentTarget.style.transform = '' }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                        <div>
                          <span style={{ fontWeight: 700, color: '#fff', fontSize: 14 }}>{item.product_name}</span>
                          <span style={{ marginLeft: 8 }} className="badge badge-accent">{item.family || item.product_name?.split(' ')[0]}</span>
                          <span style={{ marginLeft: 6, fontSize: 10, padding: '2px 6px', borderRadius: 8, fontWeight: 600,
                            background: item.urgency === 'CRITICAL' ? 'rgba(244,63,94,0.2)' : 'rgba(245,158,11,0.2)',
                            color: item.urgency === 'CRITICAL' ? '#f43f5e' : '#f59e0b'
                          }}>{item.urgency}</span>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          {/* Show the quantity that will actually be ordered,
                              so the number on screen is the one that clears
                              the alert rather than PPO's stale figure. */}
                          <div style={{ fontSize: 20, fontWeight: 800, color: '#22d3a8', lineHeight: 1 }}>
                            +{item.recommended_qty}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--clr-text-muted)' }}>
                            units → {ORDER_UP_TO_DAYS}d cover
                          </div>
                          {item.ppo_reorder_qty > 0 && item.ppo_reorder_qty !== item.recommended_qty && (
                            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>
                              PPO said +{item.ppo_reorder_qty}
                            </div>
                          )}
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.6 }}>
                        Stock <strong style={{ color: item.current_stock_live < item.reorder_level_live ? '#f43f5e' : '#fff' }}>{item.current_stock_live}</strong> units
                        ({item.days_of_stock > 500 ? '∞' : item.days_of_stock} days supply)
                        · Sells <strong style={{ color: '#00D4FF' }}>{item.daily_demand}/day</strong>
                        <span style={{ color: 'rgba(255,255,255,0.35)' }}> ({item.demand_basis})</span>
                        · XGBoost forecast: <strong style={{ color: '#a78bfa' }}>{item.total_forecasted_demand} units/{item.forecast_period}</strong>
                        · Sentiment: <strong style={{ color: item.sentiment_multiplier > 1.02 ? '#22d3a8' : item.sentiment_multiplier < 0.98 ? '#f43f5e' : '#fff' }}>
                          x{parseFloat(item.sentiment_multiplier).toFixed(3)} {item.sentiment_multiplier > 1.02 ? '↑' : item.sentiment_multiplier < 0.98 ? '↓' : '─'}
                        </strong>
                      </div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
                        Ordering <strong style={{ color: '#22d3a8' }}>+{item.recommended_qty}</strong> takes it to{' '}
                        <strong style={{ color: '#fff' }}>{item.days_after_restock}</strong> days — clear of the{' '}
                        {REORDER_POINT_DAYS}-day reorder point, so it leaves this list.
                      </div>
                      <div style={{ fontSize: 10, color: `rgba(${glowColor},0.7)`, marginTop: 6, fontWeight: 500 }}>Click to analyze →</div>
                    </div>
                  )})}
                </div>
              )}
            </div>

            {/* Model Accuracy Details */}
            <div className="glass-card">
              <div className="section-title">Live Pipeline Coverage</div>
              {[
                {
                  name: 'Products With A Live Forecast',
                  value: products.length > 0 ? Math.round((productForecasts.length / products.length) * 100) : 0,
                  color: '#6C63FF',
                  sub: `${productForecasts.length} of ${products.length} products returned by the AI pipeline`,
                },
                {
                  name: 'Forecasts Backed By Real Sales',
                  value: productForecasts.length > 0
                    ? Math.round((productForecasts.filter((f: any) => Array.isArray(f.historical_sales) && f.historical_sales.length > 0).length / productForecasts.length) * 100)
                    : 0,
                  color: '#00D4FF',
                  sub: 'Share of runs fed recorded sales_transactions history',
                },
                {
                  name: 'Products Flagged For Restock',
                  value: productForecasts.length > 0
                    ? Math.round((dashStats.productsNeedingRestock / productForecasts.length) * 100)
                    : 0,
                  color: '#22d3a8',
                  sub: `${dashStats.productsNeedingRestock} of ${productForecasts.length} forecast products need reordering`,
                },
              ].map(m => (
                <div key={m.name} style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                    <span style={{ fontWeight: 600 }}>{m.name}</span>
                    <span style={{ color: m.color, fontWeight: 700 }}>{m.value}%</span>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--clr-text-muted)', marginBottom: 5 }}>{m.sub}</div>
                  <div className="progress-bar"><div className="progress-fill" style={{ width: `${m.value}%`, background: m.color }} /></div>
                </div>
              ))}
            </div>
          </div>

          {/* ── ALL PRODUCTS AI STATUS TABLE — bottom, collapsible ── */}
          <div className="glass-card" style={{ marginBottom: 4 }}>
            {/* Header — always visible, click to toggle */}
            <div
              className="section-title"
              onClick={() => setStatusTableOpen(o => !o)}
              style={{ cursor: 'pointer', userSelect: 'none', marginBottom: statusTableOpen ? undefined : 0 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
                All Products — AI Intelligence Status
                <span className="badge badge-accent" style={{ fontSize: 10 }}>Latest Run Per Product</span>
                {productForecasts.length > 0 && (
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontWeight: 400 }}>
                    {productForecasts.length} products
                  </span>
                )}
              </div>
              <button
                className="btn btn-ghost btn-sm"
                style={{ padding: '4px 8px', pointerEvents: 'none' }}
                tabIndex={-1}
              >
                {statusTableOpen
                  ? <ChevronUp size={15} color="rgba(255,255,255,0.5)" />
                  : <ChevronDown size={15} color="rgba(255,255,255,0.5)" />}
              </button>
            </div>

            {/* Collapsible body */}
            {statusTableOpen && (
              productForecasts.length > 0 ? (
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Family</th>
                        <th>Live Stock</th>
                        <th>Forecasted Demand</th>
                        <th>Daily Avg</th>
                        <th>LLM Sentiment</th>
                        <th>PPO Decision</th>
                        <th>Stock Health</th>
                      </tr>
                    </thead>
                    <tbody>
                      {productForecasts.map((f: any) => (
                        <tr key={f.product_id}>
                          <td><span style={{ fontWeight: 600, color: '#fff' }}>{f.product_name}</span></td>
                          <td><span className="badge badge-accent" style={{ fontSize: 9, padding: '2px 6px' }}>{f.family || '—'}</span></td>
                          <td>
                            <span style={{ color: f.current_stock_live < f.reorder_level_live ? '#f43f5e' : '#fff', fontWeight: 600 }}>
                              {f.current_stock_live} units
                            </span>
                            {f.current_stock_live < f.reorder_level_live && (
                              <div style={{ fontSize: 9, color: '#f43f5e' }}>Below reorder ({f.reorder_level_live})</div>
                            )}
                          </td>
                          <td>
                            <span style={{ color: '#a78bfa', fontWeight: 600 }}>{f.total_forecasted_demand} units</span>
                            <div style={{ fontSize: 10, color: 'var(--clr-text-muted)' }}>{f.forecast_period}</div>
                          </td>
                          <td style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>{f.daily_demand}/day</td>
                          <td>
                            <span style={{ fontWeight: 700, fontSize: 13, color: f.sentiment_multiplier > 1.02 ? '#22d3a8' : f.sentiment_multiplier < 0.98 ? '#f43f5e' : '#fff' }}>
                              x{parseFloat(f.sentiment_multiplier).toFixed(3)}{' '}
                              {f.sentiment_multiplier > 1.02 ? '↑' : f.sentiment_multiplier < 0.98 ? '↓' : '─'}
                            </span>
                          </td>
                          <td>
                            <span style={{ color: f.optimal_reorder_qty > 0 ? '#22d3a8' : 'rgba(255,255,255,0.4)', fontWeight: 600 }}>
                              {f.optimal_reorder_qty > 0 ? `+${f.optimal_reorder_qty} units` : 'Hold'}
                            </span>
                          </td>
                          <td>
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                              padding: '3px 8px', borderRadius: 12, fontSize: 10, fontWeight: 600,
                              background: f.urgency === 'CRITICAL' ? 'rgba(244,63,94,0.15)' : f.urgency === 'HIGH' ? 'rgba(245,158,11,0.15)' : f.urgency === 'MEDIUM' ? 'rgba(0,212,255,0.12)' : 'rgba(34,211,168,0.12)',
                              color: f.urgency === 'CRITICAL' ? '#f43f5e' : f.urgency === 'HIGH' ? '#f59e0b' : f.urgency === 'MEDIUM' ? '#00D4FF' : '#22d3a8',
                            }}>
                              {f.urgency} · {f.days_of_stock > 500 ? '∞' : `${f.days_of_stock}d`}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '30px', borderTop: '1px solid var(--clr-border)' }}>
                  <Layers size={28} color="rgba(255,255,255,0.2)" style={{ marginBottom: 10 }} />
                  <div style={{ color: 'var(--clr-text-muted)', fontSize: 13 }}>
                    Product AI status will populate after running the pipeline on each product.
                  </div>
                </div>
              )
            )}
          </div>
        </>
      )}

      {/* ============================================================
          TAB 2: INTERACTIVE PIPELINE PREDICTOR (New)
          ============================================================ */}
      {activeTab === 'pipeline' && (
        <div className="flex flex-col gap-4">

          {/* ── RUN ALL PRODUCTS BANNER ── */}
          <div className="glass-card" style={{
            padding: '14px 20px', display: 'flex', alignItems: 'center',
            gap: 16, flexWrap: 'wrap',
            background: batchRunning ? 'rgba(108,99,255,0.08)' : 'rgba(255,255,255,0.03)',
            border: `1px solid ${batchRunning ? 'rgba(108,99,255,0.35)' : 'var(--clr-border)'}`,
          }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#fff', marginBottom: 2 }}>
                Batch Run — All Products
              </div>
              {batchRunning ? (
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>
                  Running <strong style={{ color: '#a78bfa' }}>{batchProgress.current}</strong>
                  {' '}· {batchProgress.done} / {batchProgress.total} products
                </div>
              ) : batchProgress.total > 0 ? (
                <div style={{ fontSize: 12, color: '#22d3a8' }}>
                  Completed — {batchProgress.total - batchProgress.errors} succeeded
                  {batchProgress.errors > 0 && <span style={{ color: '#f43f5e' }}>, {batchProgress.errors} failed</span>}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
                  Runs the full AI pipeline for every product in one click · {products.length} products loaded
                </div>
              )}
            </div>

            {/* Progress bar (visible while running) */}
            {batchRunning && (
              <div style={{ flex: 2, minWidth: 160 }}>
                <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 3,
                    width: `${batchProgress.total > 0 ? (batchProgress.done / batchProgress.total) * 100 : 0}%`,
                    background: 'linear-gradient(90deg, #6C63FF, #00D4FF)',
                    transition: 'width 0.4s ease',
                  }} />
                </div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 4, textAlign: 'right' }}>
                  {batchProgress.total > 0 ? Math.round((batchProgress.done / batchProgress.total) * 100) : 0}% complete
                </div>
              </div>
            )}

            <button
              className="btn btn-primary"
              style={{ whiteSpace: 'nowrap', padding: '10px 20px', fontSize: 13, opacity: (batchRunning || submitting) ? 0.5 : 1 }}
              disabled={batchRunning || submitting || products.length === 0}
              onClick={handleRunAllProducts}
            >
              {batchRunning
                ? <><RefreshCw size={14} style={{ animation: 'spin 0.8s linear infinite' }} /> Running {batchProgress.done}/{batchProgress.total}…</>
                : <><Sparkles size={14} /> Run All {products.length} Products</>
              }
            </button>
          </div>

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
                  disabled={submitting || batchRunning}
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
                      {/* Confidence Threshold from Settings, applied against the
                          MEASURED out-of-sample accuracy rather than a number the
                          model asserts about itself. Below the floor the number is
                          still shown — it is just not put forward as an action. */}
                      {belowConfidence && pipelineResult.optimal_reorder_qty > 0 && (
                        <div style={{ fontSize: 11, color: '#f59e0b', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 8, padding: '8px 10px' }}>
                          Advisory only — measured accuracy {accuracy!.totalAccuracyPct.toFixed(1)}% is below your {aiConfidence}% confidence threshold, so this is not raised as an automatic restock suggestion.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Market Intelligence Card */}
                  <div className="glass-card" style={{ background: 'rgba(255,255,255,0.02)', display: 'flex', flexDirection: 'column', gap: 14 }}>

                    {/* Header */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#fff', fontSize: 13, fontWeight: 600 }}>
                        <Zap size={15} color="var(--clr-warning)" /> Market Intelligence Analysis
                      </div>
                      <span className={`badge ${
                        pipelineResult.sentiment_direction === 'UP' ? 'badge-success' :
                        pipelineResult.sentiment_direction === 'DOWN' ? 'badge-danger' : 'badge-accent'
                      }`} style={{ fontSize: 11, padding: '3px 10px', letterSpacing: 1 }}>
                        DEMAND {pipelineResult.sentiment_direction || 'NEUTRAL'}
                      </span>
                    </div>

                    {/* Data sources used */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px',
                        borderRadius: 20, fontSize: 11, fontWeight: 600,
                        background: (pipelineResult.oil_price_used || 78.5) > 90
                          ? 'rgba(244,63,94,0.15)' : (pipelineResult.oil_price_used || 78.5) < 65
                          ? 'rgba(34,211,168,0.15)' : 'rgba(245,158,11,0.15)',
                        color: (pipelineResult.oil_price_used || 78.5) > 90 ? '#f43f5e'
                          : (pipelineResult.oil_price_used || 78.5) < 65 ? '#22d3a8' : '#f59e0b',
                        border: '1px solid currentColor',
                      }}>
                        🛢 WTI Oil: ${(pipelineResult.oil_price_used || 78.5).toFixed(2)}/bbl
                        {(pipelineResult.oil_price_used || 78.5) > 90 ? ' ↑ High' :
                         (pipelineResult.oil_price_used || 78.5) < 65 ? ' ↓ Low' : ' — Normal'}
                      </div>
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px',
                        borderRadius: 20, fontSize: 11, fontWeight: 600,
                        background: (pipelineResult.holidays_count || 0) > 0 ? 'rgba(108,99,255,0.15)' : 'rgba(255,255,255,0.06)',
                        color: (pipelineResult.holidays_count || 0) > 0 ? '#a78bfa' : 'rgba(255,255,255,0.4)',
                        border: '1px solid currentColor',
                      }}>
                        📅 {pipelineResult.holidays_count || 0} Upcoming Holiday{(pipelineResult.holidays_count || 0) !== 1 ? 's' : ''}
                      </div>
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px',
                        borderRadius: 20, fontSize: 11, fontWeight: 600,
                        background: pipelineResult.market_context_used ? 'rgba(0,212,255,0.12)' : 'rgba(255,255,255,0.06)',
                        color: pipelineResult.market_context_used ? '#00D4FF' : 'rgba(255,255,255,0.4)',
                        border: '1px solid currentColor',
                      }}>
                        📰 {pipelineResult.market_context_used ? 'Live News' : 'No News'}
                      </div>
                    </div>

                    {/* Key factors */}
                    {pipelineResult.sentiment_key_factors && pipelineResult.sentiment_key_factors.length > 0 && (
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--clr-text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                          Key Factors
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {pipelineResult.sentiment_key_factors.map((factor: string, i: number) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: 'rgba(240,242,255,0.85)', lineHeight: 1.5 }}>
                              <span style={{ color: 'var(--clr-accent-2)', marginTop: 2, flexShrink: 0 }}>▸</span>
                              {factor}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Analyst conclusion */}
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--clr-text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                        Analyst Conclusion
                      </div>
                      <p style={{ fontSize: 12.5, lineHeight: 1.7, color: 'rgba(240,242,255,0.7)', margin: 0 }}>
                        {pipelineResult.sentiment_analysis}
                      </p>
                    </div>
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
            <div
              className="section-title"
              onClick={() => setHistoryOpen(o => !o)}
              style={{ cursor: 'pointer', userSelect: 'none', marginBottom: historyOpen ? undefined : 0 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                <span>Prediction Log & Run History</span>
                {predictionHistory.length > 0 && (
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontWeight: 400 }}>
                    {predictionHistory.length} runs
                  </span>
                )}
              </div>
              <button
                className="btn btn-ghost btn-sm"
                onClick={e => { e.stopPropagation(); handleDeleteAll() }}
                disabled={deletingAll || predictionHistory.length === 0}
                style={{ padding: '4px 10px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 5, color: '#f43f5e', borderColor: 'rgba(244,63,94,0.3)' }}
              >
                <Trash2 size={12} />
                {deletingAll ? 'Clearing…' : 'Clear All'}
              </button>
              <span style={{ marginLeft: 4, display: 'flex', alignItems: 'center' }}>
                {historyOpen ? <ChevronUp size={15} color="rgba(255,255,255,0.5)" /> : <ChevronDown size={15} color="rgba(255,255,255,0.5)" />}
              </span>
            </div>

            {historyOpen && (
            <>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Horizon</th>
                    <th>Stock</th>
                    <th>Sentiment</th>
                    <th>PPO Restock</th>
                    <th>Time</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {predictionHistory.map((row) => (
                    <>
                      <tr key={row.id} style={{ background: inspectedRow?.id === row.id ? 'rgba(108,99,255,0.06)' : undefined }}>
                        <td>
                          <span style={{ fontWeight: 600, color: '#fff' }}>{row.product_name}</span>
                        </td>
                        <td><span className="badge badge-accent">{row.forecast_period}</span></td>
                        <td>
                          <div style={{ fontSize: 12 }}>
                            <span style={{ color: '#fff' }}>{row.current_stock}</span>
                            <span style={{ color: 'var(--clr-text-muted)' }}> / {row.reorder_level} reorder</span>
                          </div>
                        </td>
                        <td>
                          <strong style={{ color: row.sentiment_multiplier > 1.02 ? 'var(--clr-success)' : row.sentiment_multiplier < 0.98 ? 'var(--clr-danger)' : '#fff' }}>
                            x{parseFloat(row.sentiment_multiplier).toFixed(3)}
                            {row.sentiment_multiplier > 1.02 ? ' ↑' : row.sentiment_multiplier < 0.98 ? ' ↓' : ' ─'}
                          </strong>
                        </td>
                        <td>
                          <strong style={{ color: row.optimal_reorder_qty > 0 ? 'var(--clr-success)' : 'var(--clr-text-muted)' }}>
                            {row.optimal_reorder_qty > 0 ? `+${row.optimal_reorder_qty}` : 'Hold'}
                          </strong>
                        </td>
                        <td style={{ color: 'var(--clr-text-muted)', fontSize: 11 }}>
                          {fmtDateTime(row.predicted_at)}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              className="btn btn-ghost btn-sm"
                              style={{ padding: '4px 8px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, color: inspectedRow?.id === row.id ? 'var(--clr-accent-2)' : undefined }}
                              onClick={() => setInspectedRow(inspectedRow?.id === row.id ? null : row)}
                            >
                              <Eye size={12} /> {inspectedRow?.id === row.id ? 'Close' : 'Inspect'}
                            </button>
                            <button
                              className="btn btn-ghost btn-sm"
                              style={{ padding: '4px 8px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, color: '#f43f5e', opacity: deletingId === row.id ? 0.5 : 1 }}
                              onClick={() => handleDeleteRow(row.id)}
                              disabled={deletingId === row.id}
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Inline inspection panel */}
                      {inspectedRow?.id === row.id && (
                        <tr key={`${row.id}-inspect`}>
                          <td colSpan={7} style={{ padding: 0 }}>
                            <div style={{ padding: '16px 20px', background: 'rgba(108,99,255,0.04)', borderTop: '1px solid rgba(108,99,255,0.15)', borderBottom: '1px solid rgba(108,99,255,0.15)', display: 'flex', flexDirection: 'column', gap: 14 }}>

                              {/* Header */}
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ fontWeight: 700, color: '#fff', fontSize: 13 }}>
                                  {row.product_name} — {row.forecast_period} forecast
                                  <span style={{ marginLeft: 10, fontSize: 11, color: 'var(--clr-text-muted)', fontWeight: 400 }}>
                                    {new Date(row.predicted_at).toLocaleString()}
                                  </span>
                                </div>
                                <button onClick={() => setInspectedRow(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.3)' }}>
                                  <X size={14} />
                                </button>
                              </div>

                              {/* 3 metric cards */}
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                                <div style={{ padding: 12, borderRadius: 8, background: 'rgba(0,212,255,0.06)', border: '1px solid rgba(0,212,255,0.2)' }}>
                                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginBottom: 4, fontWeight: 700, textTransform: 'uppercase' }}>LLM Market Sentiment</div>
                                  <div style={{ fontSize: 24, fontWeight: 800, color: row.sentiment_multiplier > 1.02 ? '#22d3a8' : row.sentiment_multiplier < 0.98 ? '#f43f5e' : '#fff' }}>
                                    x{parseFloat(row.sentiment_multiplier).toFixed(3)}
                                  </div>
                                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
                                    {row.sentiment_multiplier > 1.02 ? '↑ Demand increasing' : row.sentiment_multiplier < 0.98 ? '↓ Demand decreasing' : '─ Neutral baseline'}
                                  </div>
                                </div>
                                <div style={{ padding: 12, borderRadius: 8, background: 'rgba(108,99,255,0.06)', border: '1px solid rgba(108,99,255,0.2)' }}>
                                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginBottom: 4, fontWeight: 700, textTransform: 'uppercase' }}>XGBoost Demand ({row.forecast_period})</div>
                                  <div style={{ fontSize: 24, fontWeight: 800, color: '#a78bfa' }}>
                                    {Array.isArray(row.forecasted_demand)
                                      ? Math.round(row.forecasted_demand.reduce((a: number, b: number) => a + b, 0))
                                      : '—'} units
                                  </div>
                                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
                                    {Array.isArray(row.forecasted_demand)
                                      ? `~${(row.forecasted_demand.reduce((a: number, b: number) => a + b, 0) / (row.forecast_period === '7d' ? 7 : row.forecast_period === '90d' ? 90 : row.forecast_period === '365d' ? 365 : 30)).toFixed(1)} units/day avg`
                                      : ''}
                                  </div>
                                </div>
                                <div style={{ padding: 12, borderRadius: 8, background: 'rgba(34,211,168,0.06)', border: '1px solid rgba(34,211,168,0.2)' }}>
                                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginBottom: 4, fontWeight: 700, textTransform: 'uppercase' }}>PPO RL Decision</div>
                                  <div style={{ fontSize: 24, fontWeight: 800, color: row.optimal_reorder_qty > 0 ? '#22d3a8' : 'rgba(255,255,255,0.4)' }}>
                                    {row.optimal_reorder_qty > 0 ? `+${row.optimal_reorder_qty}` : 'Hold'}
                                  </div>
                                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
                                    {row.optimal_reorder_qty > 0 ? 'Restock recommended' : 'Inventory sufficient'}
                                  </div>
                                </div>
                              </div>

                              {/* Sentiment analysis */}
                              {row.sentiment_analysis && (
                                <div>
                                  <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Analyst Conclusion</div>
                                  <p style={{ fontSize: 12.5, lineHeight: 1.65, color: 'rgba(240,242,255,0.65)', margin: 0 }}>{row.sentiment_analysis}</p>
                                </div>
                              )}

                              {/* First 10 days forecast */}
                              {Array.isArray(row.forecasted_demand) && row.forecasted_demand.length > 0 && (
                                <div>
                                  <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                                    First 10 Days — Daily Demand Forecast
                                  </div>
                                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                    {row.forecasted_demand.slice(0, 10).map((val: number, i: number) => (
                                      <div key={i} style={{ padding: '4px 10px', background: 'rgba(108,99,255,0.12)', borderRadius: 6, fontSize: 11, color: '#a78bfa', fontWeight: 600 }}>
                                        Day {i + 1}: {Math.round(val)}
                                      </div>
                                    ))}
                                    {row.forecasted_demand.length > 10 && (
                                      <div style={{ padding: '4px 10px', background: 'rgba(255,255,255,0.04)', borderRadius: 6, fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
                                        +{row.forecasted_demand.length - 10} more days…
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* Market context */}
                              {row.market_text && (
                                <div>
                                  <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Market Context Used</div>
                                  <p style={{ fontSize: 11, lineHeight: 1.6, color: 'rgba(255,255,255,0.4)', margin: 0, maxHeight: 72, overflow: 'hidden' }}>
                                    {row.market_text.slice(0, 320)}{row.market_text.length > 320 ? '…' : ''}
                                  </p>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}

                  {predictionHistory.length === 0 && !loadingHistory && (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--clr-text-muted)', fontSize: 13 }}>
                        No prediction logs yet. Run the pipeline to start logging.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Supabase delete permission note */}
            <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>
                If delete buttons don't work, run this once in your{' '}
                <strong style={{ color: 'rgba(255,255,255,0.65)' }}>Supabase SQL Editor</strong>:
              </span>
              <code style={{ fontSize: 11, background: 'rgba(0,0,0,0.3)', padding: '3px 10px', borderRadius: 5, color: '#f59e0b', userSelect: 'all' }}>
                {RLS_SQL_FIX}
              </code>
            </div>
            </>
            )}
          </div>
        </div>
      )}
      {/* ── AI STOCK ACTION DETAIL MODAL ── */}
      {selectedAction && createPortal(
        <div onClick={() => { setSelectedAction(null); setApproveMsg(null) }} style={{ position: 'fixed', inset: 0, zIndex: 10500, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 620, maxHeight: '88vh', overflowY: 'auto', background: 'rgba(8,10,22,0.97)', border: `1px solid ${selectedAction.urgency === 'CRITICAL' ? 'rgba(244,63,94,0.5)' : selectedAction.urgency === 'HIGH' ? 'rgba(245,158,11,0.5)' : 'rgba(34,211,168,0.5)'}`, borderRadius: 22, padding: 32, boxShadow: `0 0 0 1px ${selectedAction.urgency === 'CRITICAL' ? 'rgba(244,63,94,0.2)' : selectedAction.urgency === 'HIGH' ? 'rgba(245,158,11,0.2)' : 'rgba(34,211,168,0.2)'}, 0 32px 80px rgba(0,0,0,0.8)`, animation: 'pageIn 0.2s ease-out' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <h2 style={{ fontSize: 20, fontWeight: 800, color: '#fff', margin: 0 }}>{selectedAction.product_name}</h2>
                  <span className="badge badge-accent">{selectedAction.family}</span>
                  <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 8, fontWeight: 700, background: selectedAction.urgency === 'CRITICAL' ? 'rgba(244,63,94,0.2)' : selectedAction.urgency === 'HIGH' ? 'rgba(245,158,11,0.2)' : 'rgba(34,211,168,0.15)', color: selectedAction.urgency === 'CRITICAL' ? '#f43f5e' : selectedAction.urgency === 'HIGH' ? '#f59e0b' : '#22d3a8' }}>{selectedAction.urgency}</span>
                </div>
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', margin: 0 }}>AI-driven stock intelligence analysis</p>
              </div>
              <button onClick={() => { setSelectedAction(null); setApproveMsg(null) }} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '7px 11px', cursor: 'pointer', color: 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center' }}><X size={16} /></button>
            </div>

            {/* Stock status bar */}
            {(() => {
              const max = Math.max(selectedAction.reorder_level_live * 2, selectedAction.current_stock_live, 1)
              const pct = Math.min((selectedAction.current_stock_live / max) * 100, 100)
              const reorderPct = Math.min((selectedAction.reorder_level_live / max) * 100, 100)
              const barColor = selectedAction.current_stock_live === 0 ? '#f43f5e' : selectedAction.current_stock_live < selectedAction.reorder_level_live ? '#f59e0b' : '#22d3a8'
              return (
                <div style={{ marginBottom: 22 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                    <span style={{ color: 'rgba(255,255,255,0.5)' }}>Inventory Level</span>
                    <span style={{ color: barColor, fontWeight: 700 }}>{selectedAction.current_stock_live} / {selectedAction.reorder_level_live} reorder point</span>
                  </div>
                  <div style={{ height: 10, borderRadius: 5, background: 'rgba(255,255,255,0.07)', position: 'relative', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${pct}%`, background: barColor, borderRadius: 5, transition: 'width 0.4s ease', boxShadow: `0 0 8px ${barColor}88` }} />
                    <div style={{ position: 'absolute', left: `${reorderPct}%`, top: 0, height: '100%', width: 2, background: 'rgba(255,255,255,0.4)' }} />
                  </div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 4 }}>
                    {selectedAction.days_of_stock > 500 ? '∞ days' : `${selectedAction.days_of_stock} days`} of supply remaining
                  </div>
                </div>
              )
            })()}

            {/* 3-column stat tiles */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 22, flexWrap: 'wrap' }}>
              {[
                { label: 'XGBoost Demand', value: `${selectedAction.total_forecasted_demand} units`, sub: `over ${selectedAction.forecast_period}`, color: '#a78bfa' },
                { label: 'Daily Rate', value: `${selectedAction.daily_demand}/day`, sub: 'avg demand', color: '#00D4FF' },
                { label: 'Forecasted Revenue', value: `${symbol}${(selectedAction.forecasted_revenue || 0).toLocaleString()}`, sub: `${selectedAction.forecast_period} outlook`, color: '#22d3a8' },
              ].map(t => (
                <div key={t.label} style={{ flex: '1 1 130px', padding: '13px 15px', borderRadius: 12, background: `${t.color}0d`, border: `1px solid ${t.color}30` }}>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>{t.label}</div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: t.color }}>{t.value}</div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>{t.sub}</div>
                </div>
              ))}
            </div>

            {/* Sentiment + PPO row */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 22 }}>
              <div style={{ flex: 1, padding: '14px 16px', borderRadius: 14, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>LLM Market Sentiment</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: selectedAction.sentiment_multiplier > 1.02 ? '#22d3a8' : selectedAction.sentiment_multiplier < 0.98 ? '#f43f5e' : '#fff', lineHeight: 1, marginBottom: 4 }}>
                  x{parseFloat(selectedAction.sentiment_multiplier).toFixed(3)}
                  {' '}{selectedAction.sentiment_multiplier > 1.02 ? '↑' : selectedAction.sentiment_multiplier < 0.98 ? '↓' : '─'}
                </div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>
                  {selectedAction.sentiment_multiplier > 1.02 ? 'Positive market signal — demand boosted' : selectedAction.sentiment_multiplier < 0.98 ? 'Negative market signal — demand reduced' : 'Neutral market conditions'}
                </div>
              </div>
              <div style={{ flex: 1, padding: '14px 16px', borderRadius: 14, background: 'rgba(34,211,168,0.06)', border: '1px solid rgba(34,211,168,0.2)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>PPO RL Recommendation</div>
                {(() => {
                  const rec = selectedAction.recommended_qty || Math.max(selectedAction.total_forecasted_demand, Math.round((selectedAction.reorder_level_live || 0) * 1.5))
                  const isPPO = (selectedAction.ppo_reorder_qty || 0) > 0
                  return (
                    <>
                      <div style={{ fontSize: 28, fontWeight: 800, color: '#22d3a8', lineHeight: 1, marginBottom: 4 }}>+{rec} units</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>
                        {isPPO ? 'PPO agent direct output' : 'Calculated from demand forecast'}
                      </div>
                    </>
                  )
                })()}
              </div>
            </div>

            {/* Sentiment analysis text */}
            {selectedAction.sentiment_analysis && (
              <div style={{ marginBottom: 22, padding: '14px 16px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Analyst Conclusion</div>
                <p style={{ fontSize: 12.5, lineHeight: 1.7, color: 'rgba(240,242,255,0.65)', margin: 0 }}>{selectedAction.sentiment_analysis}</p>
              </div>
            )}

            {/* First 10 day forecast chips */}
            {Array.isArray(selectedAction.forecasted_demand) && selectedAction.forecasted_demand.length > 0 && (
              <div style={{ marginBottom: 22 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Daily Demand Forecast (First 10 Days)</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {selectedAction.forecasted_demand.slice(0, 10).map((val: number, di: number) => (
                    <div key={di} style={{ padding: '5px 10px', background: 'rgba(108,99,255,0.12)', borderRadius: 8, fontSize: 11, color: '#a78bfa', fontWeight: 600 }}>
                      Day {di + 1}: {Math.round(val)}
                    </div>
                  ))}
                  {selectedAction.forecasted_demand.length > 10 && (
                    <div style={{ padding: '5px 10px', background: 'rgba(255,255,255,0.04)', borderRadius: 8, fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
                      +{selectedAction.forecasted_demand.length - 10} more…
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Action button */}
            <div style={{ padding: '14px 16px', borderRadius: 12, background: selectedAction.urgency === 'CRITICAL' ? 'rgba(244,63,94,0.08)' : 'rgba(34,211,168,0.06)', border: `1px solid ${selectedAction.urgency === 'CRITICAL' ? 'rgba(244,63,94,0.25)' : 'rgba(34,211,168,0.2)'}` }}>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 10 }}>
                {selectedAction.urgency === 'CRITICAL' ? '⚠️ Immediate action required — stock critically low or depleted.' : 'Approving will create a vendor purchase order and update the Restock queue.'}
              </div>

              {approveMsg && (
                <div style={{ marginBottom: 10, padding: '9px 13px', borderRadius: 9, fontSize: 12, fontWeight: 600,
                  background: approveMsg.type === 'error' ? 'rgba(244,63,94,0.12)' : 'rgba(34,211,168,0.12)',
                  border: `1px solid ${approveMsg.type === 'error' ? 'rgba(244,63,94,0.35)' : 'rgba(34,211,168,0.35)'}`,
                  color: approveMsg.type === 'error' ? '#f43f5e' : '#22d3a8' }}>
                  {approveMsg.text}
                </div>
              )}

              <button
                disabled={approving}
                onClick={async () => {
                  setApproving(true)
                  setApproveMsg(null)

                  // Order-up-to quantity, matching the Fix All path, so
                  // approving one item actually clears its alert too.
                  const reorderQty = selectedAction.recommended_qty > 0
                    ? selectedAction.recommended_qty
                    : Math.max(selectedAction.total_forecasted_demand || 0, Math.round((selectedAction.reorder_level_live || 0) * 1.5))

                  const norm = (s: string) => (s || '').trim().toUpperCase()

                  // 1. Find active vendor for this product family
                  const { data: vdata } = await supabase
                    .from('vendors')
                    .select('*')
                    .eq('status', 'Active')

                  const matching = (vdata || []).filter((v: any) => norm(v.category) === norm(selectedAction.family || ''))
                  if (matching.length === 0) {
                    setApproveMsg({ type: 'error', text: `No active vendor found for "${selectedAction.family}". Add one in Restock → Vendor Directory first.` })
                    setApproving(false)
                    return
                  }

                  // Pick vendor with lowest lead time
                  const vendor = [...matching].sort((a: any, b: any) => a.lead_time_days - b.lead_time_days)[0]

                  // 2. Fetch unit cost from products table
                  const { data: prod } = await supabase
                    .from('products')
                    .select('unit_price, id')
                    .ilike('name', selectedAction.product_name)
                    .limit(1)
                    .single()
                  const unitCost = prod ? parseFloat(prod.unit_price || '0') * 0.6 : 0
                  const total    = Math.round(reorderQty * unitCost)

                  const delivDate = new Date()
                  delivDate.setDate(delivDate.getDate() + (vendor.lead_time_days || 7))
                  const delivStr = delivDate.toISOString().split('T')[0]
                  const now      = new Date().toISOString()

                  // 3. Create proper restock_orders record
                  await supabase.from('restock_orders').insert({
                    vendor_id:         vendor.id,
                    vendor_name:       vendor.company,
                    vendor_email:      vendor.email,
                    items:             [{ product_name: selectedAction.product_name, sku: '', quantity: reorderQty, unit_cost: unitCost }],
                    total_cost:        total,
                    status:            'Pending',
                    notes:             `AI emergency restock — ${selectedAction.urgency} urgency`,
                    expected_delivery: delivStr,
                    ordered_at:        now,
                  })

                  // Note: no financial_transactions write — Payment page reads procurement
                  // totals directly from restock_orders.total_cost to avoid double-counting.

                  // 5. Update inventory so item leaves the restock queue
                  const invId = selectedAction.inventory_id
                  if (invId) {
                    await supabase.from('inventory')
                      .update({ current_stock: (selectedAction.current_stock_live || 0) + reorderQty, last_updated: now })
                      .eq('id', invId)
                  } else if (prod?.id) {
                    await supabase.from('inventory')
                      .update({ current_stock: (selectedAction.current_stock_live || 0) + reorderQty, last_updated: now })
                      .eq('product_id', prod.id)
                  }

                  setApproveMsg({ type: 'success', text: `✓ Order placed with ${vendor.company} for ${reorderQty} units. Navigating to Restock…` })
                  setApproving(false)
                  setTimeout(() => {
                    setSelectedAction(null)
                    setApproveMsg(null)
                    navigate('/owner/restock')
                  }, 1800)
                }}
                style={{ padding: '10px 20px', borderRadius: 10, opacity: approving ? 0.6 : 1,
                  background: selectedAction.urgency === 'CRITICAL' ? 'rgba(244,63,94,0.25)' : 'rgba(34,211,168,0.15)',
                  border: `1px solid ${selectedAction.urgency === 'CRITICAL' ? 'rgba(244,63,94,0.5)' : 'rgba(34,211,168,0.4)'}`,
                  color: selectedAction.urgency === 'CRITICAL' ? '#f43f5e' : '#22d3a8',
                  fontWeight: 700, cursor: approving ? 'wait' : 'pointer', fontSize: 13, transition: 'box-shadow 0.2s' }}
                onMouseEnter={e => { if (!approving) (e.currentTarget as HTMLElement).style.boxShadow = selectedAction.urgency === 'CRITICAL' ? '0 0 0 1px rgba(244,63,94,0.6), 0 0 18px rgba(244,63,94,0.3)' : '0 0 0 1px rgba(34,211,168,0.6), 0 0 18px rgba(34,211,168,0.3)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '' }}
              >
                {approving ? '⏳ Processing…' : selectedAction.urgency === 'CRITICAL' ? '🚨 Approve Emergency Restock' : '✓ Approve & Send to Restock'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── STAT CARD MODALS ── */}
      {statCardModal && createPortal(
        <div
          onClick={() => setStatCardModal(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(5,8,16,0.55)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ width: 580, maxHeight: '80vh', overflowY: 'auto', background: 'rgba(8,10,22,0.82)', backdropFilter: 'blur(32px)', WebkitBackdropFilter: 'blur(32px)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 20, boxShadow: '0 24px 80px rgba(0,0,0,0.5)', padding: 28, display: 'flex', flexDirection: 'column', gap: 18 }}
          >
            {/* Close button */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 800, fontSize: 17, color: '#fff' }}>
                {statCardModal === 'revenue' && 'Forecasted Revenue Breakdown'}
                {statCardModal === 'accuracy' && 'XGBoost Model Details'}
                {statCardModal === 'sentiment' && 'Market Sentiment by Product'}
                {statCardModal === 'executions' && 'Pipeline Execution Summary'}
                {statCardModal === 'xgboost' && 'XGBoost Demand Forecast'}
                {statCardModal === 'llm' && 'LLM Market Sentiment Engine'}
                {statCardModal === 'ppo' && 'PPO Reinforcement Learning Agent'}
              </div>
              <button
                onClick={() => setStatCardModal(null)}
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 9, cursor: 'pointer', color: 'rgba(255,255,255,0.5)', padding: 6, transition: 'box-shadow 0.2s ease, color 0.2s ease' }}
                onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 0 0 1px rgba(244,63,94,0.5), 0 0 14px rgba(244,63,94,0.35)'; e.currentTarget.style.color = '#f43f5e' }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = ''; e.currentTarget.style.color = 'rgba(255,255,255,0.5)' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* ── REVENUE MODAL ── */}
            {statCardModal === 'revenue' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>
                  Total: <strong style={{ color: '#6C63FF', fontSize: 15 }}>${(dashStats.forecastedRevenue / 1000).toFixed(1)}K</strong> across {productForecasts.length} products
                </div>
                {productForecasts.length === 0 ? (
                  <div style={{ color: 'var(--clr-text-muted)', fontSize: 13, textAlign: 'center', padding: 24 }}>Run the pipeline on products to see revenue breakdown.</div>
                ) : [...productForecasts].sort((a, b) => b.forecasted_revenue - a.forecasted_revenue).map((f: any) => (
                  <div key={f.product_id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', transition: 'box-shadow 0.2s ease, transform 0.15s ease', cursor: 'default' }}
                    onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 0 0 1px rgba(108,99,255,0.5), 0 0 18px rgba(108,99,255,0.35)'; e.currentTarget.style.transform = 'translateX(2px)' }}
                    onMouseLeave={e => { e.currentTarget.style.boxShadow = ''; e.currentTarget.style.transform = '' }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: '#fff' }}>{f.product_name}</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{f.family} · {f.forecast_period} · {f.total_forecasted_demand} units</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 700, fontSize: 15, color: '#6C63FF' }}>${(f.forecasted_revenue / 1000).toFixed(1)}K</div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>${f.unit_price}/unit</div>
                    </div>
                    <div style={{ width: 80 }}>
                      <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)' }}>
                        <div style={{ height: '100%', borderRadius: 2, background: '#6C63FF', width: `${Math.min(100, (f.forecasted_revenue / dashStats.forecastedRevenue) * 100)}%` }} />
                      </div>
                      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginTop: 3, textAlign: 'right' }}>
                        {((f.forecasted_revenue / dashStats.forecastedRevenue) * 100).toFixed(1)}%
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── ACCURACY MODAL ── */}
            {statCardModal === 'accuracy' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {[
                    {
                      label: 'Total-Demand Accuracy',
                      value: accuracy ? `${accuracy.totalAccuracyPct.toFixed(1)}%` : '—',
                      color: '#22d3a8',
                      sub: accuracy ? `${accuracy.holdoutLabel} holdout, never seen by the fit` : 'Backtest not available',
                    },
                    {
                      label: 'Per-Family Median',
                      value: accuracy ? `${accuracy.medianFamilyAccuracyPct.toFixed(0)}%` : '—',
                      color: accuracy && accuracy.medianFamilyAccuracyPct >= 60 ? '#6C63FF' : '#f43f5e',
                      sub: 'Category mix is far weaker than the total',
                    },
                    {
                      label: 'Scale Factor',
                      value: accuracy ? `x${accuracy.scaleFactor.toFixed(3)}` : '—',
                      color: '#00D4FF',
                      sub: accuracy ? `Fitted on ${accuracy.calibrationLabel} only` : 'Corrects training-set scale',
                    },
                    {
                      label: 'Raw MAPE',
                      value: accuracy ? `${accuracy.rawMape.toFixed(0)}%` : '—',
                      color: '#f59e0b',
                      sub: 'Uncalibrated error, before scaling',
                    },
                  ].map(m => (
                    <div key={m.label} style={{ padding: 14, borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', transition: 'box-shadow 0.2s ease, transform 0.15s ease', cursor: 'default' }}
                      onMouseEnter={e => { e.currentTarget.style.boxShadow = `0 0 0 1px ${m.color}66, 0 0 18px ${m.color}44`; e.currentTarget.style.transform = 'translateY(-2px)' }}
                      onMouseLeave={e => { e.currentTarget.style.boxShadow = ''; e.currentTarget.style.transform = '' }}
                    >
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: 6 }}>{m.label}</div>
                      <div style={{ fontSize: 24, fontWeight: 800, color: m.color }}>{m.value}</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>{m.sub}</div>
                    </div>
                  ))}
                </div>
                <div style={{ padding: 14, borderRadius: 10, background: 'rgba(108,99,255,0.06)', border: '1px solid rgba(108,99,255,0.2)' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#a78bfa', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>12 Model Features</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {['store_nbr','product_family','onpromotion','city','state','store_type','cluster','oil_price (WTI)','day_of_week','month','year','is_weekend'].map(f => (
                      <span key={f} style={{ padding: '3px 10px', borderRadius: 20, background: 'rgba(108,99,255,0.15)', fontSize: 11, color: '#a78bfa', border: '1px solid rgba(108,99,255,0.25)', transition: 'box-shadow 0.2s ease', cursor: 'default' }}
                        onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 0 10px rgba(108,99,255,0.6)' }}
                        onMouseLeave={e => { e.currentTarget.style.boxShadow = '' }}
                      >{f}</span>
                    ))}
                  </div>
                </div>
                <div style={{ padding: 14, borderRadius: 10, background: 'rgba(34,211,168,0.05)', border: '1px solid rgba(34,211,168,0.15)', fontSize: 12, color: 'rgba(255,255,255,0.55)', lineHeight: 1.7, transition: 'box-shadow 0.2s ease' }}
                  onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 0 0 1px rgba(34,211,168,0.4), 0 0 16px rgba(34,211,168,0.25)' }}
                  onMouseLeave={e => { e.currentTarget.style.boxShadow = '' }}
                >
                  Trained on the Corporación Favorita grocery sales dataset (54 stores across Ecuador). The model predicts daily unit demand per product family using gradient-boosted trees. Live WTI oil price is injected at inference time as a real-world economic signal.
                </div>

                {accuracy && (
                  <div style={{ padding: 14, borderRadius: 10, background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.22)', fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.7 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
                      How this was measured
                    </div>
                    The model ran over <strong style={{ color: '#fff' }}>{accuracy.holdoutLabel}</strong>, a month it was
                    never given the outcome for. Because it was trained on a 54-store national dataset, its raw output is
                    on a different scale entirely — <strong style={{ color: '#fff' }}>{Math.round(accuracy.rawPredictedTotal).toLocaleString()}</strong> units
                    against <strong style={{ color: '#fff' }}>{Math.round(accuracy.actualTotal).toLocaleString()}</strong> actually
                    sold. One scale factor fitted on <strong style={{ color: '#fff' }}>{accuracy.calibrationLabel}</strong> alone
                    brings that to <strong style={{ color: '#22d3a8' }}>{Math.round(accuracy.calibratedTotal).toLocaleString()}</strong> units.
                    <div style={{ marginTop: 8 }}>
                      So the model tracks <em>total</em> demand well once scaled, but splits it across categories poorly —
                      the per-family median is only {accuracy.medianFamilyAccuracyPct.toFixed(0)}%. Trust it for revenue
                      totals, not for deciding which category to stock.
                    </div>
                  </div>
                )}

                {accuracy && accuracy.perFamily.length > 0 && (
                  <div style={{ padding: 14, borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.5)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
                      Per-family error · {accuracy.holdoutLabel}
                    </div>
                    <div style={{ maxHeight: 230, overflowY: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                            {['Family', 'Actual', 'Predicted', 'Error'].map(h => (
                              <th key={h} style={{ textAlign: h === 'Family' ? 'left' : 'right', padding: '6px 4px', color: 'rgba(255,255,255,0.35)', fontWeight: 600, fontSize: 10 }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {accuracy.perFamily.map(r => (
                            <tr key={r.family} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                              <td style={{ padding: '6px 4px', color: 'rgba(255,255,255,0.75)' }}>{r.family}</td>
                              <td style={{ padding: '6px 4px', textAlign: 'right', color: 'rgba(255,255,255,0.55)' }}>{Math.round(r.actual).toLocaleString()}</td>
                              <td style={{ padding: '6px 4px', textAlign: 'right', color: 'rgba(255,255,255,0.55)' }}>{Math.round(r.calibrated).toLocaleString()}</td>
                              <td style={{ padding: '6px 4px', textAlign: 'right', fontWeight: 700, color: r.apePct <= 25 ? '#22d3a8' : r.apePct <= 60 ? '#f59e0b' : '#f43f5e' }}>
                                {r.apePct.toFixed(0)}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── SENTIMENT MODAL ── */}
            {statCardModal === 'sentiment' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

                {/* ── Live reading, decomposed ───────────────────────────── */}
                {marketErr && (
                  <div style={{ padding: 14, borderRadius: 10, background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.3)', color: '#f43f5e', fontSize: 12.5 }}>
                    {marketErr}
                    <button onClick={() => fetchMarketInsight()} style={{ marginLeft: 10, padding: '3px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: 'pointer', color: '#6C63FF', background: 'rgba(108,99,255,0.14)', border: '1px solid rgba(108,99,255,0.4)' }}>Retry</button>
                  </div>
                )}

                {market && (() => {
                  const tone = market.multiplier > 1.02 ? '#22d3a8' : market.multiplier < 0.98 ? '#f43f5e' : '#00D4FF'
                  return (
                    <div style={{ padding: 18, borderRadius: 14, background: `${tone}0d`, border: `1px solid ${tone}38` }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
                        <span style={{ fontSize: 34, fontWeight: 800, color: tone, lineHeight: 1 }}>
                          x{market.multiplier.toFixed(3)}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: tone }}>{market.direction}</span>
                        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginLeft: 'auto' }}>
                          live · {fmtDateTime(market.generated_at)}
                        </span>
                      </div>

                      {/* Baseline + each contribution, so the total is checkable. */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'rgba(255,255,255,0.4)' }}>
                          <span>Baseline</span><span>1.000</span>
                        </div>
                        {market.components.map(c => {
                          const ctone = c.contribution > 0.001 ? '#22d3a8' : c.contribution < -0.001 ? '#f43f5e' : 'rgba(255,255,255,0.35)'
                          return (
                            <div key={c.label} style={{ padding: '9px 12px', borderRadius: 9, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                                <span style={{ fontSize: 12.5, fontWeight: 600, color: '#fff' }}>{c.label}</span>
                                <span style={{ fontSize: 13, fontWeight: 800, color: ctone, fontVariantNumeric: 'tabular-nums' }}>
                                  {c.contribution >= 0 ? '+' : ''}{c.contribution.toFixed(4)}
                                </span>
                              </div>
                              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', lineHeight: 1.55 }}>{c.detail}</div>
                            </div>
                          )
                        })}
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, fontWeight: 700, color: '#fff', paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                          <span>Net adjustment</span>
                          <span style={{ color: tone, fontVariantNumeric: 'tabular-nums' }}>
                            {market.total_adjustment >= 0 ? '+' : ''}{market.total_adjustment.toFixed(4)} → x{market.multiplier.toFixed(3)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })()}

                {/* ── Oil, with the context that makes the level readable ── */}
                {market && (
                  <div style={{ padding: 14, borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                      Crude oil (WTI) · {market.oil.source}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10 }}>
                      {[
                        { k: 'Now', v: `$${market.oil.price.toFixed(2)}`, c: '#fff' },
                        { k: '90-day avg', v: `$${market.oil.avg_90d.toFixed(2)}`, c: 'rgba(255,255,255,0.65)' },
                        { k: 'vs average', v: `${market.oil.pct_vs_avg >= 0 ? '+' : ''}${market.oil.pct_vs_avg.toFixed(1)}%`, c: market.oil.pct_vs_avg > 0 ? '#f43f5e' : '#22d3a8' },
                        { k: '30-day move', v: `${market.oil.pct_30d >= 0 ? '+' : ''}${market.oil.pct_30d.toFixed(1)}%`, c: market.oil.pct_30d > 0 ? '#f43f5e' : '#22d3a8' },
                        { k: '6-month range', v: `$${market.oil.low_6mo.toFixed(0)}–$${market.oil.high_6mo.toFixed(0)}`, c: 'rgba(255,255,255,0.65)' },
                      ].map(s => (
                        <div key={s.k}>
                          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.38)', marginBottom: 3 }}>{s.k}</div>
                          <div style={{ fontSize: 15, fontWeight: 800, color: s.c, fontVariantNumeric: 'tabular-nums' }}>{s.v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Holidays actually relevant to this business ─────────── */}
                {market && market.holidays.length > 0 && (
                  <div style={{ padding: 14, borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                      Upcoming holidays · next 60 days
                    </div>
                    {market.holidays.slice(0, 5).map((h, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '6px 0', borderTop: i ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                        <div>
                          <div style={{ fontSize: 12.5, color: '#fff', fontWeight: 600 }}>{h.name}</div>
                          <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.35)' }}>
                            {h.date} · {h.country}{h.scope ? ` · ${h.scope}` : ''}
                          </div>
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 700, color: h.days_until <= 14 ? '#22d3a8' : 'rgba(255,255,255,0.55)', whiteSpace: 'nowrap' }}>
                          in {h.days_until}d
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* ── The actual articles the news score came from ────────── */}
                {market && (
                  <div style={{ padding: 14, borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                      Headlines scored · {market.news_engine === 'gpt-4o-mini' ? 'GPT-4o-mini' : market.news_engine}
                    </div>
                    {market.headlines.length === 0 ? (
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
                        No headlines retrieved ({market.news_status}). Oil and holidays still scored.
                      </div>
                    ) : market.headlines.map((h, i) => (
                      <a
                        key={i} href={h.url} target="_blank" rel="noopener noreferrer"
                        style={{ display: 'block', padding: '7px 0', textDecoration: 'none', borderTop: i ? '1px solid rgba(255,255,255,0.05)' : 'none' }}
                      >
                        <div style={{ fontSize: 12, color: '#fff', lineHeight: 1.45 }}>{h.title}</div>
                        <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
                          {h.source}{h.published_at ? ` · ${fmtDateTime(h.published_at)}` : ''}
                        </div>
                      </a>
                    ))}
                  </div>
                )}

                {/* ── Stored history, labelled for what it is ─────────────── */}
                <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginTop: 6 }}>
                  Recorded in past pipeline runs
                </div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: -4, marginBottom: 2, lineHeight: 1.5 }}>
                  The average below is over stored runs, not over time — a batch of 60 products in
                  one afternoon counts 60 times. It describes what the model said, not the market.
                </div>
                <div style={{ display: 'flex', gap: 12, marginBottom: 4 }}>
                  {[
                    { label: 'Avg of runs', value: `x${dashStats.avgSentiment.toFixed(3)}`, color: dashStats.avgSentiment > 1.02 ? '#22d3a8' : dashStats.avgSentiment < 0.98 ? '#f43f5e' : '#00D4FF' },
                    { label: 'Positive', value: productForecasts.filter((f:any) => parseFloat(f.sentiment_multiplier) > 1.02).length, color: '#22d3a8' },
                    { label: 'Neutral', value: productForecasts.filter((f:any) => parseFloat(f.sentiment_multiplier) >= 0.98 && parseFloat(f.sentiment_multiplier) <= 1.02).length, color: '#fff' },
                    { label: 'Negative', value: productForecasts.filter((f:any) => parseFloat(f.sentiment_multiplier) < 0.98).length, color: '#f43f5e' },
                  ].map(s => (
                    <div key={s.label} style={{ flex: 1, padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', textAlign: 'center', transition: 'box-shadow 0.2s ease, transform 0.15s ease', cursor: 'default' }}
                      onMouseEnter={e => { e.currentTarget.style.boxShadow = `0 0 0 1px ${s.color}66, 0 0 16px ${s.color}44`; e.currentTarget.style.transform = 'translateY(-2px)' }}
                      onMouseLeave={e => { e.currentTarget.style.boxShadow = ''; e.currentTarget.style.transform = '' }}
                    >
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>{s.label}</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: s.color }}>{s.value}</div>
                    </div>
                  ))}
                </div>
                {productForecasts.length === 0 ? (
                  <div style={{ color: 'var(--clr-text-muted)', fontSize: 13, textAlign: 'center', padding: 24 }}>Run the pipeline on products to see sentiment breakdown.</div>
                ) : [...productForecasts].sort((a: any, b: any) => parseFloat(b.sentiment_multiplier) - parseFloat(a.sentiment_multiplier)).map((f: any) => {
                  const mult = parseFloat(f.sentiment_multiplier)
                  const color = mult > 1.02 ? '#22d3a8' : mult < 0.98 ? '#f43f5e' : '#fff'
                  return (
                    <div key={f.product_id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', transition: 'box-shadow 0.2s ease, transform 0.15s ease', cursor: 'default' }}
                      onMouseEnter={e => { e.currentTarget.style.boxShadow = `0 0 0 1px ${color}66, 0 0 18px ${color}44`; e.currentTarget.style.transform = 'translateX(2px)' }}
                      onMouseLeave={e => { e.currentTarget.style.boxShadow = ''; e.currentTarget.style.transform = '' }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: '#fff' }}>{f.product_name}</div>
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{f.family}</div>
                      </div>
                      <div style={{ fontWeight: 800, fontSize: 16, color, minWidth: 70, textAlign: 'right' }}>
                        x{mult.toFixed(3)} {mult > 1.02 ? '↑' : mult < 0.98 ? '↓' : '─'}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* ── EXECUTIONS MODAL ── */}
            {statCardModal === 'executions' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                  {[
                    { label: 'Total Runs', value: dashStats.totalForecasts, color: '#FF6B9D' },
                    { label: 'Products Run', value: productForecasts.length, color: '#6C63FF' },
                    { label: 'Need Restock', value: dashStats.productsNeedingRestock, color: '#f43f5e' },
                  ].map(s => (
                    <div key={s.label} style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', textAlign: 'center', transition: 'box-shadow 0.2s ease, transform 0.15s ease', cursor: 'default' }}
                      onMouseEnter={e => { e.currentTarget.style.boxShadow = `0 0 0 1px ${s.color}66, 0 0 18px ${s.color}44`; e.currentTarget.style.transform = 'translateY(-2px)' }}
                      onMouseLeave={e => { e.currentTarget.style.boxShadow = ''; e.currentTarget.style.transform = '' }}
                    >
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>{s.label}</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginTop: 4 }}>Recent Runs</div>
                {historyForecasts.length === 0 ? (
                  <div style={{ color: 'var(--clr-text-muted)', fontSize: 13, textAlign: 'center', padding: 24 }}>No pipeline runs yet.</div>
                ) : historyForecasts.slice(0, 15).map((f: any, i: number) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', transition: 'box-shadow 0.2s ease, transform 0.15s ease', cursor: 'default' }}
                    onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 0 0 1px rgba(255,107,157,0.5), 0 0 18px rgba(255,107,157,0.35)'; e.currentTarget.style.transform = 'translateX(2px)' }}
                    onMouseLeave={e => { e.currentTarget.style.boxShadow = ''; e.currentTarget.style.transform = '' }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: '#fff' }}>{f.product_name}</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>{fmtDateTime(f.predicted_at)}</div>
                    </div>
                    <span className="badge badge-accent" style={{ fontSize: 10 }}>{f.forecast_period}</span>
                    <span style={{ fontWeight: 700, fontSize: 13, color: parseFloat(f.sentiment_multiplier) > 1.02 ? '#22d3a8' : parseFloat(f.sentiment_multiplier) < 0.98 ? '#f43f5e' : '#fff' }}>
                      x{parseFloat(f.sentiment_multiplier).toFixed(3)}
                    </span>
                    <span style={{ fontWeight: 700, fontSize: 13, color: f.optimal_reorder_qty > 0 ? '#22d3a8' : 'rgba(255,255,255,0.3)' }}>
                      {f.optimal_reorder_qty > 0 ? `+${f.optimal_reorder_qty}` : 'Hold'}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {/* ── XGBOOST MODEL CARD MODAL ── */}
            {statCardModal === 'xgboost' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {[
                    { label: 'Live Forecasts', value: String(productForecasts.length), color: '#6C63FF', sub: 'Products with a current prediction' },
                    { label: 'Training Stores', value: '54', color: '#a78bfa', sub: 'Corporación Favorita, Ecuador' },
                    { label: 'Training Rows', value: '3M+', color: '#00D4FF', sub: 'Daily sales transactions' },
                    { label: 'Features', value: '12', color: '#f59e0b', sub: 'Per-prediction input features' },
                  ].map(m => (
                    <div key={m.label} style={{ padding: 14, borderRadius: 10, background: 'rgba(108,99,255,0.07)', border: '1px solid rgba(108,99,255,0.2)' }}>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: 6 }}>{m.label}</div>
                      <div style={{ fontSize: 26, fontWeight: 800, color: m.color }}>{m.value}</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>{m.sub}</div>
                    </div>
                  ))}
                </div>
                <div style={{ padding: 14, borderRadius: 10, background: 'rgba(108,99,255,0.06)', border: '1px solid rgba(108,99,255,0.2)' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#a78bfa', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>12 Input Features</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {['store_nbr','product_family','onpromotion','city','state','store_type','cluster','oil_price (WTI)','day_of_week','month','year','is_weekend'].map(f => (
                      <span key={f} style={{ padding: '3px 10px', borderRadius: 20, background: 'rgba(108,99,255,0.15)', fontSize: 11, color: '#a78bfa', border: '1px solid rgba(108,99,255,0.25)' }}>{f}</span>
                    ))}
                  </div>
                </div>
                <div style={{ padding: 14, borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', fontSize: 12, color: 'rgba(255,255,255,0.55)', lineHeight: 1.75 }}>
                  Trained on the Corporación Favorita grocery sales dataset from 54 stores across Ecuador. Uses gradient-boosted decision trees to predict daily unit demand per product family. Live WTI crude oil price is injected at inference time to capture real-world cost pressures on consumer demand.
                </div>
                <div style={{ padding: 14, borderRadius: 10, background: 'rgba(108,99,255,0.06)', border: '1px solid rgba(108,99,255,0.2)' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#a78bfa', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Forecast coverage</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.08)' }}>
                      <div style={{ height: '100%', borderRadius: 4, width: `${products.length > 0 ? Math.round((productForecasts.length / products.length) * 100) : 0}%`, background: 'linear-gradient(90deg,#6C63FF,#a78bfa)' }} />
                    </div>
                    <span style={{ fontWeight: 800, color: '#a78bfa', fontSize: 16 }}>
                      {products.length > 0 ? Math.round((productForecasts.length / products.length) * 100) : 0}%
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* ── LLM MODEL CARD MODAL ── */}
            {statCardModal === 'llm' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', gap: 12, marginBottom: 4 }}>
                  {[
                    { label: 'Average', value: `x${dashStats.avgSentiment.toFixed(3)}`, color: dashStats.avgSentiment > 1.02 ? '#22d3a8' : dashStats.avgSentiment < 0.98 ? '#f43f5e' : '#00D4FF' },
                    { label: 'Positive', value: productForecasts.filter((f: any) => parseFloat(f.sentiment_multiplier) > 1.02).length, color: '#22d3a8' },
                    { label: 'Neutral', value: productForecasts.filter((f: any) => parseFloat(f.sentiment_multiplier) >= 0.98 && parseFloat(f.sentiment_multiplier) <= 1.02).length, color: '#fff' },
                    { label: 'Negative', value: productForecasts.filter((f: any) => parseFloat(f.sentiment_multiplier) < 0.98).length, color: '#f43f5e' },
                  ].map(s => (
                    <div key={s.label} style={{ flex: 1, padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>{s.label}</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: s.color }}>{s.value}</div>
                    </div>
                  ))}
                </div>
                {productForecasts.length === 0 ? (
                  <div style={{ color: 'var(--clr-text-muted)', fontSize: 13, textAlign: 'center', padding: 24 }}>Run the pipeline on products to see sentiment breakdown.</div>
                ) : [...productForecasts].sort((a: any, b: any) => parseFloat(b.sentiment_multiplier) - parseFloat(a.sentiment_multiplier)).map((f: any) => {
                  const mult = parseFloat(f.sentiment_multiplier)
                  const color = mult > 1.02 ? '#22d3a8' : mult < 0.98 ? '#f43f5e' : '#fff'
                  return (
                    <div key={f.product_id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: '#fff' }}>{f.product_name}</div>
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{f.family}</div>
                      </div>
                      <div style={{ fontWeight: 800, fontSize: 16, color, minWidth: 70, textAlign: 'right' }}>
                        x{mult.toFixed(3)} {mult > 1.02 ? '↑' : mult < 0.98 ? '↓' : '─'}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* ── PPO MODEL CARD MODAL ── */}
            {statCardModal === 'ppo' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                  {[
                    { label: 'Restock', value: dashStats.productsNeedingRestock, color: '#22d3a8' },
                    { label: 'Hold', value: Math.max(0, productForecasts.length - dashStats.productsNeedingRestock), color: 'rgba(255,255,255,0.5)' },
                    { label: 'Total Evaluated', value: productForecasts.length, color: '#fff' },
                  ].map(s => (
                    <div key={s.label} style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(34,211,168,0.05)', border: '1px solid rgba(34,211,168,0.15)', textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>{s.label}</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</div>
                    </div>
                  ))}
                </div>
                <div style={{ padding: 14, borderRadius: 10, background: 'rgba(34,211,168,0.05)', border: '1px solid rgba(34,211,168,0.15)' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#22d3a8', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Observation Vector (3 inputs)</div>
                  {[
                    { name: 'xgb_pred', desc: 'XGBoost mean daily demand forecast — normalised by 5000', color: '#a78bfa' },
                    { name: 'market_sentiment', desc: 'LLM multiplier — normalised: (value − 0.8) ÷ 0.7', color: '#00D4FF' },
                    { name: 'current_inventory', desc: 'Live stock level from Supabase — normalised by 5000', color: '#22d3a8' },
                  ].map(o => (
                    <div key={o.name} style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'flex-start' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.06)', fontSize: 11, fontFamily: 'monospace', color: o.color, flexShrink: 0 }}>{o.name}</span>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 }}>{o.desc}</div>
                    </div>
                  ))}
                </div>
                <div style={{ padding: 14, borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', fontSize: 12, color: 'rgba(255,255,255,0.55)', lineHeight: 1.75 }}>
                  Trained with Stable-Baselines3 PPO algorithm in a custom InventoryRL gymnasium environment. The agent learns an optimal (s, S) base-stock reorder policy by balancing holding costs against stockout penalties. Falls back to an analytical base-stock policy if the model file is unavailable.
                </div>
                {productForecasts.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1 }}>Current Decisions</div>
                    {productForecasts.map((f: any) => (
                      <div key={f.product_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                        <div style={{ flex: 1, fontSize: 12, color: '#fff', fontWeight: 600 }}>{f.product_name}</div>
                        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{f.current_stock_live} units</span>
                        <span style={{ fontWeight: 700, fontSize: 13, color: f.optimal_reorder_qty > 0 ? '#22d3a8' : 'rgba(255,255,255,0.3)', minWidth: 60, textAlign: 'right' }}>
                          {f.optimal_reorder_qty > 0 ? `+${f.optimal_reorder_qty}` : 'Hold'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>,
        document.body
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
