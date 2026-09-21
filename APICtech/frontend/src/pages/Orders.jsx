import { useState } from 'react'
import { PackageCheck, ShoppingBag, Truck, X } from 'lucide-react'

import MainLayout from '../layouts/MainLayout'
import { apiRequest } from '../lib/api'
import { formatDate, money, useApi } from '../lib/store'

const fieldClass = 'mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-[#F97360]'
const buttonClass = 'rounded-xl px-4 py-2.5 text-sm font-bold transition disabled:opacity-50'

const FILTERS = [
  ['ALL', 'All'],
  ['CONFIRM', 'Confirm payment'],
  ['SHIP', 'To ship'],
  ['SHIPPED', 'Shipped'],
  ['DELIVERED', 'Delivered'],
  ['CANCELLED', 'Cancelled'],
]

const matches = (order, filter) => ({
  ALL: true,
  CONFIRM: order.status === 'PLACED' && order.paymentStatus !== 'PAID',
  SHIP: order.status === 'PLACED' && order.paymentStatus === 'PAID',
  SHIPPED: order.status === 'SHIPPED',
  DELIVERED: order.status === 'DELIVERED',
  CANCELLED: order.status === 'CANCELLED',
}[filter])

const PAYMENT_LABEL = { PENDING: 'Not paid yet', CLAIMED: 'Buyer says paid', PAID: 'Payment received' }
const PAYMENT_TONE = { PENDING: 'bg-[#fdeeea] text-[#a1432f]', CLAIMED: 'bg-[#fff4d6] text-[#8a6100]', PAID: 'bg-[#dcf3ee] text-[#0c6b60]' }
const STATUS_LABEL = { PLACED: 'Waiting to ship', SHIPPED: 'Shipped', DELIVERED: 'Delivered', CANCELLED: 'Cancelled' }

// Orders placed on the public "Sellers nearby" page, and the jars the keeper has put on sale.
export default function Orders() {
  const [tab, setTab] = useState('orders')

  return (
    <MainLayout title="Orders">
      <div>
        <h1 className="text-2xl font-black">Orders</h1>
        <p className="mt-1 text-sm text-gray-500">Customers who order from the Sellers nearby page on the Honey Chain website, and the jars you sell there.</p>
      </div>

      <div className="mt-5 flex gap-2">
        <TabButton active={tab === 'orders'} onClick={() => setTab('orders')} icon={<ShoppingBag size={16} />}>Orders</TabButton>
        <TabButton active={tab === 'products'} onClick={() => setTab('products')} icon={<PackageCheck size={16} />}>Products for sale</TabButton>
      </div>

      {tab === 'orders' ? <OrderList /> : <Products />}
    </MainLayout>
  )
}

function TabButton({ active, onClick, icon, children }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold ${active ? 'border-[#0F766E] bg-[#0F766E] text-white' : 'border-[#c0dfdd] bg-white text-[#2b5b57]'}`}>
      {icon}{children}
    </button>
  )
}

// ---------------------------------------------------------------- orders
function OrderList() {
  const data = useApi('/company/shop/orders')
  const [filter, setFilter] = useState('ALL')
  const [message, setMessage] = useState('')
  const orders = data.data || []
  const shown = orders.filter((order) => matches(order, filter))

  async function act(order, action, body) {
    setMessage('')
    try {
      await apiRequest(`/company/shop/orders/${order.code}/${action}`, { method: 'PATCH', body: JSON.stringify(body || {}) })
      await data.reload()
    } catch (error) {
      setMessage(error.message)
    }
  }

  return (
    <div className="mt-5">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map(([id, label]) => (
          <button key={id} onClick={() => setFilter(id)} className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold ${filter === id ? 'border-[#F97360] bg-[#F97360] text-[#2a0c07]' : 'border-[#c0dfdd] bg-white text-[#2b5b57]'}`}>
            {label} <span className="opacity-70">{orders.filter((order) => matches(order, id)).length}</span>
          </button>
        ))}
      </div>

      {message && <p className="mt-4 rounded-xl bg-[#fdeeea] px-4 py-3 text-sm font-semibold text-[#a1432f]">{message}</p>}
      {data.error && <p className="mt-4 text-sm text-[#a1432f]">{data.error}</p>}

      {shown.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-[#c0dfdd] bg-white p-10 text-center text-sm text-gray-500">
          {orders.length === 0 ? 'No orders yet. Put your jars on sale in "Products for sale" and they appear on the Sellers nearby page.' : 'No orders in this list.'}
        </div>
      ) : (
        <div className="mt-5 grid gap-4">
          {shown.map((order) => <OrderCard key={order.code} order={order} act={act} />)}
        </div>
      )}
    </div>
  )
}

