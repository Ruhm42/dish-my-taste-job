import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Dish My Taste Job',
  description: 'Trouver un restaurant selon son rythme de travail',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  )
}
