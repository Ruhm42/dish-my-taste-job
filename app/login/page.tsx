import { LoginForm } from './form'

export const metadata = { title: 'Connexion — Dish My Taste Job' }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const next = typeof params.suite === 'string' ? params.suite : ''

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold tracking-tight">Dish My Taste Job</h1>
        <p className="mt-1 text-sm text-stone-600">
          Les restaurants de la Métropole de Lyon, filtrés par rythme de travail.
        </p>

        <LoginForm next={next} />

        <p className="mt-6 text-xs text-stone-500">
          L’accès est réservé. Si tu n’as pas de compte, demande-en un — il n’y a pas
          d’inscription en ligne.
        </p>
      </div>
    </main>
  )
}
