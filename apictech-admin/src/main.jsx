import '@fontsource-variable/fraunces'
import '@fontsource-variable/source-sans-3'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './admin.css'
import './bright.css'
import './theme.css'
import { initLanguage } from './i18n'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

initLanguage()