function OrderCard({ order, act }) {
  const [shipping, setShipping] = useState(false)
  const [courier, setCourier] = useState('')
  const [trackingRef, setTrackingRef] = useState('')

  return (
    <article className="rounded-2xl border border-[#c0dfdd] bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-sm font-bold text-[#0F766E]">{order.code}</p>
          <h3 className="mt-1 text-lg font-black">{order.quantity} x {order.product}</h3>
          <p className="text-sm text-gray-500">{money.format(order.unitPrice)} each &middot; {formatDate(order.createdAt)}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-black">{money.format(order.total)}</p>
          <div className="mt-1 flex flex-wrap justify-end gap-2">
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${PAYMENT_TONE[order.paymentStatus]}`}>{PAYMENT_LABEL[order.paymentStatus]}</span>
            <span className="rounded-full bg-[#eaf1f1] px-3 py-1 text-xs font-bold text-[#2b5b57]">{STATUS_LABEL[order.status]}</span>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-xl bg-[#f4fbfb] px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#5d7f80]">Deliver to</p>
          <p className="mt-1 font-bold">{order.buyer.name} &middot; {order.buyer.phone}</p>
          <p className="text-gray-600">{order.buyer.address}, {order.buyer.pincode}</p>
        </div>
        <div className="rounded-xl bg-[#f4fbfb] px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#5d7f80]">Payment and parcel</p>
          <p className="mt-1">{order.paymentRef ? <>UPI reference <b className="font-mono">{order.paymentRef}</b></> : 'No payment reference yet'}</p>
          <p className="text-gray-600">{order.courier ? `${order.courier}${order.trackingRef ? `, tracking ${order.trackingRef}` : ''}` : 'Not shipped yet'}</p>
          {order.cancelReason && <p className="text-[#a1432f]">{order.cancelReason}</p>}
        </div>
      </div>

      {order.status === 'PLACED' && (
        <div className="mt-4 flex flex-wrap gap-2">
          {order.paymentStatus !== 'PAID' && <button onClick={() => act(order, 'payment', { status: 'PAID' })} className={`${buttonClass} bg-[#0F766E] text-white`}>Payment received</button>}
          {order.paymentStatus === 'PAID' && <button onClick={() => setShipping(!shipping)} className={`${buttonClass} bg-[#F97360] text-[#2a0c07]`}><Truck size={15} className="mr-1.5 inline" />Mark as shipped</button>}
          {order.paymentStatus === 'PAID' && <button onClick={() => act(order, 'payment', { status: 'PENDING' })} className={`${buttonClass} border border-gray-200 bg-white text-gray-600`}>Undo payment</button>}
          <button onClick={() => { if (window.confirm(`Cancel order ${order.code}? The jars go back on sale.`)) act(order, 'cancel', { reason: 'Cancelled by the seller' }) }} className={`${buttonClass} border border-gray-200 bg-white text-[#a1432f]`}>Cancel order</button>
        </div>
      )}

      {order.status === 'PLACED' && shipping && (
        <div className="mt-3 grid gap-3 rounded-xl border border-[#c0dfdd] p-4 sm:grid-cols-[1fr_1fr_auto]">
          <label className="text-sm font-semibold">Courier or delivery person<input value={courier} onChange={(event) => setCourier(event.target.value)} placeholder="DTDC, India Post, own delivery" className={fieldClass} /></label>
          <label className="text-sm font-semibold">Tracking / consignment number<input value={trackingRef} onChange={(event) => setTrackingRef(event.target.value)} placeholder="optional" className={fieldClass} /></label>
          <div className="flex items-end gap-2">
            <button onClick={() => act(order, 'ship', { courier, trackingRef })} className={`${buttonClass} bg-[#0F766E] text-white`}>Save as shipped</button>
            <button onClick={() => setShipping(false)} className="rounded-xl p-2.5 text-gray-500" aria-label="Close"><X size={18} /></button>
          </div>
        </div>
      )}

      {order.status === 'SHIPPED' && (
        <div className="mt-4"><button onClick={() => act(order, 'deliver')} className={`${buttonClass} bg-[#0F766E] text-white`}>Mark as delivered</button></div>
      )}
    </article>
  )
}

