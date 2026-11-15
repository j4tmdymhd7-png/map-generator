import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { isPlayerScreen } from './player/channel'
import { PlayerScreen } from './player/PlayerScreen'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isPlayerScreen() ? <PlayerScreen /> : <App />}
  </StrictMode>,
)
