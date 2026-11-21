import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { BrowserRouter, Routes, Route, Link, NavLink, Navigate, useNavigate, useParams, useLocation } from 'react-router-dom'
import { sb } from './supabase'

const Ctx = createContext()
const useMe = () => useContext(Ctx)
const today = () => new Date().toISOString().slice(0, 10)
const plus = d => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10)
const fmt = d => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-')
const hu = s => (s || '').replace(/_/g, ' ')
const naira = (p, u) => (p ? `₦${Number(p).toLocaleString()} per ${u}` : 'Price on request')
const STATES = ['Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno','Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu','FCT','Gombe','Imo','Jigawa','Kaduna','Kano','Katsina','Kebbi','Kogi','Kwara','Lagos','Nasarawa','Niger','Ogun','Ondo','Osun','Oyo','Plateau','Rivers','Sokoto','Taraba','Yobe','Zamfara']
// Commodity-specific attributes (PRD: do not force one checklist on both). Refine with buyers/specialists.
const COMMS = {
  cassava: { varieties: ['Fresh roots', 'Dried chips', 'Garri', 'Cassava flour', 'Other'], hint: 'Root size, starch %, moisture, days since harvest' },
  pepper: { varieties: ['Rodo (Scotch bonnet)', 'Tatashe', 'Shombo', 'Dried pepper', 'Other'], hint: 'Colour, size, dryness/moisture %, pungency' },
}
const KINDS = {
  supplier: ['farmer', 'cooperative', 'aggregator', 'merchant', 'other'],
  buyer: ['processor', 'manufacturer', 'wholesaler', 'retailer', 'distributor', 'institution', 'other'],
}
const NEXT = { submitted: ['received', 'cancelled'], received: ['in_discussion', 'cancelled'], in_discussion: ['offer_made', 'cancelled'], offer_made: ['agreed', 'in_discussion', 'cancelled'], agreed: ['in_fulfilment', 'cancelled'], in_fulfilment: ['completed', 'cancelled'], completed: [] }
const SUPPLIER_ONLY = ['received', 'in_discussion']
const nextOptions = (r, role) => {
  if (r.status === 'disputed') return role === 'admin' ? ['in_discussion', 'in_fulfilment', 'completed', 'cancelled'] : []
  let o = [...(NEXT[r.status] || [])]
  if (!['submitted', 'cancelled'].includes(r.status)) o.push('disputed')
  if (role === 'buyer') o = o.filter(s => !SUPPLIER_ONLY.includes(s))
  return o
}
const Badge = ({ s, t }) => <span className={'badge ' + s}>{t || hu(s)}</span>
const ORDER = ['submitted', 'received', 'in_discussion', 'offer_made', 'agreed', 'in_fulfilment', 'completed']
const ago = d => { const n = Math.floor((Date.now() - new Date(d)) / 864e5); return n < 1 ? 'today' : n === 1 ? '1 day ago' : n + ' days ago' }
const Inp = ({ label, ...p }) => <label>{label}<input {...p} /></label>
const Sel = ({ label, opts, ...p }) => (
  <label>{label}<select {...p}><option value="">Select</option>{opts.map(o => (Array.isArray(o) ? <option key={o[0]} value={o[0]}>{o[1]}</option> : <option key={o} value={o}>{hu(o)}</option>))}</select></label>
)
const csv = (name, rows) => {
  if (!rows?.length) return alert('Nothing to export yet.')
  const k = Object.keys(rows[0]); const e = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([k.join(',') + '\n' + rows.map(r => k.map(c => e(r[c])).join(',')).join('\n')], { type: 'text/csv' }))
  a.download = name + '.csv'; a.click()
}
function useNames(rows, keys) {
  const [n, setN] = useState({})
  useEffect(() => {
    const ids = [...new Set((rows || []).flatMap(r => keys.map(k => r[k])).filter(Boolean))]
    if (!ids.length) return
    sb.from('party_public').select('id,name').in('id', ids).then(({ data }) => setN(Object.fromEntries((data || []).map(x => [x.id, x.name]))))
  }, [rows])
  return n
}

function Provider({ children }) {
  const [s, setS] = useState(undefined), [me, setMe] = useState(null)
  const load = useCallback(async ses => {
    if (!ses) return setMe(null)
    const { data } = await sb.from('profiles').select('*').eq('id', ses.user.id).single(); setMe(data)
  }, [])
  useEffect(() => {
    sb.auth.getSession().then(async ({ data }) => { await load(data.session); setS(data.session) })
    const { data } = sb.auth.onAuthStateChange((_e, ses) => { setTimeout(async () => { await load(ses); setS(ses) }, 0) })
    return () => data.subscription.unsubscribe()
  }, [load])
  return <Ctx.Provider value={{ s, me, reload: () => load(s) }}>{children}</Ctx.Provider>
}

function Gate({ roles, children }) {
  const { s, me } = useMe(), loc = useLocation()
  if (s === undefined) return <p className="pad">Loading…</p>
  if (!s || !me) return <Auth />
  if (roles && !roles.includes(me.role)) return <Navigate to="/" replace />
  const incomplete = me.role !== 'admin' && !(me.phone && me.state && me.commodities?.length)
  if (incomplete && loc.pathname !== '/profile') return <Navigate to="/profile" replace />
  return <Shell>{children}</Shell>
}

