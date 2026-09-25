// Small form pieces shared by the registration wizard and the "Registration details" editor.
export const inputClass = 'w-full rounded-xl border border-[#c6e2e0] bg-[#f7fbfb] px-4 py-3 text-sm outline-none focus:border-[#F97360]'

// Immutable update of a nested value: setIn(profile, 'bank.ifsc', 'SBIN0001234').
export function setIn(object, path, value) {
  const [head, ...rest] = path.split('.')
  const current = object && typeof object === 'object' ? object : {}
  return { ...current, [head]: rest.length ? setIn(current[head], rest.join('.'), value) : value }
}

export function getIn(object, path) {
  return path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), object)
}

// The Verhoeff check Aadhaar numbers use, so a typing mistake shows at once (the server checks again).
const D = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]]
const P = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]]
export function validAadhaar(value) {
  const digits = String(value || '').replace(/\s+/g, '')
  if (!/^[2-9]\d{11}$/.test(digits)) return false
  let check = 0
  ;[...digits].reverse().forEach((digit, index) => { check = D[check][P[index % 8][Number(digit)]] })
  return check === 0
}

export function Label({ children, optional, hint }) {
  return (
    <span className="mb-1.5 block text-sm font-semibold">
      {children}{optional && <span className="font-normal text-gray-400"> (optional)</span>}
      {hint && <span className="block text-xs font-normal text-gray-400">{hint}</span>}
    </span>
  )
}

export function Field({ label, optional, hint, value, onChange, type = 'text', error, className = '', ...rest }) {
  return (
    <label className={`block ${className}`}>
      <Label optional={optional} hint={hint}>{label}</Label>
      <input type={type} value={value ?? ''} onChange={(event) => onChange(event.target.value)} className={`${inputClass} ${error ? 'border-red-400' : ''}`} {...rest} />
      {error && <span className="mt-1 block text-xs font-semibold text-red-600">{error}</span>}
    </label>
  )
}

export function TextArea({ label, optional, hint, value, onChange, className = '', ...rest }) {
  return (
    <label className={`block ${className}`}>
      <Label optional={optional} hint={hint}>{label}</Label>
      <textarea value={value ?? ''} onChange={(event) => onChange(event.target.value)} rows={2} className={inputClass} {...rest} />
    </label>
  )
}

export function Select({ label, optional, hint, value, onChange, options, placeholder = 'Select', className = '', ...rest }) {
  return (
    <label className={`block ${className}`}>
      <Label optional={optional} hint={hint}>{label}</Label>
      <select value={value ?? ''} onChange={(event) => onChange(event.target.value)} className={inputClass} {...rest}>
        <option value="">{placeholder}</option>
        {options.map((option) => {
          const item = typeof option === 'string' ? { value: option, label: option } : option
          return <option key={item.value} value={item.value}>{item.label}</option>
        })}
      </select>
    </label>
  )
}

// A set of tick boxes whose value is an array of the ticked options.
export function Checks({ label, optional, hint, value, onChange, options, className = '' }) {
  const chosen = Array.isArray(value) ? value : []
  const toggle = (option) => onChange(chosen.includes(option) ? chosen.filter((item) => item !== option) : [...chosen, option])
  return (
    <div className={className}>
      <Label optional={optional} hint={hint}>{label}</Label>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            type="button" key={option} onClick={() => toggle(option)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${chosen.includes(option) ? 'border-[#0F766E] bg-[#0F766E] text-white' : 'border-[#c6e2e0] bg-white text-gray-600 hover:border-[#0F766E]'}`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  )
}

export function YesNo({ label, value, onChange, className = '' }) {
  return (
    <div className={className}>
      <Label>{label}</Label>
      <div className="inline-flex overflow-hidden rounded-xl border border-[#c6e2e0]">
        {[['Yes', true], ['No', false]].map(([text, flag]) => (
          <button type="button" key={text} onClick={() => onChange(flag)} className={`px-5 py-2 text-sm font-bold ${value === flag ? 'bg-[#0F766E] text-white' : 'bg-white text-gray-600'}`}>{text}</button>
        ))}
      </div>
    </div>
  )
}

export function Card({ title, description, children, tone = '' }) {
  return (
    <section className={`rounded-2xl border border-[#d4e9e8] bg-white p-5 ${tone}`}>
      {title && <h3 className="text-base font-black">{title}</h3>}
      {description && <p className="mt-0.5 text-xs text-gray-500">{description}</p>}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  )
}
