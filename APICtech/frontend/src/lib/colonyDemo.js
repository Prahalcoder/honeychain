// Colony health for one hive: the components that make up the score, how each is judged, and a 7-day demo history.
//
// The history is DEMO data until the hive microphone (INMP441) and the extra sensors are installed: it is generated
// from the hive code, so every hive (H001, H002 and any new one) gets its own stable sample. When the ESP32 is
// connected, the live brood temperature, humidity and CO2 replace the demo values for "now".
//
// Rules (the same numbers the firmware and the hive monitor use):
//   brood 34-35.5 °C is ideal; a colony that follows the outside temperature is weak or queenless;
//   humidity 50-65 %; CO2 above 1200 ppm is an alert only (the fan runs for heat, never for CO2);
//   a normal colony hums at 200-300 Hz; a loud 300-380 Hz "roar" suggests a queenless colony;
//   queen piping near 400-500 Hz with a sudden weight drop means the colony is preparing to swarm.

export const STEP_HOURS = 3
export const DAYS = 7
const IDEAL_BROOD = 34.75

export const COMPONENTS = [
  { key: 'brood', label: 'Brood temperature', weight: 20, sensor: 'Brood probes (DS18B20 / DHT11)' },
  { key: 'thermo', label: 'Thermoregulation', weight: 15, sensor: 'Brood probes + outside sensor / weather API' },
  { key: 'humidity', label: 'Brood humidity', weight: 10, sensor: 'Humidity sensor' },
  { key: 'co2', label: 'CO₂ inside the hive', weight: 10, sensor: 'CO₂ sensor (alert only)' },
  { key: 'weight', label: 'Hive weight & stores', weight: 10, sensor: 'Load cell + HX711' },
  { key: 'sound', label: 'Hive sound', weight: 10, sensor: 'INMP441 microphone (100-600 Hz, FFT)' },
  { key: 'queen', label: 'Queen status', weight: 15, sensor: 'Sound model' },
  { key: 'swarm', label: 'Swarm risk', weight: 10, sensor: 'Sound + weight' },
]

const POINTS = { GOOD: 100, WATCH: 60, CRITICAL: 15 }
const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits

function hashSeed(text) {
  let hash = 2166136261
  for (const char of String(text)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619) }
  return hash >>> 0
}

