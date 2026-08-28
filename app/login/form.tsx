'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { signIn } from './actions'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-stone-900 px-3 py-2 text-sm font-medium text-white
                 hover:bg-stone-700 disabled:opacity-50"
    >
      {pending ? 'Connexion…' : 'Se connecter'}
    </button>
  )
}

export function LoginForm({ next }: { next: string }) {
  const [error, formAction] = useActionState(signIn, null)

  return (
    <form action={formAction} className="mt-8 space-y-4">
      <input type="hidden" name="suite" value={next} />

      <div>
        <label htmlFor="email" className="block text-xs font-medium uppercase tracking-wide text-stone-500">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm
                     focus:border-stone-500 focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-xs font-medium uppercase tracking-wide text-stone-500">
          Mot de passe
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm
                     focus:border-stone-500 focus:outline-none"
        />
      </div>

      {error && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-800">
          {error}
        </p>
      )}

      <SubmitButton />
    </form>
  )
}
