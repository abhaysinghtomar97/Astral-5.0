import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import AstralApp from './Astral'


createRoot(document.getElementById('root')).render(
  <StrictMode>
   <AstralApp/>
  </StrictMode>,
)