function Shell({ children }) {
  const { me } = useMe(), loc = useLocation(), [n, setN] = useState(0)
  useEffect(() => { sb.from('notifications').select('id', { count: 'exact', head: true }).eq('read', false).then(r => setN(r.count || 0)) }, [loc.pathname])
  const links = me.role === 'buyer' ? [['/browse', 'Browse'], ['/saved', 'Saved'], ['/requests', 'Requests']]
    : me.role === 'supplier' ? [['/my-listings', 'Listings'], ['/requests', 'Requests']]
    : [['/admin', 'Admin'], ['/browse', 'Browse'], ['/requests', 'Requests']]
  return (
    <>
      <header className="top"><div className="bar">
        <Link to="/" className="brand"><img src="/logo.png" alt="" />EFIA</Link>
        <nav className="bnav">{[...links, ['/notifications', n ? `Alerts (${n})` : 'Alerts'], ['/profile', 'Profile']].map(([to, t]) => <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'active' : '')}>{t}</NavLink>)}</nav>
        <Link to="/profile" className="avatar" aria-label="Profile">{(me.contact_name || '?')[0].toUpperCase()}</Link>
      </div></header>
      <main className="wrap">{children}</main>
      <footer>EFIA records and supports sourcing between buyers and suppliers. EFIA does not hold funds and does not guarantee quality, delivery, price or payment.</footer>
    </>
  )
}

function Home() {
  const { me } = useMe()
  return <Navigate to={me.role === 'supplier' ? '/my-listings' : me.role === 'buyer' ? '/browse' : '/admin'} replace />
}

