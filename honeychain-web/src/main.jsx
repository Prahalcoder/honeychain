import '@fontsource-variable/fraunces'
import '@fontsource-variable/source-sans-3'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { LanguageProvider } from './i18n'
import './styles.css'
import './shop.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </StrictMode>,
)
