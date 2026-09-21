import { useState } from 'react'
import { BookOpen, CheckCircle2, Landmark, MapPin, MessageCircle, ShieldCheck, UserRound, Users } from 'lucide-react'

import { useLive } from '../api'
import { useLanguage } from '../i18n'
import { Empty, PageIntro, ROLE_LABELS } from '../ui'
import Tickets from './Tickets'

const CONTENT = {
  en: {
    roles: [
      {
        role: 'REGIONAL_OFFICER',
        title: 'Regional Officer',
        scope: 'One region of one state. The first point of contact for keepers.',
        can: ['Approve or reject organisation registrations in your region', 'Review lab results with the AI analysis and sign them digitally (your password confirms the signature)', 'Schedule inspections, file visit reports and issue closure notices', 'Complete the government formalities when an organisation closes', 'Post notices for the keepers of your region and answer their questions'],
        cannot: ['See income figures, or anything in another region', 'Send notices to officers or to other regions'],
        escalate: 'Report problems to your State Officer.',
      },
      {
        role: 'STATE_OFFICER',
        title: 'State Officer',
        scope: 'All regions of one state. Supervises the regional officers.',
        can: ['See every organisation, batch, monthly income total and blockchain record in the state', 'Read notices posted by your regional officers (oversight) and the national office', 'Suspend or reinstate organisations, schedule inspections, issue closure notices', 'Post notices to keepers and regional officers of your state, all of it or chosen regions', 'Compare regions: approval speed, lab verification speed, production'],
        cannot: ['Act outside your state', 'Change officer accounts (KVIC head only)'],
        escalate: 'Report problems to the KVIC Head office.',
      },
      {
        role: 'KVIC_HEAD',
        title: 'KVIC Head',
        scope: 'The national programme. Supervises state and regional officers.',
        can: ['See every state, region, organisation and the whole blockchain', 'Create, deactivate and reset officer accounts and read the full activity log', 'Send notices to everyone, or only to state officers, regional officers, chosen states or regions, or individual keepers', 'Suspend, close or reinstate any organisation'],
        cannot: ['Change records already sealed on the blockchain (nobody can)'],
        escalate: 'Escalate policy questions to the Ministry / KVIC leadership.',
      },
    ],
    guides: [
      ['Approve a registration', 'Review queue → Registrations. Check the registration number, FSSAI licence and region, then accept or reject with a note. The keeper sees your decision at once.'],
      ['Verify a lab result', 'Review queue → Lab results. Read the AI analysis (it only assists), compare with the certificate, then verify and sign with your password. Packaging unlocks for the keeper only after this.'],
      ['Inspect an organisation', 'Inspections → Schedule inspection. Pick a date at least tomorrow. After the visit, file the report: checklist, stock counted, grade A to D, outcome and remarks. A grade C or D, or a closure recommendation, lets you issue a closure notice.'],
      ['Close an organisation', 'Start from an organisation or an inspection. Complete the checklist: FSSAI surrender on FoSCoS, GST cancellation if registered, KVIC / Madhukranti withdrawal, scheme dues and records. The blockchain keeps the history.'],
      ['Send a notice', 'Notice board → New notice. Regional officers reach their own keepers, state officers their state, and the KVIC head can pick any mix of audiences. Officer-only notices are never visible to keepers.'],
      ['Answer a keeper question', 'Help & roles → Keeper questions. Your answer appears in the keeper’s Help & Support page and notifications.'],
    ],
  },
  hi: {
    roles: [
      {
        role: 'REGIONAL_OFFICER',
        title: 'क्षेत्रीय अधिकारी',
        scope: 'एक राज्य का एक क्षेत्र। कीपर्स के लिए पहला संपर्क।',
        can: ['अपने क्षेत्र में संगठन पंजीकरण स्वीकृत या अस्वीकृत करना', 'AI विश्लेषण के साथ लैब परिणाम जाँचना और डिजिटल हस्ताक्षर करना (आपका पासवर्ड हस्ताक्षर की पुष्टि करता है)', 'निरीक्षण निर्धारित करना, दौरे की रिपोर्ट दाख़िल करना और बंदी नोटिस जारी करना', 'संगठन बंद होने पर सरकारी औपचारिकताएँ पूरी करना', 'अपने क्षेत्र के कीपर्स के लिए सूचनाएँ डालना और उनके सवालों के जवाब देना'],
        cannot: ['आय के आँकड़े या किसी अन्य क्षेत्र की जानकारी देखना', 'अधिकारियों या अन्य क्षेत्रों को सूचना भेजना'],
        escalate: 'समस्याएँ अपने राज्य अधिकारी को बताएँ।',
      },
      {
        role: 'STATE_OFFICER',
        title: 'राज्य अधिकारी',
        scope: 'एक राज्य के सभी क्षेत्र। क्षेत्रीय अधिकारियों की निगरानी करते हैं।',
        can: ['राज्य के हर संगठन, बैच, मासिक आय योग और ब्लॉकचेन रिकॉर्ड देखना', 'अपने क्षेत्रीय अधिकारियों (निगरानी) और राष्ट्रीय कार्यालय की सूचनाएँ पढ़ना', 'संगठनों को निलंबित या बहाल करना, निरीक्षण निर्धारित करना, बंदी नोटिस जारी करना', 'राज्य के कीपर्स और क्षेत्रीय अधिकारियों को सूचनाएँ भेजना, पूरे राज्य को या चुने क्षेत्रों को', 'क्षेत्रों की तुलना: अनुमोदन की गति, लैब सत्यापन की गति, उत्पादन'],
        cannot: ['अपने राज्य के बाहर कार्रवाई करना', 'अधिकारी खाते बदलना (केवल KVIC प्रमुख)'],
        escalate: 'समस्याएँ KVIC प्रमुख कार्यालय को बताएँ।',
      },
      {
        role: 'KVIC_HEAD',
        title: 'KVIC प्रमुख',
        scope: 'राष्ट्रीय कार्यक्रम। राज्य और क्षेत्रीय अधिकारियों की निगरानी करते हैं।',
        can: ['हर राज्य, क्षेत्र, संगठन और पूरा ब्लॉकचेन देखना', 'अधिकारी खाते बनाना, निष्क्रिय करना और रीसेट करना तथा पूरा गतिविधि लॉग पढ़ना', 'सभी को, या केवल राज्य अधिकारियों, क्षेत्रीय अधिकारियों, चुने राज्यों या क्षेत्रों, या अलग-अलग कीपर्स को सूचना भेजना', 'किसी भी संगठन को निलंबित, बंद या बहाल करना'],
        cannot: ['ब्लॉकचेन पर सील हो चुके रिकॉर्ड बदलना (कोई नहीं बदल सकता)'],
        escalate: 'नीतिगत प्रश्न मंत्रालय / KVIC नेतृत्व को भेजें।',
      },
    ],
    guides: [
      ['पंजीकरण स्वीकृत करें', 'समीक्षा कतार → पंजीकरण। पंजीकरण संख्या, FSSAI लाइसेंस और क्षेत्र जाँचें, फिर नोट के साथ स्वीकार या अस्वीकार करें। कीपर को आपका निर्णय तुरंत दिखता है।'],
      ['लैब परिणाम सत्यापित करें', 'समीक्षा कतार → लैब परिणाम। AI विश्लेषण पढ़ें (वह केवल सहायता करता है), प्रमाणपत्र से मिलान करें, फिर पासवर्ड से सत्यापित करें और हस्ताक्षर करें। इसके बाद ही कीपर की पैकेजिंग खुलती है।'],
      ['किसी संगठन का निरीक्षण करें', 'निरीक्षण → निरीक्षण निर्धारित करें। कम से कम कल की तारीख़ चुनें। दौरे के बाद रिपोर्ट दाख़िल करें: जाँच सूची, गिना गया स्टॉक, ग्रेड A से D, परिणाम और टिप्पणियाँ। ग्रेड C या D, या बंदी की अनुशंसा पर आप बंदी नोटिस जारी कर सकते हैं।'],
      ['किसी संगठन को बंद करें', 'संगठन या निरीक्षण से शुरू करें। जाँच सूची पूरी करें: FoSCoS पर FSSAI सरेंडर, पंजीकृत हो तो GST रद्दीकरण, KVIC / मधुक्रांति से वापसी, योजना बकाया और रिकॉर्ड। ब्लॉकचेन इतिहास सुरक्षित रखता है।'],
      ['सूचना भेजें', 'सूचना पट्ट → नई सूचना। क्षेत्रीय अधिकारी अपने कीपर्स तक, राज्य अधिकारी अपने राज्य तक पहुँचते हैं, और KVIC प्रमुख कोई भी मिश्रण चुन सकते हैं। केवल-अधिकारी सूचनाएँ कीपर्स को कभी नहीं दिखतीं।'],
      ['कीपर के सवाल का जवाब दें', 'सहायता और भूमिकाएँ → कीपर के सवाल। आपका उत्तर कीपर के सहायता पृष्ठ और सूचनाओं में दिखता है।'],
    ],
  },
}