function random(seed) {
  let state = seed
  return () => {
    state = (state + 0x6D2B79F5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Critical and warning episodes placed in each hive's history. Each hive gets four of them, in its own order.
const EPISODES = {
  HEAT: { steps: 2, note: 'Brood overheating: 41 °C outside, fan ON', apply: (r) => { r.outside = 41.2; r.brood = 36.9; r.humidity = 44 } },
  CO2: { steps: 1, note: 'CO₂ 1,480 ppm at night: alert only, fan stays OFF', apply: (r) => { r.co2 = 1480 } },
  QUEENLESS: { steps: 3, note: 'Loud 330 Hz roar: queenless colony suspected', apply: (r, rnd) => { r.soundHz = 328 + Math.round(rnd() * 8); r.soundDb = 63; r.brood = round(33.3 + rnd() * 0.4); r.queen = 'Queenless suspected' } },
  SWARM: { steps: 2, note: 'Queen piping ~450 Hz and 2.1 kg weight drop: swarm preparation', apply: (r, rnd) => { r.soundHz = 446 + Math.round(rnd() * 10); r.soundDb = 60; r.queen = 'Piping heard' }, weightDrop: 2.1 },
  HUMID: { steps: 2, note: 'Humidity 79 %: chalkbrood risk, improve ventilation', apply: (r) => { r.humidity = 79 } },
}

export function demoHistory(hiveId) {
  const seed = hashSeed(hiveId)
  const rnd = random(seed)
  const count = (DAYS * 24) / STEP_HOURS
  const end = new Date()
  end.setMinutes(0, 0, 0)
  end.setHours(end.getHours() - (end.getHours() % STEP_HOURS))

  const rows = []
  for (let index = 0; index < count; index += 1) {
    const time = new Date(end.getTime() - (count - 1 - index) * STEP_HOURS * 3600000)
    const hour = time.getHours()
    const daylight = Math.sin(((hour - 9) / 24) * 2 * Math.PI)
    const night = hour >= 20 || hour < 6
    rows.push({
      time: time.toISOString(),
      outside: round(27 + 6 * daylight + (rnd() - 0.5) * 1.5),
      brood: round(IDEAL_BROOD + (rnd() - 0.5) * 0.5),
      humidity: Math.round(58 - 3 * daylight + (rnd() - 0.5) * 6),
      co2: Math.round(620 + (night ? 280 : 0) + rnd() * 120),
      weight: round(34 + (seed % 5) + 0.35 * (index / (24 / STEP_HOURS)) - 0.4 * Math.max(0, daylight) + rnd() * 0.2, 2),
      soundHz: Math.round(245 + (rnd() - 0.5) * 20 + (night ? 0 : 10)),
      soundDb: Math.round(night ? 49 + rnd() * 3 : 53 + rnd() * 4),
      queen: 'Present',
      note: '',
      source: 'Demo',
    })
  }

  // Place four episodes, well before "now" so the hive is healthy at present.
  const kinds = Object.keys(EPISODES).sort((a, b) => hashSeed(`${hiveId}${a}`) - hashSeed(`${hiveId}${b}`)).slice(0, 4)
  kinds.forEach((kind, order) => {
    const episode = EPISODES[kind]
    const start = 6 + order * 11 + Math.floor(rnd() * 4)
    for (let step = 0; step < episode.steps; step += 1) {
      const row = rows[start + step]
      episode.apply(row, rnd)
      row.note = episode.note
      row.episode = kind
    }
    if (episode.weightDrop) for (let index = start; index < rows.length; index += 1) rows[index].weight = round(rows[index].weight - episode.weightDrop, 2)
  })

  return rows.map((row, index) => ({ ...row, weightChange: index ? round(row.weight - rows[index - 1].weight, 2) : 0 }))
}

function level(value, { good, watch }) {
  if (value >= good[0] && value <= good[1]) return 'GOOD'
  if (value >= watch[0] && value <= watch[1]) return 'WATCH'
  return 'CRITICAL'
}

// Judges one reading: every component with its value, ideal, status and advice, plus the overall score.
export function assess(row) {
  const parts = {}
  parts.brood = {
    value: `${row.brood} °C`, ideal: '34-35.5 °C', status: level(row.brood, { good: [34, 35.5], watch: [32.5, 36.5] }),
    advice: row.brood > 35.5 ? 'Brood is too warm: shade the hive, the fan is cooling it.' : row.brood < 34 ? 'Brood is cooling: a weak or queenless colony cannot hold its heat.' : 'Brood nest is at the right temperature.',
  }
  const outsideGap = row.outside - IDEAL_BROOD
  const follow = Math.abs(outsideGap) > 3 ? (row.brood - IDEAL_BROOD) / outsideGap : 0
  parts.thermo = {
    value: `${row.brood} °C in / ${row.outside} °C out`, ideal: 'Brood steady whatever the weather',
    status: follow >= 0.25 ? 'CRITICAL' : follow >= 0.1 ? 'WATCH' : 'GOOD',
    advice: follow >= 0.1 ? 'The inside temperature is following the outside: the colony is struggling to regulate.' : 'The colony is holding its brood temperature against the weather.',
  }
  parts.humidity = {
    value: `${row.humidity} %`, ideal: '50-65 %', status: level(row.humidity, { good: [50, 65], watch: [40, 80] }),
    advice: row.humidity > 65 ? 'Damp hive: risk of chalkbrood and Nosema. Improve ventilation.' : row.humidity < 50 ? 'Dry air: brood can dry out. Keep water near the apiary.' : 'Humidity is right for the brood.',
  }
  parts.co2 = {
    value: `${row.co2} ppm`, ideal: 'Below 1,000 ppm', status: row.co2 > 1200 ? 'CRITICAL' : row.co2 > 1000 ? 'WATCH' : 'GOOD',
    advice: row.co2 > 1200 ? 'High CO₂: alert only, the fan stays off. Open the entrance or top vent.' : 'Air inside the hive is fresh.',
  }
  parts.weight = {
    value: `${row.weight} kg (${row.weightChange >= 0 ? '+' : ''}${row.weightChange} kg)`, ideal: 'No sudden drop',
    status: row.weightChange <= -1.5 ? 'CRITICAL' : row.weightChange <= -0.8 ? 'WATCH' : 'GOOD',
    advice: row.weightChange <= -1.5 ? 'Sudden weight loss: a swarm has left or the hive is being robbed.' : 'Food stores are steady or growing.',
  }
  parts.sound = {
    value: `${row.soundHz} Hz · ${row.soundDb} dB`, ideal: 'Calm hum 200-300 Hz',
    status: row.soundHz >= 200 && row.soundHz <= 300 ? 'GOOD' : 'WATCH',
    advice: row.soundHz > 400 ? 'Piping tones in the hive sound.' : row.soundHz > 300 ? 'The hum has turned into a loud roar.' : 'Normal colony hum.',
  }
  parts.queen = {
    value: row.queen, ideal: 'Queen present', status: row.queen === 'Present' ? 'GOOD' : 'CRITICAL',
    advice: row.queen === 'Queenless suspected' ? 'Check for eggs and the queen today; give a queen cell or merge the colony.' : row.queen === 'Piping heard' ? 'Queen piping: the colony is preparing to swarm.' : 'Sound pattern of a queenright colony.',
  }
  const swarming = row.queen === 'Piping heard' || row.weightChange <= -1.5
  parts.swarm = {
    value: swarming ? 'High' : 'Low', ideal: 'Low', status: swarming ? 'CRITICAL' : 'GOOD',
    advice: swarming ? 'Check for queen cells; add a super or split the colony.' : 'No sign of swarm preparation.',
  }

  // A good reading still scores a little lower the further it sits from the middle of its ideal range.
  const near = { brood: Math.abs(row.brood - IDEAL_BROOD) * 20, humidity: Math.abs(row.humidity - 57.5) * 1.5, co2: Math.max(0, row.co2 - 600) / 12, sound: Math.abs(row.soundHz - 250) / 2 }
  const points = (item) => (item.status === 'GOOD' ? Math.max(85, 100 - (near[item.key] || 0)) : POINTS[item.status])
  const components = COMPONENTS.map((item) => ({ ...item, ...parts[item.key] }))
  const weighted = components.reduce((sum, item) => sum + (points(item) * item.weight) / 100, 0)
  const status = components.some((item) => item.status === 'CRITICAL') ? 'CRITICAL' : components.some((item) => item.status === 'WATCH') ? 'WATCH' : 'HEALTHY'
  // One critical component puts the whole colony at risk, so it pulls the score below 50; a warning keeps it below 80.
  const score = Math.round(status === 'CRITICAL' ? weighted * 0.5 : status === 'WATCH' ? weighted * 0.82 : weighted)
  return { components, score, status }
}

// The spectrum the microphone pipeline would show for this reading (100-600 Hz after the digital filters).
export function spectrum(row) {
  const bins = []
  for (let hz = 100; hz <= 600; hz += 25) {
    const main = Math.exp(-((hz - row.soundHz) ** 2) / (2 * 30 ** 2))
    const harmonic = Math.exp(-((hz - row.soundHz * 2) ** 2) / (2 * 40 ** 2)) * 0.35
    const floor = 0.06 + ((hz * 7) % 11) / 200
    bins.push({ hz, level: Math.round(Math.min(1, main + harmonic + floor) * (row.soundDb / 65) * 100) })
  }
  return bins
}

// What happened with notifications for each history row: a critical reading texts the keeper, a repeat of the same
// problem within 6 hours does not (the same cooldown the real alert service uses), a warning stays in the app.
export function withNotifications(rows) {
  let lastText = {}
  return rows.map((row) => {
    const result = assess(row)
    let notice = ''
    if (result.status === 'CRITICAL') {
      const key = row.episode || 'critical'
      const at = new Date(row.time).getTime()
      if (lastText[key] && at - lastText[key] < 6 * 3600000) notice = 'REPEAT'
      else { notice = 'SENT'; lastText[key] = at }
    } else if (result.status === 'WATCH') notice = 'APP'
    return { ...row, ...result, notice }
  })
}
