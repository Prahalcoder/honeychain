import { useEffect, useState } from 'react'
import { ADMIN_URL, KEEPER_URL, LANGUAGES, useLang, withLang } from './i18n'
import ScrollStory from './ScrollStory'
import VerifyPanel from './Verify'

function Nav({ alwaysSolid }) {
  const { t, lang, setLang } = useLang()
  const [solid, setSolid] = useState(false)

  useEffect(() => {
    const onScroll = () => setSolid(alwaysSolid || window.scrollY > 40)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [alwaysSolid])

  return (
    <header className={`nav ${solid ? 'solid' : ''}`}>
      <a className="brand" href="/">
        <img src="/honeychain-logo.png" alt="" />
        <span>Honey Chain</span>
      </a>

      <nav className="nav-links" aria-label="Sections">
        <a href="/#verify">{t.nav.verify}</a>
        <a href="/#how">{t.nav.how}</a>
        <a href="/#schemes">{t.nav.schemes}</a>
        <a href="/#honey">{t.nav.honey}</a>
      </nav>

      <div className="nav-actions">
        <label className="lang">
          <span aria-hidden="true">🌐</span>
          <select value={lang} onChange={(event) => setLang(event.target.value)} aria-label="Language">
            {LANGUAGES.map((item) => <option key={item.code} value={item.code}>{item.native}</option>)}
          </select>
        </label>
        <a className="btn-ghost" href={withLang(KEEPER_URL, lang)}>{t.nav.keeper}</a>
        <a className="btn-gold" href={withLang(ADMIN_URL, lang)}>{t.nav.admin}</a>
      </div>
    </header>
  )
}

function Home() {
  const { t } = useLang()

  return (
    <>
      <ScrollStory />

      <section className="section light" id="verify">
        <div className="wrap narrow">
          <p className="kicker">{t.verify.kicker}</p>
          <h2>{t.verify.title}</h2>
          <p className="lead">{t.verify.text}</p>
          <VerifyPanel />
        </div>
      </section>

      <section className="section dark" id="how">
        <div className="wrap">
          <p className="kicker">{t.how.kicker}</p>
          <h2 className="tagline">{t.how.title}</h2>
          <div className="steps">
            {t.how.steps.map(([number, title, text]) => (
              <article key={number} className="step"><span>{number}</span><h3>{title}</h3><p>{text}</p></article>
            ))}
          </div>
        </div>
      </section>

      <section className="section light">
        <div className="wrap">
          <h2>{t.who.title}</h2>
          <div className="triple">
            {t.who.items.map(([title, text]) => <article key={title}><h3>{title}</h3><p>{text}</p></article>)}
          </div>
        </div>
      </section>

      <section className="section cream" id="schemes">
        <div className="wrap">
          <p className="kicker">{t.schemes.kicker}</p>
          <h2>{t.schemes.title}</h2>
          <p className="lead">{t.schemes.note}</p>
          <div className="schemes">
            {t.schemes.items.map((item) => (
              <article key={item.name} className="scheme">
                <h3>{item.name}</h3>
                <p className="by">{item.by}</p>
                <p>{item.text}</p>
                <a href={item.link} target="_blank" rel="noreferrer">{t.schemes.visit} ↗</a>
              </article>
            ))}
          </div>
          <div className="callout">
            <h3>{t.schemes.closure.title}</h3>
            <p>{t.schemes.closure.text}</p>
          </div>
        </div>
      </section>

      <section className="section light" id="honey">
        <div className="wrap">
          <p className="kicker">{t.honey.kicker}</p>
          <h2>{t.honey.title}</h2>
          <div className="facts">
            {t.honey.items.map(([title, text]) => <article key={title}><h3>{title}</h3><p>{text}</p></article>)}
          </div>
        </div>
      </section>
    </>
  )
}

// The page a QR code opens: /verify?pack_id=...  (or ?batch=HC-...)
function VerifyPage() {
  const { t } = useLang()
  const params = new URLSearchParams(window.location.search)
  const initial = params.get('pack_id') ? { pack: params.get('pack_id') } : params.get('batch') ? { batch: params.get('batch') } : null

  return (
    <section className="section light verify-page">
      <div className="wrap narrow">
        <p className="kicker">{t.verify.kicker}</p>
        <h2>{t.verify.title}</h2>
        <VerifyPanel initial={initial} />
      </div>
    </section>
  )
}

export default function App() {
  const { t } = useLang()
  const onVerifyPage = window.location.pathname.startsWith('/verify')

  return (
    <>
      <Nav alwaysSolid={onVerifyPage} />
      <main>{onVerifyPage ? <VerifyPage /> : <Home />}</main>
      <footer className="footer">
        <img src="/honeychain-logo.png" alt="" />
        <p>{t.footer.line}</p>
        <p className="small">{t.footer.keeperUrlNote}</p>
      </footer>
    </>
  )
}
