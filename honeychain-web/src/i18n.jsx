import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { content } from './content'
import { LANGUAGES, isLanguage } from './languages'

// Extra languages only override the everyday text (menus, buttons, verification labels);
// anything not translated falls back to English.
const extras = import.meta.glob('./lang/*.js', { eager: true })

function merge(base, extra) {
  if (extra === undefined) return base
  if (Array.isArray(base)) return base.map((item, index) => merge(item, extra?.[index]))
  if (base && typeof base === 'object') return Object.fromEntries(Object.keys(base).map((key) => [key, merge(base[key], extra?.[key])]))
  return extra
}

const cache = {}
function contentFor(lang) {
  if (content[lang]) return content[lang]
  cache[lang] = cache[lang] || merge(content.en, extras[`./lang/${lang}.js`]?.default)
  return cache[lang]
}

const LangContext = createContext(null)

export const KEEPER_URL = import.meta.env.VITE_KEEPER_URL || `${window.location.protocol}//${window.location.hostname}:5173/login`
export const ADMIN_URL = import.meta.env.VITE_ADMIN_URL || `${window.location.protocol}//${window.location.hostname}:5174/`
export const API_URL = import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:5000/api`

function initialLang() {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('lang')
    if (isLanguage(fromUrl)) return fromUrl
    const saved = localStorage.getItem('hc_lang')
    if (isLanguage(saved)) return saved
  } catch { /* storage may be blocked */ }
  return 'en'
}

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(initialLang)

  const setLang = useCallback((next) => {
    setLangState(next)
    try { localStorage.setItem('hc_lang', next) } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = LANGUAGES.find((item) => item.code === lang)?.dir || 'ltr'
  }, [lang])

  const value = useMemo(() => ({ lang, setLang, t: contentFor(lang) }), [lang, setLang])
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>
}

export const useLang = () => useContext(LangContext)

// Login links carry the chosen language so the Keeper and Admin apps open in it.
export function withLang(url, lang) {
  const target = new URL(url)
  target.searchParams.set('lang', lang)
  return target.toString()
}

export { LANGUAGES }
