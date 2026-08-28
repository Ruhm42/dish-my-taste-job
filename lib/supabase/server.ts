import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY are missing')

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 *
 * The publishable key is public by design — it grants nothing on its own. Every table
 * has RLS enabled with no policy, so this client can read nothing from the database;
 * it only ever talks to the auth endpoints. The application's own data access goes
 * through Drizzle, as the table owner, on a separate connection.
 */
export async function createClient() {
  const store = await cookies()

  return createServerClient(url!, key!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options))
        } catch {
          // Server Components cannot set cookies. The middleware refreshes the session
          // on every request, so ignoring this is safe rather than merely convenient.
        }
      },
    },
  })
}

/** The signed-in user, or null. Reads from the auth server, never from a cookie claim. */
export async function getUser() {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getUser()
  return error ? null : data.user
}
