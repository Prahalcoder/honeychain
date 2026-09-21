import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'

import { API_URL, useLang } from './i18n'

// "Sellers nearby": pick a state, see the registered honey sellers, open one to see its products and stock,
// order without an account, pay by UPI (QR code), and follow the parcel.
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })

const TEXT = {
  en: {
    kicker: 'Sellers nearby', title: 'Buy honey from registered beekeepers', lead: 'Every seller here is registered and approved by KVIC. Choose your state to see who sells near you.',
    state: 'State', region: 'KVIC region', allRegions: 'All regions', choose: 'Choose a state', sellersIn: 'Sellers in', none: 'No seller has honey in stock here yet. Try another region or state.',
    products: 'products', from: 'from', jars: 'jars in stock', view: 'View products', back: 'All sellers', phone: 'Phone', address: 'Address', fssai: 'FSSAI licence',
    noProducts: 'This seller has nothing in stock right now.', labOk: 'Lab verified by KVIC', batch: 'Batch', harvested: 'Harvested', inStock: 'in stock', price: 'per jar', quantity: 'Jars', order: 'Place order',
    yourDetails: 'Your details', name: 'Your name', mobile: 'Mobile number', email: 'E-mail (optional)', deliveryAddress: 'Delivery address', pin: 'PIN code', total: 'Total', confirm: 'Confirm order', cancel: 'Cancel',
    track: 'Track an order', trackText: 'Enter the order code and the mobile number you ordered with.', orderCode: 'Order code', go: 'Track',
    loading: 'Loading...', failed: 'Something went wrong. Please try again.',
    orderTitle: 'Your order', status: { PLACED: 'Placed', SHIPPED: 'On the way', DELIVERED: 'Delivered', CANCELLED: 'Cancelled' },
    payTitle: 'Pay the seller', payText: 'Scan this QR code with any UPI app (Google Pay, PhonePe, Paytm) and pay the amount shown. Then enter the UPI reference number below.',
    payDemo: 'Demo QR: this seller has not added a UPI ID yet, so the code does not lead to a real account.', payTo: 'Pay to', amount: 'Amount', openUpi: 'Open in my UPI app',
    reference: 'UPI reference (UTR) number', paid: 'I have paid', waiting: 'Payment sent. The seller is checking it and will confirm shortly.', ref: 'Your reference',
    steps: 'Order progress', seller: 'Seller', deliveryTo: 'Delivering to', cancelOrder: 'Cancel this order', payBy: 'Please pay before', needPhone: 'Enter the mobile number you ordered with to see this order.', show: 'Show order',
    when: 'Placed on',
  },
  hi: {
    kicker: 'आपके पास के विक्रेता', title: 'पंजीकृत मधुमक्खी पालकों से शहद खरीदें', lead: 'यहाँ हर विक्रेता KVIC द्वारा पंजीकृत और स्वीकृत है। अपना राज्य चुनें।',
    state: 'राज्य', region: 'KVIC क्षेत्र', allRegions: 'सभी क्षेत्र', choose: 'राज्य चुनें', sellersIn: 'विक्रेता:', none: 'यहाँ अभी किसी विक्रेता के पास शहद उपलब्ध नहीं है। दूसरा क्षेत्र या राज्य चुनें।',
    products: 'उत्पाद', from: 'से शुरू', jars: 'जार उपलब्ध', view: 'उत्पाद देखें', back: 'सभी विक्रेता', phone: 'फ़ोन', address: 'पता', fssai: 'FSSAI लाइसेंस',
    noProducts: 'इस विक्रेता के पास अभी स्टॉक नहीं है।', labOk: 'KVIC लैब द्वारा सत्यापित', batch: 'बैच', harvested: 'निकाला गया', inStock: 'स्टॉक में', price: 'प्रति जार', quantity: 'जार', order: 'ऑर्डर करें',
    yourDetails: 'आपकी जानकारी', name: 'आपका नाम', mobile: 'मोबाइल नंबर', email: 'ईमेल (वैकल्पिक)', deliveryAddress: 'डिलीवरी का पता', pin: 'पिन कोड', total: 'कुल', confirm: 'ऑर्डर पक्का करें', cancel: 'रद्द करें',
    track: 'ऑर्डर ट्रैक करें', trackText: 'ऑर्डर कोड और वही मोबाइल नंबर डालें जिससे ऑर्डर किया था।', orderCode: 'ऑर्डर कोड', go: 'ट्रैक करें',
    loading: 'लोड हो रहा है...', failed: 'कुछ गड़बड़ हुई। कृपया फिर कोशिश करें।',
    orderTitle: 'आपका ऑर्डर', status: { PLACED: 'दर्ज', SHIPPED: 'रास्ते में', DELIVERED: 'पहुँच गया', CANCELLED: 'रद्द' },
    payTitle: 'विक्रेता को भुगतान करें', payText: 'किसी भी UPI ऐप (Google Pay, PhonePe, Paytm) से यह QR कोड स्कैन करके राशि दें। फिर नीचे UPI रेफरेंस नंबर डालें।',
    payDemo: 'डेमो QR: इस विक्रेता ने अभी UPI ID नहीं जोड़ी है, इसलिए यह कोड किसी असली खाते तक नहीं जाता।', payTo: 'भुगतान किसे', amount: 'राशि', openUpi: 'मेरे UPI ऐप में खोलें',
    reference: 'UPI रेफरेंस (UTR) नंबर', paid: 'मैंने भुगतान कर दिया', waiting: 'भुगतान भेजा गया। विक्रेता जाँच रहा है और जल्द पुष्टि करेगा।', ref: 'आपका रेफरेंस',
    steps: 'ऑर्डर की स्थिति', seller: 'विक्रेता', deliveryTo: 'डिलीवरी का पता', cancelOrder: 'यह ऑर्डर रद्द करें', payBy: 'भुगतान की अंतिम समय-सीमा', needPhone: 'ऑर्डर देखने के लिए वही मोबाइल नंबर डालें जिससे ऑर्डर किया था।', show: 'ऑर्डर दिखाएँ',
    when: 'ऑर्डर की तारीख',
  },
}

