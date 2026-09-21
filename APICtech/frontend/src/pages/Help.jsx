import { useState } from 'react'
import { ChevronDown, ExternalLink, LifeBuoy, Phone, ShieldCheck, UserRound } from 'lucide-react'

import MainLayout from '../layouts/MainLayout'
import { useLanguage } from '../i18n'
import TicketDesk from '../components/TicketDesk'
import { useApi } from '../lib/store'

const CONTENT = {
  en: {
    title: 'Help & Support',
    hero: 'How can we help you today?',
    sub: 'Follow the guide, read the answers to common questions, or send a question straight to your regional KVIC officer.',
    stepsTitle: 'Get going in six steps',
    steps: [
      ['Register and wait for approval', 'Your regional officer checks your registration and licence numbers. Until then you only see a status screen.'],
      ['Add hives and record a harvest', 'Every harvest gets a batch number and is written on the blockchain.'],
      ['Share the lab report', 'Upload the certificate details from an accredited lab in Laboratory. Your officer reviews it and signs it.'],
      ['Packaging unlocks after verification', 'Only a batch with a verified certificate can be packed. QR codes are limited by honey weight divided by jar size.'],
      ['Create QR codes and sell', 'Print the QR on each jar. Buyers scan it on the Honey Chain website to see the verified journey.'],
      ['Keep records and stay compliant', 'Use Buyers, Billing and Finance for your books. Answer inspection notices and read the notice board.'],
    ],
    faqTitle: 'Common questions',
    faq: [
      ['Why can I not use the app after registering?', 'A registration does not activate the account. Your regional KVIC officer must approve it first. You will see the decision here and in your notifications.'],
      ['Why is packaging or QR creation locked?', 'A batch must have a lab certificate that your officer has verified and digitally signed, and the certificate must show that it passed.'],
      ['How many QR codes can I create for a batch?', 'The honey in the batch limits it: honey weight divided by jar size, rounded down. A 5 kg batch in 500 g jars allows 10 jars in total. If you missed a jar you can add it later while honey remains.'],
      ['What can KVIC officers see about my business?', 'Your registration details, batches, lab results and bottles on the blockchain, and only a monthly income total. Line-by-line finance, buyers and invoices stay in your private database.'],
      ['An inspection notice arrived. What should I do?', 'Open Inspections, acknowledge the notice and keep your licence, batch and sales records and honey stock ready on that date. You will see the grade and remarks after the visit.'],
      ['How do I close my organisation?', 'Go to Settings and choose Close organisation. Your officer then completes the government formalities: FSSAI surrender, GST cancellation and other clearances.'],
      ['Can I use the app in my own language?', 'Yes. Choose from Hindi, Tamil, Telugu, Kannada, Malayalam, Marathi, Bengali, Gujarati, Punjabi, Odia or Urdu in the language menu in the top bar. It is remembered for your next visit.'],
    ],
    askTitle: 'Ask your regional officer',
    askSub: 'Your question goes to the KVIC officer who looks after your region. Their answer appears here and in your notifications.',
    subject: 'Subject',
    message: 'Your question',
    send: 'Send question',
    sending: 'Sending…',
    sent: 'Question sent. You will be notified when it is answered.',
    yourQuestions: 'Your questions',
    none: 'You have not asked anything yet.',
    answered: 'Answered',
    waiting: 'Waiting for an answer',
    answerBy: 'Answer',
    officersTitle: 'Who looks after you',
    contactsTitle: 'Official help and portals',
    contacts: [
      ['FSSAI helpline', '1800-112-100 (toll free). Check fssai.gov.in for the current number.', 'https://fssai.gov.in'],
      ['FoSCoS food licence portal', 'Apply for or renew your FSSAI licence.', 'https://foscos.fssai.gov.in'],
      ['National Bee Board / Madhukranti', 'Beekeeper registration and NBHM schemes.', 'https://nbb.gov.in'],
      ['KVIC', 'Honey Mission and PMEGP.', 'https://www.kvic.gov.in'],
    ],
  },
  hi: {
    title: 'सहायता और समर्थन',
    hero: 'आज हम आपकी क्या मदद कर सकते हैं?',
    sub: 'गाइड देखें, आम सवालों के जवाब पढ़ें, या अपना सवाल सीधे अपने क्षेत्रीय KVIC अधिकारी को भेजें।',
    stepsTitle: 'छह क़दमों में शुरुआत करें',
    steps: [
      ['पंजीकरण करें और स्वीकृति का इंतज़ार करें', 'आपके क्षेत्रीय अधिकारी आपका पंजीकरण और लाइसेंस नंबर जाँचते हैं। तब तक आपको केवल स्थिति स्क्रीन दिखती है।'],
      ['छत्ते जोड़ें और फ़सल दर्ज करें', 'हर फ़सल को बैच नंबर मिलता है और वह ब्लॉकचेन पर दर्ज होती है।'],
      ['लैब रिपोर्ट साझा करें', 'प्रयोगशाला में मान्यता प्राप्त लैब के प्रमाणपत्र का विवरण भरें। आपके अधिकारी उसे जाँचकर हस्ताक्षर करते हैं।'],
      ['सत्यापन के बाद पैकेजिंग खुलती है', 'केवल सत्यापित प्रमाणपत्र वाला बैच ही पैक हो सकता है। QR की संख्या शहद के वज़न और जार के आकार से सीमित है।'],
      ['QR कोड बनाएँ और बेचें', 'हर जार पर QR छापें। ख़रीदार उसे हनी चेन वेबसाइट पर स्कैन करके सत्यापित सफ़र देखते हैं।'],
      ['रिकॉर्ड रखें और नियमों का पालन करें', 'हिसाब के लिए ख़रीदार, बिलिंग और वित्त का उपयोग करें। निरीक्षण सूचनाओं का जवाब दें और सूचना पट्ट पढ़ें।'],
    ],
    faqTitle: 'आम सवाल',
    faq: [
      ['पंजीकरण के बाद मैं ऐप क्यों नहीं चला पा रहा/रही हूँ?', 'पंजीकरण से खाता सक्रिय नहीं होता। पहले आपके क्षेत्रीय KVIC अधिकारी को उसे स्वीकृत करना होता है। निर्णय यहाँ और आपकी सूचनाओं में दिखेगा।'],
      ['पैकेजिंग या QR बनाना बंद क्यों है?', 'बैच का लैब प्रमाणपत्र आपके अधिकारी द्वारा सत्यापित और डिजिटल हस्ताक्षरित होना चाहिए, और वह उत्तीर्ण दिखाना चाहिए।'],
      ['एक बैच के लिए कितने QR कोड बन सकते हैं?', 'बैच में उपलब्ध शहद से सीमा तय होती है: शहद का वज़न ÷ जार का आकार, नीचे की ओर पूर्णांक। 500 ग्राम के जार में 5 किग्रा बैच से कुल 10 जार बनते हैं। कोई जार छूट जाए तो शहद बचे रहने तक बाद में जोड़ सकते हैं।'],
      ['KVIC अधिकारी मेरे व्यवसाय के बारे में क्या देख सकते हैं?', 'आपका पंजीकरण विवरण, बैच, लैब परिणाम और ब्लॉकचेन पर बोतलें, और केवल मासिक आय का कुल योग। पंक्ति-दर-पंक्ति वित्त, ख़रीदार और बिल आपके निजी डेटाबेस में रहते हैं।'],
      ['निरीक्षण की सूचना आई है। मुझे क्या करना चाहिए?', 'निरीक्षण खोलें, सूचना स्वीकार करें और उस तारीख़ को अपने लाइसेंस, बैच और बिक्री रिकॉर्ड और शहद स्टॉक तैयार रखें। दौरे के बाद आपको ग्रेड और टिप्पणियाँ दिखेंगी।'],
      ['मैं अपना संगठन कैसे बंद करूँ?', 'सेटिंग्स में जाकर संगठन बंद करें चुनें। फिर आपके अधिकारी सरकारी औपचारिकताएँ पूरी करते हैं: FSSAI सरेंडर, GST रद्दीकरण और अन्य मंज़ूरियाँ।'],
      ['क्या मैं ऐप अपनी भाषा में इस्तेमाल कर सकता/सकती हूँ?', 'हाँ। ऊपर की पट्टी के भाषा मेनू से हिंदी, तमिल, तेलुगु, कन्नड़, मलयालम, मराठी, बंगाली, गुजराती, पंजाबी, ओड़िया या उर्दू चुनें। अगली बार भी यही भाषा रहेगी।'],
    ],
    askTitle: 'अपने क्षेत्रीय अधिकारी से पूछें',
    askSub: 'आपका सवाल आपके क्षेत्र के KVIC अधिकारी तक जाता है। उनका जवाब यहाँ और आपकी सूचनाओं में दिखेगा।',
    subject: 'विषय',
    message: 'आपका सवाल',
    send: 'सवाल भेजें',
    sending: 'भेजा जा रहा है…',
    sent: 'सवाल भेज दिया गया। जवाब मिलने पर आपको सूचित किया जाएगा।',
    yourQuestions: 'आपके सवाल',
    none: 'आपने अभी तक कुछ नहीं पूछा।',
    answered: 'उत्तर मिला',
    waiting: 'उत्तर की प्रतीक्षा',
    answerBy: 'उत्तर',
    officersTitle: 'आपकी देखरेख कौन करता है',
    contactsTitle: 'आधिकारिक सहायता और पोर्टल',
    contacts: [
      ['FSSAI हेल्पलाइन', '1800-112-100 (टोल फ़्री)। वर्तमान नंबर के लिए fssai.gov.in देखें।', 'https://fssai.gov.in'],
      ['FoSCoS खाद्य लाइसेंस पोर्टल', 'FSSAI लाइसेंस के लिए आवेदन या नवीनीकरण करें।', 'https://foscos.fssai.gov.in'],
      ['राष्ट्रीय मधुमक्खी बोर्ड / मधुक्रांति', 'मधुमक्खी पालक पंजीकरण और NBHM योजनाएँ।', 'https://nbb.gov.in'],
      ['KVIC', 'हनी मिशन और PMEGP।', 'https://www.kvic.gov.in'],
    ],
  },
}

