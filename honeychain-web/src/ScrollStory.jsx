import { useEffect, useRef, useState } from 'react'
import { useLang } from './i18n'

const FRAME_COUNT = 192
const frameUrl = (index) => `/frames/f${String(index + 1).padStart(4, '0')}.jpg`
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value))

// Apple-style scroll story: the page scrolls, the bee video plays with it (frame by
// frame, forward and backward) and each chapter of text fades in and out.
export default function ScrollStory() {
  const { t } = useLang()
  const wrapper = useRef(null)
  const canvas = useRef(null)
  const frames = useRef([])
  const loaded = useRef(0)
  const state = useRef({ target: 0, current: 0, last: -1 })
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    // Load frames in order so the opening frames are ready first.
    frames.current = new Array(FRAME_COUNT)
    let cancelled = false

    const load = (index) => {
      if (cancelled || index >= FRAME_COUNT) return
      const image = new Image()
      image.onload = () => { frames.current[index] = image; loaded.current += 1; if (index === 0) state.current.last = -1 }
      image.onerror = () => { /* a missing frame is skipped */ }
      image.src = frameUrl(index)
      // a few parallel requests keep loading quick without flooding the dev server
      if (index % 4 === 0) { load(index + 1); load(index + 2); load(index + 3); load(index + 4) }
    }
    load(0)

    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const element = canvas.current
    const context = element.getContext('2d')
    let raf = 0

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      element.width = window.innerWidth * ratio
      element.height = window.innerHeight * ratio
      state.current.last = -1
    }

    const draw = (index) => {
      // nearest loaded frame at or before the wanted one
      let frame = frames.current[index]
      for (let back = index; !frame && back >= 0; back -= 1) frame = frames.current[back]
      if (!frame) return

      const cw = element.width
      const ch = element.height
      const scale = Math.max(cw / frame.width, ch / frame.height)
      const w = frame.width * scale
      const h = frame.height * scale
      context.drawImage(frame, (cw - w) / 2, (ch - h) / 2, w, h)
    }

    // The loop only runs while the video is catching up with the scroll position.
    const tick = () => {
      raf = 0
      const s = state.current
      s.current += (s.target - s.current) * 0.14
      if (Math.abs(s.target - s.current) < 0.0004) s.current = s.target

      const index = Math.round(s.current * (FRAME_COUNT - 1))
      if (index !== s.last) {
        draw(index)
        s.last = index
        setProgress(s.current)
      }

      if (s.current !== s.target) raf = requestAnimationFrame(tick)
    }

    const wake = () => { if (!raf) raf = requestAnimationFrame(tick) }

    const onScroll = () => {
      const box = wrapper.current.getBoundingClientRect()
      const total = box.height - window.innerHeight
      state.current.target = clamp(-box.top / total)
      wake()
    }

    resize()
    onScroll()
    wake()
    // frames arrive over the network; redraw once the first ones are in
    const firstFrames = window.setInterval(() => { if (loaded.current > 3) { state.current.last = -1; wake(); window.clearInterval(firstFrames) } }, 120)
    window.addEventListener('resize', resize)
    window.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      cancelAnimationFrame(raf)
      window.clearInterval(firstFrames)
      window.removeEventListener('resize', resize)
      window.removeEventListener('scroll', onScroll)
    }
  }, [])

  const chapters = t.hero.chapters
  const count = chapters.length

  return (
    <section className="story" ref={wrapper} id="top">
      <div className="story-sticky">
        <canvas ref={canvas} className="story-canvas" aria-hidden="true" />
        <div className="story-shade" />

        {chapters.map((chapter, index) => {
          // each chapter owns a slice of the scroll; it fades in, holds, then fades out
          const start = index / count
          const end = (index + 1) / count
          const local = (progress - start) / (end - start)
          // the first chapter is visible on load, the last one stays to the end
          const fadeIn = index === 0 ? 1 : local * 5
          const fadeOut = index === count - 1 ? 1 : (1 - local) * 5
          const opacity = clamp(Math.min(fadeIn, fadeOut))
          const shift = index === 0 ? -clamp(local) * 40 : (0.5 - clamp(local)) * 60

          return (
            <div key={chapter.kicker} className="story-chapter" style={{ opacity, transform: `translateY(${shift}px)`, pointerEvents: opacity > 0.6 ? 'auto' : 'none' }}>
              <p className="story-kicker">{chapter.kicker}</p>
              <h1>{chapter.title}</h1>
              <p className="story-text">{chapter.text}</p>
              {index === 0 && <a className="story-cta" href="#verify">{t.hero.cta}</a>}
            </div>
          )
        })}

        <div className="story-hint" style={{ opacity: clamp(1 - progress * 8) }}>
          <span>{t.hero.scroll}</span>
          <i />
        </div>

        <div className="story-bar"><div style={{ width: `${progress * 100}%` }} /></div>
      </div>
    </section>
  )
}
