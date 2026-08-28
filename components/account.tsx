import { signOut } from '@/app/login/actions'

/** Who is signed in, and the way out. Rendered from a Server Component. */
export function Account({ email }: { email: string }) {
  return (
    <div className="flex items-center gap-3 text-xs text-stone-500">
      <span className="hidden sm:inline">{email}</span>
      <form action={signOut}>
        <button type="submit" className="rounded border border-stone-300 px-2 py-1 hover:bg-stone-100">
          Se déconnecter
        </button>
      </form>
    </div>
  )
}