export const sellersLabel = (lang) => (TEXT[lang] || TEXT.en).kicker

function useText() {
  const { lang } = useLang()
  return { ...TEXT.en, ...(TEXT[lang] || {}), status: { ...TEXT.en.status, ...(TEXT[lang]?.status || {}) } }
}

async function api(path, options) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json' },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'Request failed')
  return data
}

const dateOf = (value) => {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// Orders this browser placed, so a buyer can come back without typing the phone number again.
const remember = (code, phone) => { try { const list = JSON.parse(localStorage.getItem('hc_orders') || '{}'); list[code] = phone; localStorage.setItem('hc_orders', JSON.stringify(list)) } catch { /* storage may be blocked */ } }
const remembered = (code) => { try { return JSON.parse(localStorage.getItem('hc_orders') || '{}')[code] || '' } catch { return '' } }

// ---------------------------------------------------------------- the list of sellers
export function SellersPage() {
  const seller = new URLSearchParams(window.location.search).get('seller')
  return seller ? <SellerPage code={seller} /> : <SellerList />
}

function SellerList() {
  const x = useText()
  const params = new URLSearchParams(window.location.search)
  const [states, setStates] = useState([])
  const [state, setState] = useState(params.get('state') || '')
  const [region, setRegion] = useState(params.get('region') || '')
  const [sellers, setSellers] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api('/shop/states').then((list) => {
      setStates(list)
      setState((current) => current || list.find((item) => item.sellers > 0)?.state || list[0]?.state || '')
    }).catch(() => setError(x.failed))
  }, [x.failed])

  useEffect(() => {
    if (!state) return
    setSellers(null)
    const query = new URLSearchParams({ state, ...(region ? { region } : {}) })
    window.history.replaceState(null, '', `/sellers?${query}`)
    api(`/shop/sellers?${query}`).then(setSellers).catch(() => setError(x.failed))
  }, [state, region, x.failed])

  const regions = states.find((item) => item.state === state)?.regions || []

  return (
    <section className="section light verify-page">
      <div className="wrap">
        <p className="kicker">{x.kicker}</p>
        <h2>{x.title}</h2>
        <p className="lead">{x.lead}</p>

        <div className="shop-filters">
          <label>{x.state}
            <select value={state} onChange={(event) => { setState(event.target.value); setRegion('') }}>
              {!state && <option value="">{x.choose}</option>}
              {states.map((item) => <option key={item.state} value={item.state}>{item.state} ({item.sellers})</option>)}
            </select>
          </label>
          <label>{x.region}
            <select value={region} onChange={(event) => setRegion(event.target.value)} disabled={!state}>
              <option value="">{x.allRegions}</option>
              {regions.map((item) => <option key={item.region} value={item.region}>{item.region} ({item.sellers})</option>)}
            </select>
          </label>
        </div>

        {error && <p className="shop-error">{error}</p>}
        {sellers === null && !error && <p className="shop-muted">{x.loading}</p>}
        {sellers && sellers.length === 0 && <p className="shop-empty">{x.none}</p>}

        <div className="shop-grid">
          {(sellers || []).map((item) => (
            <article className="shop-card" key={item.code}>
              <h3>{item.name}</h3>
              <p className="shop-muted">{[item.place, item.region, item.state].filter(Boolean).join(', ')}{item.pincode ? ` - ${item.pincode}` : ''}</p>
              <p className="shop-line"><b>{item.products}</b> {x.products} &middot; {x.from} <b>{inr.format(item.fromPrice)}</b> &middot; {item.jars} {x.jars}</p>
              <a className="btn-gold" href={`/sellers?seller=${encodeURIComponent(item.code)}`}>{x.view}</a>
            </article>
          ))}
        </div>

        <TrackBox />
      </div>
    </section>
  )
}

