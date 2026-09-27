import { useEffect, useRef, useState } from 'react'
import { Bot, Mic, MicOff, Send, Volume2, VolumeX, X } from 'lucide-react'
import { useLanguage } from '../i18n'
import { LANGUAGES } from '../languages'
import { FALLBACK, GREETING, LANGS, SPEECH, TOPICS, UI, findAnswer, languageOf } from '../lib/assistantKnowledge'

// The in-app assistant: a small round button at the bottom right that opens a chat. Questions can be typed or spoken,
// and answers are shown and (when the device has a voice for the language) read aloud. It works offline from the
// built-in knowledge in lib/assistantKnowledge.js; no API is called. Voice uses the browser's own speech features.
const Recognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null
const idx = (code) => Math.max(0, LANGS.indexOf(code))
const READ_KEY = 'hc_assistant_read_aloud'

function voiceFor(code) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null
  const voices = window.speechSynthesis.getVoices()
  return voices.find((voice) => voice.lang?.toLowerCase().replace('_', '-') === SPEECH[code].toLowerCase())
    || voices.find((voice) => voice.lang?.toLowerCase().startsWith(code)) || null
}

export default function Assistant() {
  const appLanguage = useLanguage()
  const [open, setOpen] = useState(false)
  const [lang, setLang] = useState(LANGS.includes(appLanguage) ? appLanguage : 'en')
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [listening, setListening] = useState(false)
  const [readAloud, setReadAloud] = useState(() => { try { return localStorage.getItem(READ_KEY) !== 'off' } catch { return true } })
  const [note, setNote] = useState('')
  const recognition = useRef(null)
  const list = useRef(null)
  const ui = UI[lang] || UI.en
  const rtl = lang === 'ur'

  // Follow the app's language when it changes.
  useEffect(() => { if (LANGS.includes(appLanguage)) setLang(appLanguage) }, [appLanguage])

  // Voices load late in some browsers.
  useEffect(() => {
    if (!window.speechSynthesis) return undefined
    const load = () => window.speechSynthesis.getVoices()
    load()
    window.speechSynthesis.addEventListener?.('voiceschanged', load)
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', load)
  }, [])

  useEffect(() => { if (open && messages.length === 0) setMessages([{ from: 'bot', text: GREETING.answer[idx(lang)], lang }]) }, [open, lang, messages.length])
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }) }, [messages])
  useEffect(() => () => { recognition.current?.abort?.(); window.speechSynthesis?.cancel() }, [])

  function speak(text, code) {
    if (!readAloud || !window.speechSynthesis) return
    const voice = voiceFor(code)
    if (!voice && code !== 'en') { setNote(UI[code]?.[3] || UI.en[3]); return }
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = SPEECH[code]
    if (voice) utterance.voice = voice
    utterance.rate = 0.95
    window.speechSynthesis.speak(utterance)
  }

  function ask(question) {
    const text = String(question || '').trim()
    if (!text) return
    const answerLang = languageOf(text, lang)
    const topic = findAnswer(text)
    const answer = topic ? topic.answer[idx(answerLang)] : FALLBACK[idx(answerLang)]
    setNote('')
    setMessages((current) => [...current, { from: 'user', text }, { from: 'bot', text: answer, lang: answerLang }])
    setInput('')
    speak(answer, answerLang)
  }

  function pickTopic(topic) {
    const answer = topic.answer[idx(lang)]
    setNote('')
    setMessages((current) => [...current, { from: 'user', text: topic.title[idx(lang)] }, { from: 'bot', text: answer, lang }])
    speak(answer, lang)
  }

  function toggleMic() {
    if (!Recognition) { setNote(ui[4]); return }
    if (listening) { recognition.current?.stop(); return }
    window.speechSynthesis?.cancel()
    const rec = new Recognition()
    rec.lang = SPEECH[lang]
    rec.interimResults = true
    rec.maxAlternatives = 1
    rec.onresult = (event) => {
      const said = Array.from(event.results).map((result) => result[0].transcript).join(' ')
      setInput(said)
      if (event.results[event.results.length - 1].isFinal) ask(said)
    }
    rec.onerror = (event) => { setNote(event.error === 'not-allowed' ? 'Microphone permission was denied.' : event.error === 'no-speech' ? '' : `Voice input stopped (${event.error}).`) }
    rec.onend = () => setListening(false)
    recognition.current = rec
    setNote('')
    setListening(true)
    try { rec.start() } catch { setListening(false) }
  }

  function toggleRead() {
    const next = !readAloud
    setReadAloud(next)
    if (!next) window.speechSynthesis?.cancel()
    try { localStorage.setItem(READ_KEY, next ? 'on' : 'off') } catch { /* ignore */ }
  }

  return <>
    {open && <section dir={rtl ? 'rtl' : 'ltr'} className="fixed bottom-24 right-4 z-[65] flex h-[min(560px,calc(100vh-8rem))] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl border border-[#c6e2e0] bg-white shadow-[0_24px_70px_rgba(18,44,49,0.22)]" aria-label={ui[0]}>
      <header className="flex items-center gap-2 bg-[#0f3d3e] px-4 py-3 text-white">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-white/15"><Bot size={17} /></span>
        <b className="flex-1 text-sm">{ui[0]}</b>
        <select value={lang} onChange={(event) => { setLang(event.target.value); setNote('') }} aria-label="Language" className="!min-h-0 !w-auto !rounded-lg !border-0 !bg-white/15 !px-2 !py-1 !text-xs !font-bold !text-white outline-none [&>option]:text-[#122c31]">
          {LANGUAGES.map((item) => <option key={item.code} value={item.code}>{item.native}</option>)}
        </select>
        <button onClick={toggleRead} title={ui[6]} aria-label={ui[6]} className="rounded-lg p-1.5 hover:bg-white/15">{readAloud ? <Volume2 size={16} /> : <VolumeX size={16} />}</button>
        <button onClick={() => { setOpen(false); recognition.current?.abort?.(); window.speechSynthesis?.cancel() }} aria-label="Close" className="rounded-lg p-1.5 hover:bg-white/15"><X size={16} /></button>
      </header>

      <div ref={list} className="flex-1 space-y-3 overflow-y-auto bg-[#f6fbfb] p-4">
        {messages.map((message, index) => <div key={index} className={`flex ${message.from === 'user' ? 'justify-end' : 'justify-start'}`}>
          <p dir="auto" className={`max-w-[85%] whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-sm leading-6 ${message.from === 'user' ? 'rounded-br-md bg-[#0F766E] text-white' : 'rounded-bl-md border border-[#dcecea] bg-white text-[#122c31]'}`}>{message.text}</p>
        </div>)}
      </div>

      <div className="border-t border-[#e3efee] px-3 pt-2">
        <p className="px-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">{ui[5]}</p>
        <div className="flex gap-1.5 overflow-x-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TOPICS.map((topic) => <button key={topic.id} onClick={() => pickTopic(topic)} className="shrink-0 rounded-full border border-[#cfe5e3] bg-white px-3 py-1 text-xs font-semibold text-[#0F766E] hover:bg-[#eef7f6]">{topic.title[idx(lang)]}</button>)}
        </div>
      </div>

      {(listening || note) && <p className="px-4 pb-1 text-xs font-semibold text-[#c2412d]">{listening ? ui[2] : note}</p>}
      <form onSubmit={(event) => { event.preventDefault(); ask(input) }} className="flex items-center gap-2 border-t border-[#e3efee] p-3">
        <input value={input} onChange={(event) => setInput(event.target.value)} placeholder={ui[1]} dir="auto" className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-[#0F766E]" />
        <button type="button" onClick={toggleMic} aria-label="Speak" title="Speak" className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${listening ? 'animate-pulse bg-[#F97360] text-white' : 'bg-[#eef7f6] text-[#0F766E]'} ${Recognition ? '' : 'opacity-50'}`}>{listening ? <MicOff size={17} /> : <Mic size={17} />}</button>
        <button type="submit" aria-label="Send" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#0F766E] text-white"><Send size={16} /></button>
      </form>
    </section>}

    <button onClick={() => setOpen((value) => !value)} aria-label={ui[0]} title={ui[0]} className="fixed bottom-5 right-5 z-[65] grid h-14 w-14 place-items-center rounded-full bg-[#0F766E] text-white shadow-[0_12px_30px_rgba(15,118,110,0.4)] transition hover:scale-105">
      {open ? <X size={22} /> : <Bot size={24} />}
    </button>
  </>
}