const UI = {
  en: { roles: 'Roles & responsibilities', directory: 'Who covers what', tickets: 'Tickets', guide: 'Quick guides', you: 'Your role', can: 'What you can do', cannot: 'What you cannot do', escalate: 'Escalation' },
  hi: { roles: 'भूमिकाएँ और ज़िम्मेदारियाँ', directory: 'कौन क्या संभालता है', tickets: 'टिकट', guide: 'त्वरित गाइड', you: 'आपकी भूमिका', can: 'आप क्या कर सकते हैं', cannot: 'आप क्या नहीं कर सकते', escalate: 'बात आगे कहाँ ले जाएँ' },
}

// Help for officers: what each role does, who covers each state and region, and the keepers' questions.
export default function Help({ user, params, notify, refreshOverview, overview }) {
  const lang = useLanguage()
  const copy = CONTENT[lang] || CONTENT.en
  const ui = UI[lang] || UI.en
  const [tab, setTab] = useState(params.tab || 'roles')
  const directory = useLive('/admin/directory', { interval: 30000 })
  const alerts = overview?.openSupport || 0

  return (
    <>
      <PageIntro
        eyebrow="Help & support"
        title="Help & roles"
        copy="What each officer level can do, who looks after every state and region, and the tickets keepers have opened."
      />

      <div className="tabs">
        <button className={`tab ${tab === 'roles' ? 'active' : ''}`} onClick={() => setTab('roles')}><ShieldCheck size={15} />{ui.roles}</button>
        <button className={`tab ${tab === 'directory' ? 'active' : ''}`} onClick={() => setTab('directory')}><MapPin size={15} />{ui.directory}</button>
        <button className={`tab ${tab === 'tickets' ? 'active' : ''}`} onClick={() => setTab('tickets')}><MessageCircle size={15} />{ui.tickets} {alerts > 0 && <b>{alerts}</b>}</button>
        <button className={`tab ${tab === 'guide' ? 'active' : ''}`} onClick={() => setTab('guide')}><BookOpen size={15} />{ui.guide}</button>
      </div>

      {tab === 'roles' && (
        <div className="role-grid">
          {copy.roles.map((role) => (
            <section key={role.role} className={`panel role-card role-${role.role} ${role.role === user.role ? 'mine' : ''}`}>
              <div className="role-head">
                <span className="role-icon">{role.role === 'KVIC_HEAD' ? <Landmark size={22} /> : role.role === 'STATE_OFFICER' ? <Users size={22} /> : <UserRound size={22} />}</span>
                <div><h2>{role.title}</h2><p>{role.scope}</p></div>
                {role.role === user.role && <span className="you-chip">{ui.you}</span>}
              </div>
              <h4>{ui.can}</h4>
              <ul className="tick-list">{role.can.map((line) => <li key={line}><CheckCircle2 size={15} />{line}</li>)}</ul>
              <h4>{ui.cannot}</h4>
              <ul className="cross-list">{role.cannot.map((line) => <li key={line}>{line}</li>)}</ul>
              <p className="escalate"><b>{ui.escalate}:</b> {role.escalate}</p>
            </section>
          ))}
        </div>
      )}

      {tab === 'directory' && <Directory data={directory.data} user={user} />}

      {tab === 'tickets' && <Tickets user={user} notify={notify} refreshOverview={refreshOverview} params={params} />}

      {tab === 'guide' && (
        <div className="guide-grid">
          {copy.guides.map(([title, text], index) => (
            <section className="panel guide-card" key={title}><span className="guide-num">{index + 1}</span><div><h3>{title}</h3><p>{text}</p></div></section>
          ))}
        </div>
      )}
    </>
  )
}

