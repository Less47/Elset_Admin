import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import AppEntry from './AppEntry.jsx'
import { createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { workspaceRoutes } from './routes.js'

const router = createBrowserRouter([
  { path: '/legal/terms', element: <AppEntry legalPath="/legal/terms" /> },
  { path: '/legal/privacy', element: <AppEntry legalPath="/legal/privacy" /> },
  { path: '/', element: <AppEntry />, children: workspaceRoutes },
])

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
