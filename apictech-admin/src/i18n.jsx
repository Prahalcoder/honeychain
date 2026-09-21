import { useEffect, useState } from 'react'
import { hi, hiPatterns } from './hi'
import { LANGUAGES, isLanguage } from './languages'

// Language switch. The apps are written in English; when another language is chosen, text on
// screen is swapped using that language's dictionary (exact phrases). Hindi also has patterns for
// sentences with numbers. Anything not in a dictionary stays in English rather than breaking.
// Dictionaries for the other languages live in ./lang/<code>.js and load only when chosen.
// The same file is used by the Keeper and Admin apps.
const KEY = 'hc_lang'
const ATTRS = ['placeholder', 'title', 'aria-label']
const loaders = import.meta.glob('./lang/*.js')
const dictionaries = { hi }
const listeners = new Set()
let language = 'en'
let observer = null
let busy = false

function readInitial() {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('lang')
    if (isLanguage(fromUrl)) {
      localStorage.setItem(KEY, fromUrl)
      return fromUrl
    }
    const saved = localStorage.getItem(KEY)
    if (isLanguage(saved)) return saved
  } catch { /* storage can be blocked */ }
  return 'en'
}

async function ensureLoaded(code) {
  if (code === 'en' || dictionaries[code]) return
  const load = loaders[`./lang/${code}.js`]
  if (load) dictionaries[code] = (await load()).default
}

function applyDocument(code) {
  document.documentElement.lang = code
  document.documentElement.dir = LANGUAGES.find((item) => item.code === code)?.dir || 'ltr'
}

function translate(text) {
  const trimmed = text.trim()
  if (!trimmed) return null

  const dictionary = dictionaries[language]
  let result = dictionary?.[trimmed]

  if (!result && language === 'hi') {
    for (const [pattern, build] of hiPatterns) {
      const match = trimmed.match(pattern)
      if (match) { result = build(...match.slice(1)); break }
    }
  }

  if (!result) return null
  const lead = text.match(/^\s*/)[0]
  const tail = text.match(/\s*$/)[0]
  return `${lead}${result}${tail}`
}

function processText(node) {
  if (language !== 'en') {
    // React may have replaced our translation with fresh English: treat that as the new original
    const original = node.__hcTranslated !== undefined && node.data === node.__hcTranslated ? node.__hcOriginal : node.data
    const next = translate(original)

    if (next !== null) {
      node.__hcOriginal = original
      node.__hcTranslated = next
      if (node.data !== next) node.data = next
    } else {
      if (node.__hcTranslated !== undefined && node.data === node.__hcTranslated) node.data = node.__hcOriginal
      node.__hcOriginal = undefined
      node.__hcTranslated = undefined
    }
  } else if (node.__hcTranslated !== undefined) {
    if (node.data === node.__hcTranslated) node.data = node.__hcOriginal
    node.__hcOriginal = undefined
    node.__hcTranslated = undefined
  }
}

function processAttributes(element) {
  for (const name of ATTRS) {
    if (!element.hasAttribute?.(name)) continue
    const stash = `data-hc-${name}`
    const shown = element.getAttribute(name)
    const original = element.hasAttribute(stash) && shown === element.getAttribute(`${stash}-hi`) ? element.getAttribute(stash) : shown

    if (language !== 'en') {
      const next = translate(original)
      if (next !== null) {
        element.setAttribute(stash, original)
        element.setAttribute(`${stash}-hi`, next)
        if (shown !== next) element.setAttribute(name, next)
      } else if (element.hasAttribute(stash)) {
        if (shown === element.getAttribute(`${stash}-hi`)) element.setAttribute(name, element.getAttribute(stash))
        element.removeAttribute(stash)
        element.removeAttribute(`${stash}-hi`)
      }
    } else if (element.hasAttribute(stash)) {
      if (shown === element.getAttribute(`${stash}-hi`)) element.setAttribute(name, element.getAttribute(stash))
      element.removeAttribute(stash)
      element.removeAttribute(`${stash}-hi`)
    }
  }
}

function walk(root) {
  if (root.nodeType === Node.TEXT_NODE) return processText(root)
  if (root.nodeType !== Node.ELEMENT_NODE) return
  if (['SCRIPT', 'STYLE', 'CODE', 'PRE'].includes(root.tagName)) return

  processAttributes(root)
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  let node = walker.nextNode()

  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (!['SCRIPT', 'STYLE', 'CODE', 'PRE'].includes(node.parentElement?.tagName)) processText(node)
    } else processAttributes(node)
    node = walker.nextNode()
  }
}

function run(callback) {
  busy = true
  try { callback() } finally { busy = false }
}

export function initLanguage() {
  language = readInitial()
  applyDocument(language)

  observer = new MutationObserver((mutations) => {
    if (busy) return
    run(() => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') processText(mutation.target)
        else if (mutation.type === 'attributes') processAttributes(mutation.target)
        else mutation.addedNodes.forEach(walk)
      }
    })
  })

  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS })
  ensureLoaded(language).then(() => run(() => walk(document.body)))
}

export function getLanguage() {
  return language
}

export async function setLanguage(next) {
  if (!isLanguage(next)) return
  await ensureLoaded(next)
  language = next
  try { localStorage.setItem(KEY, next) } catch { /* ignore */ }
  applyDocument(next)
  run(() => walk(document.body))
  listeners.forEach((listener) => listener(next))
}

// Language picker: every supported language, written in its own script.
export function LanguageToggle({ className = '' }) {
  const [current, setCurrent] = useState(language)

  useEffect(() => {
    listeners.add(setCurrent)
    return () => listeners.delete(setCurrent)
  }, [])

  return (
    <label className={`lang-toggle ${className}`}>
      <span className="lang-globe" aria-hidden="true">🌐</span>
      <select value={current} onChange={(event) => setLanguage(event.target.value)} aria-label="Language">
        {LANGUAGES.map((item) => <option key={item.code} value={item.code}>{item.native}</option>)}
      </select>
    </label>
  )
}

// Re-renders the component when the language is switched.
export function useLanguage() {
  const [current, setCurrent] = useState(language)

  useEffect(() => {
    listeners.add(setCurrent)
    return () => listeners.delete(setCurrent)
  }, [])

  return current
}