function Officer({ officer }) {
  return (
    <div className={`officer-line ${officer.active ? '' : 'inactive'}`}>
      <UserRound size={15} /><span><b>{officer.name}</b><small>{officer.username}{officer.active ? '' : ' · inactive'}</small></span>
    </div>
  )
}

function Directory({ data, user }) {
  if (!data) return <Empty>Loading the directory…</Empty>

  return (
    <div className="directory">
      <section className="panel dir-national">
        <h2><Landmark size={18} /> National office</h2>
        <div className="officer-list">{data.national.map((officer) => <Officer key={officer.id} officer={officer} />)}</div>
        <small>{ROLE_LABELS[user.role]} · you are signed in as <b>{user.name}</b></small>
      </section>

      {data.states.map((state) => (
        <section className="panel dir-state" key={state.state}>
          <h2><MapPin size={18} /> {state.state}</h2>
          <div className="dir-label">State officer</div>
          <div className="officer-list">{state.officers.length ? state.officers.map((officer) => <Officer key={officer.id} officer={officer} />) : <small>No state officer assigned</small>}</div>
          <div className="dir-label">Regions</div>
          <div className="region-grid">
            {state.regions.map((region) => (
              <div className="region-card" key={region.region}>
                <strong>{region.region}</strong>
                <small>{region.organizations.approved || 0} approved · {region.organizations.pending || 0} pending</small>
                {region.officers.length ? region.officers.map((officer) => <Officer key={officer.id} officer={officer} />) : <small>No officer assigned</small>}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
