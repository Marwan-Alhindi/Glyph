// src/router.jsx
import React from 'react'
import { createBrowserRouter } from 'react-router-dom'

// Root Layout
import RootLayout from './RootLayout'

// Layouts
import MarketingLayout from './marketing/MarketingLayout'
import AppLayout from './app/AppLayout'

// Marketing Pages
import Login from './marketing/pages/Login'
import Landing from './marketing/pages/Landing'
import Getstarted from './marketing/pages/Getstarted'
import AuthCallback from './marketing/pages/AuthCallback'

// App Pages
import ChatPage from './app/pages/ChatPage'
import AcceptInvite from './app/pages/AcceptInvite'
import BillingReturn from './app/pages/BillingReturn'

// Auth
import ProtectedRoute from './components/ProtectedRoute'

const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      {
        path: '/',
        element: <MarketingLayout />,
        children: [
          { path: '', element: <Landing /> },
          { path: 'login', element: <Login /> },
          { path: 'getstarted', element: <Getstarted /> },
          { path: 'auth/callback', element: <AuthCallback /> },
          { path: 'invite/:token', element: <AcceptInvite /> }
        ]
      },
      {
        path: '/app',
        element: <ProtectedRoute><AppLayout /></ProtectedRoute>,
        children: [
          { path: '', element: null },
          { path: 'chat/:chatId', element: <ChatPage /> },
          { path: 'billing/return', element: <BillingReturn /> }
        ]
      }
    ]
  }
])

export default router
