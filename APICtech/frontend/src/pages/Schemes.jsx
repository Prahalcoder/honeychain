import { Link } from 'react-router-dom'
import { ArrowUpRight, ExternalLink, LifeBuoy } from 'lucide-react'

import MainLayout from '../layouts/MainLayout'
import { useLanguage } from '../i18n'
import { schemes } from '../schemesData'

// Colour and emoji for each scheme card, in the same order as the list in schemesData.js.
const LOOKS = [
  { emoji: '🐝', gradient: 'from-[#f86751] to-[#F97360]', image: '/img/bee-1.jpg' },
  { emoji: '📋', gradient: 'from-[#34d3c8] to-[#05968c]', image: '/img/bee-90.jpg' },
  { emoji: '🍯', gradient: 'from-[#f75840] to-[#dc2626]', image: '/img/bee-175.jpg' },
  { emoji: '💰', gradient: 'from-[#60a5fa] to-[#4f46e5]', image: '/img/bee-1.jpg' },
  { emoji: '🛡️', gradient: 'from-[#c084fc] to-[#7c3aed]', image: '/img/bee-90.jpg' },
]

const COPY = {
  en: {
    title: 'Government Schemes',
    hero: 'Support that exists for beekeepers',
    sub: 'Training, colonies and equipment, subsidies, registrations and food-safety licences, with links to the official portals.',
    quick: 'Quick links',
    stuck: 'Stuck on an application or paperwork?',
    stuckText: 'Ask your regional KVIC officer through Help & Support. They know the local process.',
    stuckButton: 'Ask for help',
    links: [
      ['FoSCoS (FSSAI licence)', 'https://foscos.fssai.gov.in'],
      ['National Bee Board / Madhukranti', 'https://nbb.gov.in'],
      ['KVIC', 'https://www.kvic.gov.in'],
      ['KVIC online (PMEGP)', 'https://www.kviconline.gov.in'],
      ['GST portal', 'https://www.gst.gov.in'],
    ],
  },
  hi: {
    title: 'सरकारी योजनाएँ',
    hero: 'मधुमक्खी पालकों के लिए उपलब्ध सहायता',
    sub: 'प्रशिक्षण, मधुमक्खी कॉलोनियाँ और उपकरण, सब्सिडी, पंजीकरण और खाद्य सुरक्षा लाइसेंस, आधिकारिक पोर्टलों के लिंक सहित।',
    quick: 'त्वरित लिंक',
    stuck: 'आवेदन या कागज़ी काम में अटके हैं?',
    stuckText: 'सहायता और समर्थन के ज़रिए अपने क्षेत्रीय KVIC अधिकारी से पूछें। उन्हें स्थानीय प्रक्रिया पता होती है।',
    stuckButton: 'सहायता माँगें',
    links: [
      ['FoSCoS (FSSAI लाइसेंस)', 'https://foscos.fssai.gov.in'],
      ['राष्ट्रीय मधुमक्खी बोर्ड / मधुक्रांति', 'https://nbb.gov.in'],
      ['KVIC', 'https://www.kvic.gov.in'],
      ['KVIC ऑनलाइन (PMEGP)', 'https://www.kviconline.gov.in'],
      ['GST पोर्टल', 'https://www.gst.gov.in'],
    ],
  },
}

// Government schemes and support programmes, with links, shown in the keeper's chosen language.
export default function Schemes() {
  const lang = useLanguage()
  const data = schemes[lang] || schemes.en
  const copy = COPY[lang] || COPY.en

  return (
    <MainLayout title={copy.title}>
      <section className="relative mb-8 overflow-hidden rounded-3xl bg-[#182d34] shadow-[0_24px_60px_rgba(18,42,47,0.28)]">
        <img src="/img/bee-1.jpg" alt="" className="absolute inset-0 h-full w-full object-cover opacity-80" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#102625]/95 via-[#102625]/70 to-transparent" />
        <div className="hex-pattern absolute inset-0 opacity-30" />
        <div className="relative max-w-2xl p-8 text-white sm:p-12">
          <span className="rounded-full bg-[#f86751] px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-[#10262a]">{data.kicker}</span>
          <h1 className="mt-4 text-3xl font-black leading-tight sm:text-4xl">{copy.hero}</h1>
          <p className="mt-3 text-base text-white/85">{copy.sub}</p>
        </div>
      </section>

      <div className="mb-8 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-sm font-black text-[#3a5c5f]">{copy.quick}</span>
        {copy.links.map(([label, url]) => (
          <a key={url + label} href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-[#c0dedc] bg-white px-3.5 py-2 text-sm font-bold text-[#265a64] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#e4f1f0]">
            {label}<ExternalLink size={13} />
          </a>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {data.items.map((item, index) => {
          const look = LOOKS[index % LOOKS.length]
          return (
            <article key={item.name} className="group flex flex-col overflow-hidden rounded-3xl border border-[#c0dedc] bg-white shadow-[0_14px_36px_rgba(30,71,80,0.12)] transition hover:-translate-y-1 hover:shadow-[0_22px_48px_rgba(30,71,80,0.2)]">
              <div className={`relative h-36 overflow-hidden bg-gradient-to-br ${look.gradient}`}>
                <img src={look.image} alt="" className="absolute inset-0 h-full w-full object-cover opacity-30 mix-blend-overlay transition duration-500 group-hover:scale-110" />
                <div className="hex-pattern absolute inset-0 opacity-40" />
                <span className="absolute bottom-3 left-5 grid h-14 w-14 place-items-center rounded-2xl bg-white text-3xl shadow-lg">{look.emoji}</span>
              </div>
              <div className="flex flex-1 flex-col p-6">
                <h2 className="text-xl font-black leading-snug text-[#122c31]">{item.name}</h2>
                <p className="mt-1 text-xs font-bold uppercase tracking-wide text-[#199995]">{item.by}</p>
                <p className="mt-3 flex-1 text-sm leading-6 text-gray-600">{item.text}</p>
                <a href={item.link} target="_blank" rel="noopener noreferrer" className="mt-5 inline-flex items-center justify-center gap-2 rounded-xl bg-[#0F766E] px-4 py-3 text-sm font-bold text-white transition hover:bg-[#24444f]">
                  {data.visit}<ArrowUpRight size={16} />
                </a>
              </div>
            </article>
          )
        })}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div className="rounded-3xl border border-teal-200 bg-gradient-to-br from-teal-50 to-white p-6">
          <h2 className="text-lg font-black text-teal-900">{data.closure.title}</h2>
          <p className="mt-2 text-sm leading-6 text-teal-900/80">{data.closure.text}</p>
        </div>
        <div className="flex flex-col justify-between rounded-3xl border border-orange-200 bg-gradient-to-br from-[#e4f1f0] to-white p-6">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-black text-[#1d464e]"><LifeBuoy size={20} />{copy.stuck}</h2>
            <p className="mt-2 text-sm leading-6 text-[#1d464e]/80">{copy.stuckText}</p>
          </div>
          <Link to="/help" className="mt-4 inline-flex w-fit items-center gap-2 rounded-xl bg-[#0F766E] px-5 py-3 text-sm font-black text-[#10262a] shadow transition hover:bg-[#F97360]">{copy.stuckButton}<ArrowUpRight size={16} /></Link>
        </div>
      </div>

      <p className="mt-6 text-xs text-gray-400">{data.note}</p>
    </MainLayout>
  )
}
