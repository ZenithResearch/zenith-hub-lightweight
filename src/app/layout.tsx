import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'
import { GlobalHermesChat } from '@/components/hub/GlobalHermesChat'
import { HubWorkspaceState } from '@/components/hub/HubWorkspaceState'

export const metadata: Metadata = {
  title: 'Zenith Hub',
  description: 'Local Mac deployment and monitoring for Zenith.',
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" data-theme="light">
      <body><HubWorkspaceState>{children}<GlobalHermesChat /></HubWorkspaceState></body>
    </html>
  )
}
