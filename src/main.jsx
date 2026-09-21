import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import AppEntry from './AppEntry.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppEntry />
  </StrictMode>,
)