function TrackBox() {
  const x = useText()
  const [code, setCode] = useState('')
  const [phone, setPhone] = useState('')

  const submit = (event) => {
    event.preventDefault()
    remember(code.trim().toUpperCase(), phone.trim())
    window.location.href = `/order/${encodeURIComponent(code.trim().toUpperCase())}`
  }

  return (
    <form className="shop-track" onSubmit={submit}>
      <h3>{x.track}</h3>
      <p className="shop-muted">{x.trackText}</p>
      <div className="shop-row">
        <input value={code} onChange={(event) => setCode(event.target.value)} placeholder={`${x.orderCode} (ORD-2026-A1B2C3)`} required />
        <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder={x.mobile} inputMode="numeric" maxLength={10} required />
        <button className="btn-gold">{x.go}</button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------- one seller
function SellerPage({ code }) {
  const x = useText()
  const [seller, setSeller] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(() => api(`/shop/sellers/${encodeURIComponent(code)}`).then(setSeller).catch((failure) => setError(failure.message)), [code])
  useEffect(() => { load() }, [load])

  return (
    <section className="section light verify-page">
      <div className="wrap">
        <a className="shop-back" href={`/sellers?state=${encodeURIComponent(seller?.state || '')}&region=${encodeURIComponent(seller?.region || '')}`}>&larr; {x.back}</a>
        {error && <p className="shop-error">{error}</p>}
        {!seller && !error && <p className="shop-muted">{x.loading}</p>}

        {seller && (
          <>
            <h2>{seller.name}</h2>
            <div className="shop-facts">
              <div><span>{x.address}</span><b>{seller.address.text}</b></div>
              <div><span>{x.phone}</span><b>{seller.phone ? <a href={`tel:${seller.phone}`}>{seller.phone}</a> : '-'}</b></div>
              <div><span>{x.fssai}</span><b>{seller.fssai}</b></div>
            </div>

            {seller.products.length === 0 && <p className="shop-empty">{x.noProducts}</p>}
            <div className="shop-grid">
              {seller.products.map((product) => <ProductCard key={product.id} product={product} seller={seller} />)}
            </div>
          </>
        )}
      </div>
    </section>
  )
}

function ProductCard({ product, seller }) {
  const x = useText()
  const [open, setOpen] = useState(false)
  const [quantity, setQuantity] = useState(1)
  const [form, setForm] = useState({ buyerName: '', buyerPhone: '', buyerEmail: '', deliveryAddress: '', deliveryPincode: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (field) => (event) => setForm({ ...form, [field]: event.target.value })

  async function submit(event) {
    event.preventDefault()
    setError(''); setBusy(true)
    try {
      const result = await api('/shop/orders', { method: 'POST', body: { sellerCode: seller.code, listingId: product.id, quantity, ...form } })
      remember(result.code, form.buyerPhone.trim())
      window.location.href = `/order/${result.code}`
    } catch (failure) {
      setError(failure.message)
      setBusy(false)
    }
  }

  return (
    <article className="shop-card">
      <h3>{product.title}</h3>
      <p className="shop-muted">{product.honeyType} &middot; {x.batch} <a href={`/verify?batch=${encodeURIComponent(product.batchCode)}`}>{product.batchCode}</a> &middot; {x.harvested} {product.harvestDate}</p>
      {product.labVerified && <p className="shop-badge">&#10003; {x.labOk}</p>}
      <p className="shop-price">{inr.format(product.price)} <small>{x.price}</small></p>
      <p className="shop-line">{product.stock} {x.inStock}</p>

      {!open ? (
        <button className="btn-gold" onClick={() => setOpen(true)}>{x.order}</button>
      ) : (
        <form className="shop-form" onSubmit={submit}>
          <label>{x.quantity}
            <input type="number" min="1" max={product.stock} value={quantity} onChange={(event) => setQuantity(Math.max(1, Math.min(product.stock, Number(event.target.value) || 1)))} />
          </label>
          <h4>{x.yourDetails}</h4>
          <input value={form.buyerName} onChange={set('buyerName')} placeholder={x.name} required />
          <input value={form.buyerPhone} onChange={set('buyerPhone')} placeholder={x.mobile} inputMode="numeric" maxLength={10} required />
          <input type="email" value={form.buyerEmail} onChange={set('buyerEmail')} placeholder={x.email} />
          <textarea value={form.deliveryAddress} onChange={set('deliveryAddress')} placeholder={x.deliveryAddress} rows={3} required />
          <input value={form.deliveryPincode} onChange={set('deliveryPincode')} placeholder={x.pin} inputMode="numeric" maxLength={6} required />
          <p className="shop-line">{x.total}: <b>{inr.format(product.price * quantity)}</b></p>
          {error && <p className="shop-error">{error}</p>}
          <div className="shop-row">
            <button className="btn-gold" disabled={busy}>{x.confirm}</button>
            <button type="button" className="btn-ghost dark" onClick={() => setOpen(false)}>{x.cancel}</button>
          </div>
        </form>
      )}
    </article>
  )
}

// ---------------------------------------------------------------- the order page: pay and track
export function OrderPage() {
  const x = useText()
  const code = decodeURIComponent(window.location.pathname.split('/')[2] || '')
  const [phone, setPhone] = useState(new URLSearchParams(window.location.search).get('phone') || remembered(code))
  const [typed, setTyped] = useState('')
  const [order, setOrder] = useState(null)
  const [error, setError] = useState('')
  const [reference, setReference] = useState('')
  const [qr, setQr] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!phone) return
    try { setOrder(await api(`/shop/orders/${encodeURIComponent(code)}?phone=${encodeURIComponent(phone)}`)); setError('') } catch (failure) { setError(failure.message) }
  }, [code, phone])

  useEffect(() => {
    load()
    const timer = setInterval(load, 8000)
    return () => clearInterval(timer)
  }, [load])

  useEffect(() => {
    if (!order?.pay?.link) { setQr(''); return }
    QRCode.toDataURL(order.pay.link, { width: 260, margin: 1, color: { dark: '#0a3d43', light: '#ffffff' } }).then(setQr).catch(() => setQr(''))
  }, [order?.pay?.link])

  async function act(path, body) {
    setBusy(true); setError('')
    try { setOrder(await api(`/shop/orders/${encodeURIComponent(code)}/${path}`, { method: 'POST', body: { phone, ...body } })) } catch (failure) { setError(failure.message) }
    setBusy(false)
  }

  if (!phone) {
    return (
      <section className="section light verify-page"><div className="wrap narrow">
        <p className="kicker">{x.orderTitle}</p>
        <h2>{code}</h2>
        <p className="lead">{x.needPhone}</p>
        <form className="shop-row" onSubmit={(event) => { event.preventDefault(); remember(code, typed.trim()); setPhone(typed.trim()) }}>
          <input value={typed} onChange={(event) => setTyped(event.target.value)} placeholder={x.mobile} inputMode="numeric" maxLength={10} required />
          <button className="btn-gold">{x.show}</button>
        </form>
      </div></section>
    )
  }

  return (
    <section className="section light verify-page">
      <div className="wrap narrow">
        <p className="kicker">{x.orderTitle}</p>
        <h2>{code}</h2>
        {error && <p className="shop-error">{error}</p>}
        {!order && !error && <p className="shop-muted">{x.loading}</p>}

        {order && (
          <>
            <div className="shop-card">
              <p className="shop-status" data-status={order.status}>{x.status[order.status]}</p>
              <h3>{order.quantity} x {order.product}</h3>
              <p className="shop-price">{inr.format(order.total)} <small>({inr.format(order.unitPrice)} {x.price})</small></p>
              <p className="shop-muted">{x.when} {dateOf(order.placedAt)}</p>
            </div>

            {order.pay && (
              <div className="shop-card shop-pay">
                <h3>{x.payTitle}</h3>
                <p>{x.payText}</p>
                <div className="shop-payrow">
                  {qr && <img src={qr} alt="UPI QR code" width="240" height="240" />}
                  <div>
                    <p className="shop-line">{x.payTo}: <b>{order.pay.payee}</b></p>
                    <p className="shop-line">UPI ID: <b className="mono">{order.pay.upiId}</b></p>
                    <p className="shop-line">{x.amount}: <b>{inr.format(order.pay.amount)}</b></p>
                    <a className="btn-ghost dark" href={order.pay.link}>{x.openUpi}</a>
                  </div>
                </div>
                {order.pay.demo && <p className="shop-warn">{x.payDemo}</p>}
                {order.payBy && <p className="shop-line">{x.payBy} <b>{new Date(order.payBy).toLocaleString()}</b></p>}
                <form className="shop-row" onSubmit={(event) => { event.preventDefault(); act('paid', { reference }) }}>
                  <input value={reference} onChange={(event) => setReference(event.target.value)} placeholder={x.reference} minLength={6} required />
                  <button className="btn-gold" disabled={busy}>{x.paid}</button>
                </form>
              </div>
            )}

            {order.paymentStatus === 'CLAIMED' && order.status === 'PLACED' && <p className="shop-warn">{x.waiting} ({x.ref}: {order.paymentRef})</p>}

            <div className="shop-card">
              <h3>{x.steps}</h3>
              <ol className="journey">
                {order.timeline.map((step, index) => (
                  <li key={step.key} className={step.done ? '' : 'last'}>
                    <b>{step.done ? '✔' : '·'} {step.label}</b>
                    <small>{[step.at ? dateOf(step.at) : '', step.note].filter(Boolean).join(' - ')}</small>
                  </li>
                ))}
              </ol>
            </div>

            <div className="shop-facts">
              <div><span>{x.deliveryTo}</span><b>{order.delivery.name}, {order.delivery.address}, {order.delivery.pincode}</b></div>
              <div><span>{x.seller}</span><b>{order.seller.name}</b><small>{order.seller.address}</small>{order.seller.phone && <small><a href={`tel:${order.seller.phone}`}>{order.seller.phone}</a></small>}</div>
            </div>

            {order.status === 'PLACED' && order.paymentStatus === 'PENDING' && <button className="btn-ghost dark" disabled={busy} onClick={() => act('cancel')}>{x.cancelOrder}</button>}
          </>
        )}
      </div>
    </section>
  )
}