const ROLE = { REGIONAL_OFFICER: 'Regional officer', STATE_OFFICER: 'State officer' }
const when = (value) => new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

// Help centre: a guide, common questions, and a line to the keeper's regional officer.
export default function Help() {
  const lang = useLanguage()
  const copy = CONTENT[lang] || CONTENT.en
  const { data } = useApi('/company/support')
  const [open, setOpen] = useState(0)

  return (
    <MainLayout title={copy.title}>
      <section className="relative mb-8 overflow-hidden rounded-3xl bg-gradient-to-br from-[#f86751] via-[#0F766E] to-[#0F766E] shadow-[0_24px_60px_rgba(41,97,109,0.3)]">
        <img src="/img/bee-175.jpg" alt="" className="absolute inset-y-0 right-0 hidden h-full w-1/2 object-cover opacity-90 md:block" style={{ maskImage: 'linear-gradient(to right, transparent, black 45%)', WebkitMaskImage: 'linear-gradient(to right, transparent, black 45%)' }} />
        <div className="hex-pattern absolute inset-0 opacity-30" />
        <div className="relative max-w-xl p-8 sm:p-12">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white/90 text-[#178c88] shadow"><LifeBuoy size={28} /></span>
          <h1 className="mt-4 text-3xl font-black leading-tight text-[#0d1f22] sm:text-4xl">{copy.hero}</h1>
          <p className="mt-3 text-base font-medium text-[#143036]">{copy.sub}</p>
        </div>
      </section>

      <h2 className="mb-4 text-xl font-black">{copy.stepsTitle}</h2>
      <div className="mb-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {copy.steps.map(([title, text], index) => (
          <div key={title} className="flex gap-4 rounded-2xl border border-[#c0dedc] bg-white p-5 shadow-sm">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#f86751] to-[#F97360] text-lg font-black text-[#10262a]">{index + 1}</span>
            <div><h3 className="font-black leading-snug">{title}</h3><p className="mt-1 text-sm text-gray-600">{text}</p></div>
          </div>
        ))}
      </div>

      <div className="grid gap-8 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <h2 className="mb-4 text-xl font-black">{copy.faqTitle}</h2>
          <div className="space-y-3">
            {copy.faq.map(([question, answer], index) => (
              <div key={question} className="overflow-hidden rounded-2xl border border-[#c0dedc] bg-white shadow-sm">
                <button onClick={() => setOpen(open === index ? -1 : index)} className="flex w-full items-center justify-between gap-4 p-4 text-left font-bold hover:bg-[#f4fbfb]">
                  {question}
                  <ChevronDown size={18} className={`shrink-0 transition ${open === index ? 'rotate-180' : ''}`} />
                </button>
                {open === index && <p className="border-t border-[#d5e9e8] bg-[#f8fcfc] p-4 text-sm leading-6 text-gray-700">{answer}</p>}
              </div>
            ))}
          </div>

          <h2 className="mb-4 mt-10 text-xl font-black">{copy.contactsTitle}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {copy.contacts.map(([name, text, url]) => (
              <a key={name} href={url} target="_blank" rel="noopener noreferrer" className="flex gap-3 rounded-2xl border border-[#c0dedc] bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:bg-[#f4fbfb]">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-600"><Phone size={18} /></span>
                <span><span className="flex items-center gap-1 font-black">{name}<ExternalLink size={12} /></span><span className="mt-0.5 block text-sm text-gray-600">{text}</span></span>
              </a>
            ))}
          </div>
        </div>

        <div className="space-y-6 xl:col-span-2">
          <TicketDesk />

          <div className="rounded-3xl border border-[#cfe8e5] bg-white p-6 shadow-sm">
            <h3 className="flex items-center gap-2 font-black"><ShieldCheck size={18} className="text-[#0F766E]" />{copy.officersTitle}</h3>
            <div className="mt-3 space-y-2">
              {(data?.officers || []).map((officer) => (
                <div key={officer.name} className="flex items-center gap-3 rounded-xl bg-[#f2faf9] p-3">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-[#0F766E] text-white"><UserRound size={17} /></span>
                  <span className="text-sm"><b>{officer.name}</b><span className="block text-xs text-gray-500">{ROLE[officer.role]}{officer.role === 'REGIONAL_OFFICER' ? ` · ${officer.region}` : ''}, {officer.state}</span></span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </MainLayout>
  )
}