// ---------------------------------------------------------------- products for sale
function Products() {
  const data = useApi('/company/shop/products')
  const [form, setForm] = useState({ packBatchCode: '', price: '', quantity: '' })
  const [message, setMessage] = useState('')
  const listings = data.data?.listings || []
  const available = data.data?.available || []
  const chosen = available.find((item) => item.packBatchCode === form.packBatchCode)

  async function send(path, method, body) {
    setMessage('')
    try {
      await apiRequest(path, { method, body: JSON.stringify(body) })
      await data.reload()
      return true
    } catch (error) {
      setMessage(error.message)
      return false
    }
  }

  async function add(event) {
    event.preventDefault()
    if (await send('/company/shop/products', 'POST', { packBatchCode: form.packBatchCode, price: Number(form.price), quantity: Number(form.quantity) })) {
      setForm({ packBatchCode: '', price: '', quantity: '' })
    }
  }

  return (
    <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_360px]">
      <div>
        {message && <p className="mb-4 rounded-xl bg-[#fdeeea] px-4 py-3 text-sm font-semibold text-[#a1432f]">{message}</p>}

        {listings.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#c0dfdd] bg-white p-10 text-center text-sm text-gray-500">Nothing is on sale yet. Choose a packaging run on the right, set a price and put it on sale.</div>
        ) : (
          <div className="grid gap-4">
            {listings.map((item) => <ListingCard key={item.id} item={item} save={(body) => send(`/company/shop/products/${item.id}`, 'PUT', body)} />)}
          </div>
        )}
      </div>

      <form onSubmit={add} className="h-fit rounded-2xl border border-[#c0dfdd] bg-white p-5">
        <h2 className="text-lg font-black">Put jars on sale</h2>
        <p className="mt-1 text-sm text-gray-500">Only jars from a lab-verified batch can be sold. Buyers see the batch, the lab result and your price.</p>

        {available.length === 0 ? (
          <p className="mt-4 rounded-xl bg-[#f4fbfb] px-4 py-3 text-sm text-gray-600">No packaging run is waiting. Verify a lab result and create QR jars first (Laboratory, then QR Management).</p>
        ) : (
          <>
            <label className="mt-4 block text-sm font-semibold">Packaging run
              <select value={form.packBatchCode} onChange={(event) => setForm({ ...form, packBatchCode: event.target.value, quantity: '' })} className={fieldClass} required>
                <option value="">Choose</option>
                {available.map((item) => <option key={item.packBatchCode} value={item.packBatchCode}>{item.productName} {item.jarSizeGrams} g &middot; {item.jars} jars &middot; {item.batchCode}</option>)}
              </select>
            </label>
            <label className="mt-3 block text-sm font-semibold">Price of one jar (rupees)
              <input type="number" min="1" step="1" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} className={fieldClass} required />
            </label>
            <label className="mt-3 block text-sm font-semibold">Jars to put on sale{chosen ? ` (up to ${chosen.jars})` : ''}
              <input type="number" min="1" max={chosen?.jars || undefined} step="1" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} className={fieldClass} required />
            </label>
            <button className={`${buttonClass} mt-4 w-full bg-[#F97360] text-[#2a0c07]`}>Put on sale</button>
          </>
        )}
      </form>
    </div>
  )
}

function ListingCard({ item, save }) {
  const [price, setPrice] = useState(String(item.price))
  const [stock, setStock] = useState(String(item.stock))
  const changed = Number(price) !== item.price || Number(stock) !== item.stock

  return (
    <article className="rounded-2xl border border-[#c0dfdd] bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-black">{item.title}</h3>
          <p className="text-sm text-gray-500">{item.honeyType} &middot; batch {item.batchCode} &middot; harvested {formatDate(item.harvestDate)}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${item.active && item.stock > 0 ? 'bg-[#dcf3ee] text-[#0c6b60]' : 'bg-[#eaf1f1] text-[#2b5b57]'}`}>{!item.active ? 'Hidden' : item.stock > 0 ? 'On sale' : 'Sold out'}</span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
        <label className="text-sm font-semibold">Price per jar
          <input type="number" min="1" value={price} onChange={(event) => setPrice(event.target.value)} className={fieldClass} />
        </label>
        <label className="text-sm font-semibold">Jars in stock
          <input type="number" min="0" value={stock} onChange={(event) => setStock(event.target.value)} className={fieldClass} />
        </label>
        <button disabled={!changed} onClick={() => save({ price: Number(price), stock: Number(stock) })} className={`${buttonClass} bg-[#0F766E] text-white`}>Save</button>
        <button onClick={() => save({ active: !item.active })} className={`${buttonClass} border border-gray-200 bg-white text-gray-700`}>{item.active ? 'Hide' : 'Show'}</button>
      </div>
    </article>
  )
}
