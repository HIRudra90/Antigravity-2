import emailjs from '@emailjs/browser'
import { supabase } from './supabaseClient'

const EJS_SERVICE  = import.meta.env.VITE_EMAILJS_SERVICE_ID  as string
const EJS_TEMPLATE = import.meta.env.VITE_EMAILJS_TEMPLATE_ID as string
const EJS_KEY      = import.meta.env.VITE_EMAILJS_PUBLIC_KEY  as string

/** Wholesale cost as a share of retail price. Matches the Restock page queue. */
export const COST_RATIO = 0.6

export interface EmailVendor {
  id: string
  name: string
  company: string
  email: string | null
  category: string
  payment_terms: string
  lead_time_days?: number
}

export interface OrderItem {
  product_name: string
  sku: string
  quantity: number
  unit_cost: number
}

/** SKU format shared with the Restock page so both refer to the same item. */
export const skuFor = (productId: number | string) => `SKU-${1000 + Number(productId || 0)}`

// ─── Email sending via EmailJS ────────────────────────────────────
export async function sendOrderEmail(
  vendor: EmailVendor, items: OrderItem[], notes: string, expectedDelivery: string
): Promise<void> {
  const orderNum = `ORD-${Date.now().toString().slice(-6)}`
  const orderDate = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  const total = items.reduce((s, i) => s + i.quantity * i.unit_cost, 0)

  console.log('[EmailJS] Sending to:', vendor.email, '| Service:', EJS_SERVICE, '| Template:', EJS_TEMPLATE)

  await emailjs.send(
    EJS_SERVICE,
    EJS_TEMPLATE,
    {
      email:             vendor.email ?? '',
      to_email:          vendor.email ?? '',
      to_name:           vendor.name,
      company_name:      vendor.company,
      order_id:          orderNum,
      order_date:        orderDate,
      category:          vendor.category,
      payment_terms:     vendor.payment_terms,
      expected_delivery: expectedDelivery
        ? new Date(expectedDelivery).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        : 'To be confirmed',
      notes:             notes || '',
      order_total:       total.toFixed(2),
      orders: items.map(item => ({
        name:       item.product_name,
        sku:        item.sku || 'N/A',
        units:      item.quantity,
        unit_price: Number(item.unit_cost).toFixed(2),
        price:      (item.quantity * item.unit_cost).toFixed(2),
      })),
    },
    EJS_KEY
  )
}

export interface PlaceOrderArgs {
  vendor: EmailVendor
  items: OrderItem[]
  notes?: string
  expectedDelivery?: string
  /** Inventory row to top up once the order is placed. */
  inventoryId?: number | string
  currentStock?: number
}

/**
 * Emails the vendor, then records the order and tops the inventory row up.
 *
 * The email goes first on purpose. It is the only step that cannot be undone,
 * so if it fails nothing has been written and the caller can simply retry. The
 * reverse order (the Restock page's) can leave an order row and inflated stock
 * behind for an email that never went out.
 */
export async function placeRestockOrder({
  vendor, items, notes = '', expectedDelivery = '', inventoryId, currentStock,
}: PlaceOrderArgs): Promise<void> {
  if (!items.length) throw new Error('Nothing to order.')
  if (!vendor.email?.trim()) {
    throw new Error(`${vendor.company} has no email address on file. Add one on the Restock page first.`)
  }

  await sendOrderEmail(vendor, items, notes, expectedDelivery)

  const total = items.reduce((s, i) => s + i.quantity * i.unit_cost, 0)
  const { error: orderError } = await supabase.from('restock_orders').insert({
    vendor_id: vendor.id,
    vendor_name: vendor.company,
    vendor_email: vendor.email,
    items,
    total_cost: total,
    status: 'Pending',
    notes: notes || null,
    expected_delivery: expectedDelivery || null,
  })
  if (orderError) {
    throw new Error(
      `The order email was sent to ${vendor.email}, but saving the order failed: ${orderError.message}`
    )
  }

  if (inventoryId !== undefined) {
    const ordered = items.reduce((s, i) => s + i.quantity, 0)
    const { error: invError } = await supabase.from('inventory')
      .update({ current_stock: (currentStock ?? 0) + ordered, last_updated: new Date().toISOString() })
      .eq('id', inventoryId)
    if (invError) {
      throw new Error(
        `Order placed and emailed, but the stock level could not be updated: ${invError.message}`
      )
    }
  }
}