function Auth() {
  const [mode, setMode] = useState('login'), [f, setF] = useState({ role: 'buyer' }), [msg, setMsg] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  const set = k => e => setF({ ...f, [k]: e.target.value })
  async function go(e) {
    e.preventDefault(); setBusy(true); setErr(''); setMsg('')
    let r
    if (mode === 'login') r = await sb.auth.signInWithPassword({ email: f.email, password: f.password })
    else if (mode === 'register') {
      if (!f.name || !f.phone) { setBusy(false); return setErr('Enter your name and phone number.') }
      r = await sb.auth.signUp({ email: f.email, password: f.password, options: { data: { role: f.role, contact_name: f.name, phone: f.phone } } })
      if (!r.error && !r.data.session) { setMsg('Account created. Check your email to confirm it, then sign in.'); setMode('login') }
    } else { r = await sb.auth.resetPasswordForEmail(f.email, { redirectTo: location.origin + '/reset' }); if (!r.error) setMsg('Reset link sent. Check your email.') }
    if (r?.error) setErr(r.error.message)
    setBusy(false)
  }
  return (
    <div className="hero">
      <div><img src="/logo.png" width="84" height="84" alt="EFIA" /><h1>Find cassava and pepper supply you can trust.</h1><p>List what you grow or find supply that fits your order. EFIA reviews listings and records every request through to the outcome.</p></div>
      <form className="card" onSubmit={go}>
        <h2>{mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create account' : 'Reset password'}</h2>
        {mode === 'register' && <>
          <Sel label="I am a" value={f.role} onChange={set('role')} opts={[['buyer', 'Buyer'], ['supplier', 'Farmer / supplier']]} />
          <Inp label="Contact name" value={f.name || ''} onChange={set('name')} required />
          <Inp label="Phone number" type="tel" value={f.phone || ''} onChange={set('phone')} required />
        </>}
        <Inp label="Email" type="email" value={f.email || ''} onChange={set('email')} required />
        {mode !== 'forgot' && <Inp label="Password" type="password" minLength={8} value={f.password || ''} onChange={set('password')} required />}
        {err && <div className="err">{err}</div>}{msg && <div className="ok">{msg}</div>}
        <div className="acts"><button className="btn" disabled={busy}>{mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create account' : 'Send reset link'}</button></div>
        <p className="mute">
          {mode !== 'login' && <a href="#" onClick={e => { e.preventDefault(); setMode('login') }}>Sign in</a>}{' '}
          {mode !== 'register' && <a href="#" onClick={e => { e.preventDefault(); setMode('register') }}>Create account</a>}{' '}
          {mode === 'login' && <a href="#" onClick={e => { e.preventDefault(); setMode('forgot') }}>Forgot password?</a>}
        </p>
      </form>
    </div>
  )
}

function Reset() {
  const { s } = useMe(), nav = useNavigate(), [p, setP] = useState(''), [err, setErr] = useState('')
  if (s === undefined) return <p className="pad">Loading…</p>
  if (!s) return <p className="pad">This reset link has expired. <Link to="/">Request a new one</Link></p>
  return (
    <form className="card wrap" style={{ maxWidth: 420 }} onSubmit={async e => { e.preventDefault(); const r = await sb.auth.updateUser({ password: p }); r.error ? setErr(r.error.message) : nav('/') }}>
      <h2>Choose a new password</h2><Inp label="New password" type="password" minLength={8} value={p} onChange={e => setP(e.target.value)} required />
      {err && <div className="err">{err}</div>}<div className="acts"><button className="btn">Save password</button></div>
    </form>
  )
}

function Profile() {
  const { me, reload } = useMe(), [f, setF] = useState(me), [msg, setMsg] = useState(''), [err, setErr] = useState('')
  const set = k => e => setF({ ...f, [k]: e.target.value })
  const tog = c => setF({ ...f, commodities: f.commodities?.includes(c) ? f.commodities.filter(x => x !== c) : [...(f.commodities || []), c] })
  async function save(e) {
    e.preventDefault(); setErr(''); setMsg('')
    if (!f.contact_name || !f.phone || !f.state || !f.commodities?.length || !f.kind) return setErr('Fill in the required fields, including the type, state and at least one commodity.')
    const { error } = await sb.from('profiles').update({ contact_name: f.contact_name, phone: f.phone, org_name: f.org_name, kind: f.kind, state: f.state, lga: f.lga, town: f.town, commodities: f.commodities, notify_email: f.notify_email !== false, notify_sms: !!f.notify_sms }).eq('id', me.id)
    if (error) return setErr(error.message)
    await reload(); setMsg('Profile saved.')
  }
  const isAdmin = me.role === 'admin'
  return (
    <form className="card" onSubmit={save}>
      <div className="row"><h2>Your profile</h2>{!isAdmin && <span>Verification: <Badge s={me.verification} /></span>}</div>
      <p className="mute">Your phone number and email are never shown publicly. Only EFIA can see them.</p>
      <div className="grid">
        <Inp label="Contact name *" value={f.contact_name || ''} onChange={set('contact_name')} />
        <Inp label="Phone *" type="tel" value={f.phone || ''} onChange={set('phone')} />
        <Inp label="Email" value={f.email || ''} disabled />
        {!isAdmin && <>
          <Inp label={me.role === 'buyer' ? 'Organisation name' : 'Farm or business name'} value={f.org_name || ''} onChange={set('org_name')} />
          <Sel label={(me.role === 'buyer' ? 'Buyer' : 'Supplier') + ' type *'} value={f.kind || ''} onChange={set('kind')} opts={KINDS[me.role]} />
          <Sel label="State *" value={f.state || ''} onChange={set('state')} opts={STATES} />
          <Inp label="LGA" value={f.lga || ''} onChange={set('lga')} />
          {me.role === 'supplier' && <Inp label="Town / community" value={f.town || ''} onChange={set('town')} />}
        </>}
      </div>
      {!isAdmin && <><label>{me.role === 'buyer' ? 'Commodities you need *' : 'Commodities you supply *'}</label>
        {['cassava', 'pepper'].map(c => <label key={c} className="chk"><input type="checkbox" checked={!!f.commodities?.includes(c)} onChange={() => tog(c)} />{hu(c)}</label>)}</>}
      {err && <div className="err">{err}</div>}{msg && <div className="ok">{msg}</div>}
      <label>Alerts by email or SMS (in-app alerts are always on)</label>
      <label className="chk"><input type="checkbox" checked={f.notify_email !== false} onChange={e => setF({ ...f, notify_email: e.target.checked })} />Email me</label>
      <label className="chk"><input type="checkbox" checked={!!f.notify_sms} onChange={e => setF({ ...f, notify_sms: e.target.checked })} />SMS me</label>
      <div className="acts"><button className="btn">Save profile</button><button type="button" className="btn alt" onClick={() => sb.auth.signOut()}>Sign out</button></div>
    </form>
  )
}

function ListingCard({ l }) {
  const H = l.availability === 'expected_harvest'
  return (
    <Link to={'/listing/' + l.id} className="lcard"><div className="card">
      <div className="row"><h3>{hu(l.commodity)}{l.variety ? `, ${l.variety}` : ''}</h3><span className="qty">{l.quantity} {l.unit}</span></div>
      <p className="mute">{l.town}, {l.state}</p>
      <div className="pills"><Badge s="approved" t="Reviewed by EFIA" /><Badge s={l.availability} t={H ? `Harvest expected ${new Date(l.available_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'Available now'} /></div>
      <div className="foot"><span>Listed {ago(l.created_at)}</span><span>{naira(l.price, l.price_unit)}</span></div>
    </div></Link>
  )
}

function Browse() {
  const [q, setQ] = useState({ commodity: '', state: '', availability: '', minqty: '', kw: '' }), [rows, setRows] = useState(null)
  const set = k => e => setQ({ ...q, [k]: e.target.value })
  useEffect(() => {
    let s = sb.from('listings').select('*').eq('status', 'approved').gte('expires_at', today()).neq('availability', 'unavailable').order('created_at', { ascending: false }).limit(60)
    if (q.commodity) s = s.eq('commodity', q.commodity)
    if (q.state) s = s.eq('state', q.state)
    if (q.availability) s = s.eq('availability', q.availability)
    if (+q.minqty) s = s.gte('quantity_kg', +q.minqty * 1000)
    const k = q.kw.replace(/[,()%]/g, '').trim()
    if (k) s = s.or(`variety.ilike.%${k}%,quality.ilike.%${k}%,town.ilike.%${k}%,lga.ilike.%${k}%`)
    const t = setTimeout(() => s.then(({ data }) => setRows(data || [])), 250)
    return () => clearTimeout(t)
  }, [q])
  return (
    <>
      <h1>Find cassava and pepper supply you can trust</h1>
      <input className="search" placeholder="Search variety, town or LGA" value={q.kw} onChange={set('kw')} aria-label="Search" />
      <div className="chips">{[['', 'All'], ['cassava', 'Cassava'], ['pepper', 'Pepper']].map(([v, t]) => <button key={t} className={'chip' + (q.commodity === v ? ' on' : '')} onClick={() => setQ({ ...q, commodity: v })}>{t}</button>)}</div>
      <div className="chips">
        <select className="chip" value={q.state} onChange={set('state')} aria-label="State"><option value="">State</option>{STATES.map(s => <option key={s}>{s}</option>)}</select>
        <select className="chip" value={q.minqty} onChange={set('minqty')} aria-label="Quantity"><option value="">Quantity</option>{[1, 5, 10, 25, 50].map(n => <option key={n} value={n}>{n}+ tonnes</option>)}</select>
        <select className="chip" value={q.availability} onChange={set('availability')} aria-label="Availability"><option value="">Availability</option><option value="available_now">Available now</option><option value="expected_harvest">Expected harvest</option></select>
      </div>
      {rows === null ? <p className="pad">Loading…</p> : rows.length === 0 ? <p className="pad">No approved listings match. Try removing a filter.</p> : <div className="cards">{rows.map(l => <ListingCard key={l.id} l={l} />)}</div>}
    </>
  )
}

function ListingView() {
  const { id } = useParams(), { me } = useMe(), nav = useNavigate()
  const [sv, setSv] = useState({}), [l, setL] = useState(), [sup, setSup] = useState(), [f, setF] = useState({ kind: 'enquiry' }), [err, setErr] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => {
    sb.from('listings').select('*').eq('id', id).single().then(async ({ data }) => {
      setL(data || null)
      if (data) { const { data: p } = await sb.from('party_public').select('*').eq('id', data.supplier_id).single(); setSup(p); setF(x => ({ ...x, unit: data.unit, delivery_location: me.state || '' })) }
    })
  }, [id])
  useEffect(() => { sb.from('saved').select('kind,target_id').then(({ data }) => setSv(Object.fromEntries((data || []).map(x => [x.kind + x.target_id, 1])))) }, [])
  const tog = async (kind, tid) => { const k = kind + tid; if (sv[k]) await sb.from('saved').delete().match({ kind, target_id: tid }); else await sb.from('saved').insert({ kind, target_id: tid }); setSv({ ...sv, [k]: !sv[k] }) }
  if (l === undefined) return <p className="pad">Loading…</p>
  if (l === null) return <p className="pad">This listing is no longer available.</p>
  const set = k => e => setF({ ...f, [k]: e.target.value })
  async function send(e) {
    e.preventDefault(); setErr('')
    if (!(+f.quantity > 0) || !f.delivery_location || !f.needed_by) return setErr('Add the quantity, delivery location and the date you need it by.')
    setBusy(true)
    const { data, error } = await sb.from('requests').insert({ listing_id: l.id, buyer_id: me.id, kind: f.kind, quantity: +f.quantity, unit: f.unit, delivery_location: f.delivery_location, needed_by: f.needed_by, message: f.message }).select().single()
    setBusy(false); if (error) return setErr(error.message); nav('/requests/' + data.id)
  }
  return (
    <>
      <Link to={me.role === 'buyer' ? '/browse' : '/'} className="back">← Listings</Link>
      <div className="hero2"><h1>{hu(l.commodity)}{l.variety ? `, ${l.variety}` : ''}</h1></div>
      <div className="pills"><Badge s="approved" t="Reviewed by EFIA" /><Badge s={l.availability} t={l.availability === 'expected_harvest' ? 'Harvest expected' : 'Available now'} /></div>
      <div className="tiles">{[
        ['Quantity', `${l.quantity} ${l.unit}${l.unit === 'bags' ? ` (${l.bag_kg} kg each)` : ''}`], ['Minimum order', l.min_order || '-'],
        ['Location', `${l.town}, ${l.lga}, ${l.state}`], [l.availability === 'expected_harvest' ? 'Expected harvest' : 'Available from', fmt(l.available_date || l.created_at)],
        ['Quality (self-reported)', l.quality || 'Not stated'], ['Collection / delivery', l.delivery || 'Not stated'],
        ['Price expectation', naira(l.price, l.price_unit)], ['Valid until', fmt(l.expires_at)],
      ].map(([k, v]) => <div className="tile" key={k}><span>{k}</span><b>{v}</b></div>)}</div>
      {sup && <div className="card sup"><span className="avatar">{(sup.name || '?').slice(0, 2).toUpperCase()}</span><div><h3 style={{ margin: 0 }}>{sup.name}</h3><span className="mute">{sup.kind} · {sup.state} · </span><Badge s={sup.verification} /></div></div>}
      <p className="mute">Contact details stay private. Use messages on your request to talk to the supplier. EFIA reviews listings but does not guarantee quality, price or delivery.</p>
      {me.role === 'buyer' && <div className="acts"><button className="btn sm alt" onClick={() => tog('listing', l.id)}>{sv['listing' + l.id] ? 'Listing saved ✓' : 'Save listing'}</button><button className="btn sm alt" onClick={() => tog('supplier', l.supplier_id)}>{sv['supplier' + l.supplier_id] ? 'Supplier saved ✓' : 'Save supplier'}</button></div>}
      <Report listingId={l.id} />
      {me.role === 'buyer' && (
        <form className="card" onSubmit={send}>
          <h3>Contact the supplier</h3>
          <Sel label="I want to" value={f.kind} onChange={set('kind')} opts={[['enquiry', 'Ask a question'], ['purchase_request', 'Request to buy']]} />
          <div className="grid">
            <Inp label="Quantity" type="number" min="0" step="any" value={f.quantity || ''} onChange={set('quantity')} />
            <Sel label="Unit" value={f.unit} onChange={set('unit')} opts={['kg', 'tonnes', 'bags']} />
            <Inp label="Delivery location" value={f.delivery_location || ''} onChange={set('delivery_location')} />
            <Inp label="Needed by" type="date" min={today()} value={f.needed_by || ''} onChange={set('needed_by')} />
          </div>
          <label>Message<textarea rows="3" value={f.message || ''} onChange={set('message')} /></label>
          {err && <div className="err">{err}</div>}
          <div className="acts"><button className="btn gold" disabled={busy}>Send request</button></div>
        </form>
      )}
    </>
  )
}

const stateOf = r => (r.status === 'approved' && r.expires_at < today() ? 'expired' : r.status)

function MyListings() {
  const { me } = useMe(), [rows, setRows] = useState(null)
  const load = () => sb.from('listings').select('*').eq('supplier_id', me.id).order('created_at', { ascending: false }).then(({ data }) => setRows(data || []))
  useEffect(() => { load() }, [])
  const upd = async (id, patch) => { const { error } = await sb.from('listings').update(patch).eq('id', id); if (error) alert(error.message); load() }
  return (
    <>
      <div className="row"><h2>My listings</h2><Link className="btn" to="/my-listings/new">New listing</Link></div>
      {rows === null ? <p className="pad">Loading…</p> : rows.length === 0 ? <p className="pad">No listings yet. Create your first one to reach buyers.</p> : rows.map(l => (
        <div className="card" key={l.id}>
          <div className="row"><h3>{hu(l.commodity)}: {l.quantity ?? '?'} {l.unit}, {l.town || l.state}</h3><Badge s={stateOf(l)} /></div>
          {l.review_note && ['draft', 'rejected'].includes(l.status) && <div className="err">EFIA note: {l.review_note}</div>}
          <p className="mute">Valid until {fmt(l.expires_at)}</p>
          <div className="acts">
            <Link className="btn sm alt" to={'/my-listings/' + l.id}>Edit</Link>
            {l.status === 'approved' && <>
              <button className="btn sm alt" onClick={() => upd(l.id, { expires_at: plus(30) })}>Reconfirm for 30 days</button>
              <button className="btn sm alt" onClick={() => upd(l.id, { status: 'paused' })}>Pause</button>
              <button className="btn sm alt" onClick={() => upd(l.id, { status: 'unavailable' })}>Mark sold / unavailable</button></>}
            {['paused', 'unavailable'].includes(l.status) && <button className="btn sm" onClick={() => upd(l.id, { status: 'submitted', expires_at: plus(30) })}>Resubmit for review</button>}
            {l.status === 'draft' && <button className="btn sm red" onClick={async () => { if (confirm('Delete this draft?')) { await sb.from('listings').delete().eq('id', l.id); load() } }}>Delete</button>}
          </div>
        </div>
      ))}
    </>
  )
}

function ListingForm() {
  const { id } = useParams(), { me } = useMe(), nav = useNavigate()
  const [l, setL] = useState(null), [err, setErr] = useState('')
  useEffect(() => {
    if (id === 'new') setL({ commodity: me.commodities?.[0] || 'cassava', unit: 'tonnes', availability: 'available_now', state: me.state || '', lga: me.lga || '', town: me.town || '', expires_at: plus(30), status: null })
    else sb.from('listings').select('*').eq('id', id).single().then(({ data }) => setL(data))
  }, [id])
  if (!l) return <p className="pad">Loading…</p>
  const set = k => e => setL({ ...l, [k]: e.target.value })
  const canDraft = !l.status || ['draft', 'rejected'].includes(l.status)
  async function save(status) {
    setErr('')
    if (status === 'submitted') {
      if (!(+l.quantity > 0) || !l.state || !l.lga || !l.town) return setErr('Add the quantity and the full location (state, LGA, town).')
      if (l.unit === 'bags' && !(+l.bag_kg > 0)) return setErr('Say how many kg are in one bag.')
      if (l.availability === 'expected_harvest' && !l.available_date) return setErr('Add the expected harvest date.')
    }
    const p = { commodity: l.commodity, variety: l.variety || null, quantity: +l.quantity || null, unit: l.unit, bag_kg: l.unit === 'bags' ? +l.bag_kg || null : null, state: l.state, lga: l.lga, town: l.town, availability: l.availability, available_date: l.available_date || null, price: l.price ? +l.price : null, price_unit: l.price ? l.price_unit || 'kg' : null, quality: l.quality, min_order: l.min_order, delivery: l.delivery, expires_at: l.expires_at }
    const r = id === 'new'
      ? await sb.from('listings').insert({ ...p, supplier_id: me.id, status: status || 'draft' })
      : await sb.from('listings').update(status ? { ...p, status } : p).eq('id', id)
    if (r.error) return setErr(r.error.message)
    nav('/my-listings')
  }
  const C = COMMS[l.commodity]
  return (
    <form className="card" onSubmit={e => e.preventDefault()}>
      <h2>{id === 'new' ? 'New listing' : 'Edit listing'}</h2>
      {l.status === 'approved' && <p className="mute">Changing quantity, unit, location or availability sends this listing back to EFIA for review.</p>}
      <div className="grid">
        <Sel label="Commodity *" value={l.commodity} onChange={e => setL({ ...l, commodity: e.target.value, variety: '' })} opts={['cassava', 'pepper']} />
        <Sel label="Type / variety" value={l.variety || ''} onChange={set('variety')} opts={C.varieties} />
        <Inp label="Quantity *" type="number" min="0" step="any" value={l.quantity ?? ''} onChange={set('quantity')} />
        <Sel label="Unit *" value={l.unit} onChange={set('unit')} opts={['kg', 'tonnes', 'bags']} />
        {l.unit === 'bags' && <Inp label="Kg in one bag *" type="number" min="0" value={l.bag_kg ?? ''} onChange={set('bag_kg')} />}
        <Inp label="Minimum order" value={l.min_order || ''} onChange={set('min_order')} placeholder="e.g. 500 kg" />
        <Sel label="State *" value={l.state || ''} onChange={set('state')} opts={STATES} />
        <Inp label="LGA *" value={l.lga || ''} onChange={set('lga')} />
        <Inp label="Town / community *" value={l.town || ''} onChange={set('town')} />
        <Sel label="Availability *" value={l.availability} onChange={set('availability')} opts={['available_now', 'expected_harvest', 'unavailable']} />
        <Inp label={l.availability === 'expected_harvest' ? 'Expected harvest date *' : 'Available from'} type="date" value={l.available_date || ''} onChange={set('available_date')} />
        <Inp label="Listing valid until *" type="date" min={today()} value={l.expires_at || ''} onChange={set('expires_at')} />
        <Inp label="Price expectation (₦, optional)" type="number" min="0" value={l.price ?? ''} onChange={set('price')} />
        {l.price && <Sel label="Price per" value={l.price_unit || 'kg'} onChange={set('price_unit')} opts={['kg', 'tonne', 'bag']} />}
      </div>
      <label>Quality / grade<textarea rows="2" placeholder={C.hint} value={l.quality || ''} onChange={set('quality')} /></label>
      <label>Delivery or collection<textarea rows="2" value={l.delivery || ''} onChange={set('delivery')} /></label>
      {err && <div className="err">{err}</div>}
      <div className="acts">
        {canDraft ? <><button className="btn alt" onClick={() => save('draft')}>Save draft</button><button className="btn" onClick={() => save('submitted')}>Submit for review</button></>
          : <><button className="btn" onClick={() => save(null)}>Save changes</button>{['paused', 'unavailable'].includes(l.status) && <button className="btn alt" onClick={() => save('submitted')}>Resubmit for review</button>}</>}
      </div>
    </form>
  )
}

function Requests() {
  const { me } = useMe(), [rows, setRows] = useState(null), names = useNames(rows, ['buyer_id', 'supplier_id'])
  useEffect(() => { sb.from('requests').select('*').order('created_at', { ascending: false }).then(({ data }) => setRows(data || [])) }, [])
  if (!rows) return <p className="pad">Loading…</p>
  return (
    <>
      <h2>{me.role === 'admin' ? 'All requests' : me.role === 'buyer' ? 'My requests' : 'Buyer requests'}</h2>
      {rows.length === 0 && <p className="pad">No requests yet.</p>}
      {rows.map(r => (
        <Link key={r.id} to={'/requests/' + r.id} style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="card"><div className="row"><h3>{r.listing_title || 'Listing'}</h3><Badge s={r.status} /></div>
            <p className="mute" style={{ margin: 0 }}>{me.role === 'buyer' ? `Supplier: ${names[r.supplier_id] || ''}` : `Buyer: ${names[r.buyer_id] || ''}`} · {r.quantity} {r.unit} · {fmt(r.created_at)}</p></div>
        </Link>
      ))}
    </>
  )
}

function RequestView() {
  const { id } = useParams(), { me } = useMe()
  const [r, setR] = useState(), [msgs, setMsgs] = useState([]), [body, setBody] = useState(''), names = useNames(r ? [r] : [], ['buyer_id', 'supplier_id'])
  const load = async () => {
    const { data } = await sb.from('requests').select('*').eq('id', id).single(); setR(data || null)
    const m = await sb.from('messages').select('*').eq('request_id', id).order('created_at'); setMsgs(m.data || [])
  }
  useEffect(() => { load() }, [id])
  if (r === undefined) return <p className="pad">Loading…</p>
  if (r === null) return <p className="pad">Request not found.</p>
  async function move(next) {
    const patch = { status: next }
    if (next === 'cancelled') { const t = prompt('Reason for cancelling:'); if (!t) return; patch.outcome_note = t }
    if (next === 'disputed') { const t = prompt('Describe the issue:'); if (!t) return; patch.outcome_note = t }
    if (next === 'agreed') { const t = prompt('Record the agreed quantity, price and terms:'); if (!t) return; patch.agreed_terms = t }
    if (next === 'completed' && !confirm('Confirm that this transaction took place?')) return
    const { error } = await sb.from('requests').update(patch).eq('id', id); if (error) alert(error.message); load()
  }
  async function send(e) { e.preventDefault(); if (!body.trim()) return; await sb.from('messages').insert({ request_id: id, body: body.trim() }); setBody(''); load() }
  const note = async () => { const t = prompt('Admin note (follow-up, outcome, resolution):', r.admin_note || ''); if (t !== null) { await sb.from('requests').update({ admin_note: t }).eq('id', id); load() } }
  return (
    <>
      <div className="card">
        <div className="row"><h2>{r.listing_title}</h2><Badge s={r.status} /></div>
        <p>{r.kind === 'enquiry' ? 'Enquiry' : 'Purchase request'}: <b>{r.quantity} {r.unit}</b> to {r.delivery_location}, needed by {fmt(r.needed_by)}</p>
        <p className="mute">Buyer: {names[r.buyer_id]} · Supplier: {names[r.supplier_id]} · Sent {fmt(r.created_at)}</p>
        {r.message && <p>"{r.message}"</p>}
        {r.agreed_terms && <p><b>Agreed terms:</b> {r.agreed_terms}</p>}
        {r.outcome_note && <p><b>Outcome note:</b> {r.outcome_note}</p>}
        {r.admin_note && me.role === 'admin' && <p><b>Admin note:</b> {r.admin_note}</p>}
        <div className="acts">
          {nextOptions(r, me.role).map(s => <button key={s} className={'btn sm' + (['cancelled', 'disputed'].includes(s) ? ' red' : '')} onClick={() => move(s)}>{s === 'cancelled' && r.status === 'submitted' ? 'Withdraw request' : 'Mark as ' + hu(s)}</button>)}
          {me.role === 'admin' && <button className="btn sm alt" onClick={note}>Add admin note</button>}
        </div>
      </div>
      <div className="card"><ol className="tl">{ORDER.map((st, i) => { const c = ORDER.indexOf(r.status), k = i < c || r.status === 'completed' ? 'done' : i === c ? 'cur' : ''; return <li key={st} className={k}><i>{k === 'done' ? '✓' : ''}</i>{hu(st)[0].toUpperCase() + hu(st).slice(1)}</li> })}</ol>{['cancelled', 'disputed'].includes(r.status) && <p><Badge s={r.status} /></p>}</div>
      <div className="card"><h3>Messages</h3>
        {msgs.length === 0 && <p className="mute">No messages yet.</p>}
        {msgs.map(m => <div key={m.id} className={'msg' + (m.sender_id === me.id ? ' me' : '')}>{m.body}<div className="mute">{new Date(m.created_at).toLocaleString('en-GB')}</div></div>)}
        <form onSubmit={send}><textarea rows="2" value={body} onChange={e => setBody(e.target.value)} placeholder="Write a message" /><div className="acts"><button className="btn sm">Send message</button></div></form>
      </div>
      <Report requestId={id} listingId={r.listing_id} />
    </>
  )
}

function Report({ listingId, requestId }) {
  const [open, setOpen] = useState(false), [f, setF] = useState({ reason: 'inaccurate' }), [done, setDone] = useState(false)
  if (done) return <p className="ok">Thanks. EFIA will review your report.</p>
  if (!open) return <p><button className="btn sm alt" onClick={() => setOpen(true)}>Report an issue</button></p>
  return (
    <div className="card"><h3>Report an issue</h3>
      <Sel label="What happened?" value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} opts={[['scam', 'Suspected scam'], ['inaccurate', 'Inaccurate listing'], ['harassment', 'Harassment'], ['dispute', 'Transaction dispute'], ['other', 'Other']]} />
      <label>Details<textarea rows="3" value={f.details || ''} onChange={e => setF({ ...f, details: e.target.value })} /></label>
      <div className="acts"><button className="btn" onClick={async () => { const { error } = await sb.from('reports').insert({ ...f, listing_id: listingId || null, request_id: requestId || null }); error ? alert(error.message) : setDone(true) }}>Send report</button></div>
    </div>
  )
}

function Saved() {
  const [ls, setLs] = useState(null), [ss, setSs] = useState([])
  useEffect(() => { (async () => {
    const { data } = await sb.from('saved').select('*').order('created_at', { ascending: false })
    const ids = k => (data || []).filter(x => x.kind === k).map(x => x.target_id), a = ids('listing'), b = ids('supplier')
    setLs(a.length ? (await sb.from('listings').select('*').in('id', a)).data || [] : [])
    setSs(b.length ? (await sb.from('party_public').select('*').in('id', b)).data || [] : [])
  })() }, [])
  if (!ls) return <p className="pad">Loading…</p>
  return (
    <>
      <h2>Saved listings</h2>
      {ls.length === 0 ? <p className="pad">Nothing saved yet. Open a listing and tap Save listing.</p> : <div className="cards">{ls.map(l => <ListingCard key={l.id} l={l} />)}</div>}
      <h2 style={{ marginTop: '1.5rem' }}>Saved suppliers</h2>
      {ss.length === 0 ? <p className="pad">No saved suppliers.</p> : ss.map(u => <div className="card" key={u.id}><h3>{u.name}</h3><span className="mute">{u.kind} · {u.lga}, {u.state} · </span><Badge s={u.verification} /></div>)}
    </>
  )
}

function Reports() {
  const [rows, setRows] = useState(null), names = useNames(rows, ['reporter_id'])
  const load = () => sb.from('reports').select('*').order('status').order('created_at', { ascending: false }).then(({ data }) => setRows(data || []))
  useEffect(() => { load() }, [])
  if (!rows) return <p className="pad">Loading…</p>
  return rows.length === 0 ? <p className="pad">No reports.</p> : rows.map(r => (
    <div className="card" key={r.id}>
      <div className="row"><h3>{hu(r.reason)}</h3><Badge s={r.status === 'open' ? 'pending' : 'completed'} t={r.status} /></div>
      <p className="mute">From {names[r.reporter_id]} · {fmt(r.created_at)}</p><p>{r.details || 'No details'}</p>
      {r.admin_note && <p><b>Note:</b> {r.admin_note}</p>}
      <div className="acts">
        {r.listing_id && <Link className="btn sm alt" to={'/listing/' + r.listing_id}>View listing</Link>}
        {r.request_id && <Link className="btn sm alt" to={'/requests/' + r.request_id}>View request</Link>}
        {r.status === 'open' && <button className="btn sm" onClick={async () => { const t = prompt('Resolution note:'); if (!t) return; await sb.from('reports').update({ status: 'resolved', admin_note: t }).eq('id', r.id); load() }}>Mark resolved</button>}
      </div>
    </div>
  ))
}

function Notifs() {
  const [rows, setRows] = useState(null)
  useEffect(() => { sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(50).then(({ data }) => { setRows(data || []); sb.from('notifications').update({ read: true }).eq('read', false) }) }, [])
  if (!rows) return <p className="pad">Loading…</p>
  return (
    <>
      <h2>Alerts</h2>{rows.length === 0 && <p className="pad">Nothing new.</p>}
      {rows.map(n => <Link key={n.id} to={n.link || '/'} style={{ textDecoration: 'none', color: 'inherit' }}><div className="card"><b>{n.title}</b>{!n.read && <> <Badge s="pending" /></>}<p className="mute" style={{ margin: 0 }}>{n.body} · {new Date(n.created_at).toLocaleString('en-GB')}</p></div></Link>)}
    </>
  )
}

function Admin() {
  const [tab, setTab] = useState('overview')
  return (
    <>
      <h2>Admin</h2>
      <div className="tabs">{['overview', 'review', 'users', 'reports', 'audit'].map(t => <button key={t} className={'btn sm' + (tab === t ? '' : ' alt')} onClick={() => setTab(t)}>{t === 'review' ? 'Listing review' : t[0].toUpperCase() + t.slice(1)}</button>)}</div>
      {tab === 'overview' && <Overview />}{tab === 'review' && <Review />}{tab === 'users' && <Users />}{tab === 'reports' && <Reports />}{tab === 'audit' && <Audit />}
    </>
  )
}

function Overview() {
  const [c, setC] = useState(null)
  const cnt = (t, f) => f(sb.from(t).select('*', { count: 'exact', head: true })).then(r => r.count ?? 0)
  useEffect(() => {
    Promise.all([
      cnt('profiles', q => q.eq('role', 'supplier')), cnt('profiles', q => q.eq('role', 'buyer')),
      cnt('listings', q => q.eq('status', 'approved').gte('expires_at', today())), cnt('listings', q => q.in('status', ['submitted', 'under_review'])),
      cnt('requests', q => q.not('status', 'in', '(completed,cancelled)')), cnt('requests', q => q.eq('status', 'completed')),
    ]).then(setC)
  }, [])
  const L = ['Suppliers', 'Buyers', 'Active listings', 'Pending reviews', 'Open requests', 'Completed transactions']
  const exp = async (t, name) => csv(name, (await sb.from(t).select('*')).data)
  return (
    <>
      <div className="grid">{L.map((t, i) => <div className="card" key={t}><div className="stat">{c ? c[i] : '-'}</div>{t}</div>)}</div>
      <div className="card"><h3>Export records</h3><div className="acts">
        <button className="btn sm alt" onClick={() => exp('requests', 'efia-requests')}>Requests (CSV)</button>
        <button className="btn sm alt" onClick={() => exp('listings', 'efia-listings')}>Listings (CSV)</button>
        <button className="btn sm alt" onClick={() => exp('profiles', 'efia-users')}>Users (CSV)</button></div></div>
    </>
  )
}

function Review() {
  const { me } = useMe(), [rows, setRows] = useState(null), names = useNames(rows, ['supplier_id'])
  const load = () => sb.from('listings').select('*').in('status', ['submitted', 'under_review']).order('updated_at').then(({ data }) => setRows(data || []))
  useEffect(() => { load() }, [])
  async function act(l, status) {
    let note = null
    if (status === 'rejected' || status === 'draft') { note = prompt(status === 'rejected' ? 'Reason for rejecting:' : 'What should the supplier correct?'); if (!note) return }
    const { error } = await sb.from('listings').update({ status, review_note: note, reviewed_by: me.id, reviewed_at: new Date().toISOString() }).eq('id', l.id)
    if (error) alert(error.message); load()
  }
  if (!rows) return <p className="pad">Loading…</p>
  return rows.length === 0 ? <p className="pad">No listings waiting for review.</p> : rows.map(l => (
    <div className="card" key={l.id}>
      <div className="row"><h3>{hu(l.commodity)}{l.variety ? `: ${l.variety}` : ''}, {l.quantity} {l.unit}</h3><Badge s={l.status} /></div>
      <p className="mute">{names[l.supplier_id]} · {l.town}, {l.lga}, {l.state} · {hu(l.availability)} {fmt(l.available_date)} · {naira(l.price, l.price_unit)} · valid until {fmt(l.expires_at)}</p>
      <p>{l.quality || 'No quality notes'}</p>
      <div className="acts">
        <button className="btn sm" onClick={() => act(l, 'approved')}>Approve</button>
        <button className="btn sm alt" onClick={() => act(l, 'under_review')}>Mark under review</button>
        <button className="btn sm alt" onClick={() => act(l, 'draft')}>Ask for changes</button>
        <button className="btn sm red" onClick={() => act(l, 'rejected')}>Reject</button>
      </div>
    </div>
  ))
}

function Users() {
  const [rows, setRows] = useState([]), [q, setQ] = useState('')
  useEffect(() => { sb.from('profiles').select('*').neq('role', 'admin').order('created_at', { ascending: false }).then(({ data }) => setRows(data || [])) }, [])
  const set = async (id, v) => { await sb.from('profiles').update({ verification: v }).eq('id', id); setRows(rows.map(r => (r.id === id ? { ...r, verification: v } : r))) }
  const shown = rows.filter(r => JSON.stringify(r).toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      <Inp label="Search users" value={q} onChange={e => setQ(e.target.value)} />
      {shown.map(u => (
        <div className="card" key={u.id}>
          <div className="row"><h3>{u.org_name || u.contact_name} <span className="mute">({u.role}{u.kind ? `, ${u.kind}` : ''})</span></h3>
            <select style={{ width: 'auto' }} value={u.verification} onChange={e => set(u.id, e.target.value)}>{['pending', 'verified', 'needs_review', 'rejected'].map(v => <option key={v} value={v}>{hu(v)}</option>)}</select></div>
          <p className="mute" style={{ margin: 0 }}>{u.contact_name} · {u.phone} · {u.email} · {u.town} {u.lga} {u.state} · {u.commodities?.join(', ')}</p>
        </div>
      ))}
    </>
  )
}

function Audit() {
  const [rows, setRows] = useState([])
  useEffect(() => { sb.from('audit_log').select('*').order('created_at', { ascending: false }).limit(100).then(({ data }) => setRows(data || [])) }, [])
  return (
    <div className="card scroll"><table><thead><tr><th>When</th><th>Action</th><th>Entity</th><th>Detail</th></tr></thead>
      <tbody>{rows.map(a => <tr key={a.id}><td>{new Date(a.created_at).toLocaleString('en-GB')}</td><td>{hu(a.action)}</td><td>{a.entity}</td><td>{a.detail?.note || ''}</td></tr>)}</tbody></table></div>
  )
}

export default function App() {
  return (
    <BrowserRouter><Provider>
      <Routes>
        <Route path="/reset" element={<Reset />} />
        <Route path="/" element={<Gate><Home /></Gate>} />
        <Route path="/profile" element={<Gate><Profile /></Gate>} />
        <Route path="/browse" element={<Gate roles={['buyer', 'admin']}><Browse /></Gate>} />
        <Route path="/listing/:id" element={<Gate><ListingView /></Gate>} />
        <Route path="/my-listings" element={<Gate roles={['supplier']}><MyListings /></Gate>} />
        <Route path="/my-listings/:id" element={<Gate roles={['supplier']}><ListingForm /></Gate>} />
        <Route path="/requests" element={<Gate><Requests /></Gate>} />
        <Route path="/requests/:id" element={<Gate><RequestView /></Gate>} />
        <Route path="/saved" element={<Gate roles={['buyer']}><Saved /></Gate>} />
        <Route path="/notifications" element={<Gate><Notifs /></Gate>} />
        <Route path="/admin" element={<Gate roles={['admin']}><Admin /></Gate>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Provider></BrowserRouter>
  )
}
