import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

/** Routes reachable without a session. Everything else requires one. */
const PUBLIC_PATHS = ['/login']

/**
 * Gate every page behind a session, and refresh that session on the way through.
 *
 * The refresh matters as much as the gate: Server Components cannot write cookies, so
 * without a middleware pass the access token would expire and never renew, logging the
 * user out mid-session for no visible reason.
 *
 * The default here is DENY: anything not explicitly listed as public needs a session.
 * A route added later is therefore protected by omission rather than exposed by it.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })

  // getUser() validates the token against the auth server. getSession() would merely
  // decode a cookie the browser sent us, which a client controls.
  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))

  if (!user && !isPublic) {
    // An API caller cannot follow a redirect to a login page: fetch() would happily
    // receive the HTML and the infinite scroll would append nothing, silently. A 401 is
    // something the client can actually react to.
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'non autorisé' }, { status: 401 })
    }

    const to = request.nextUrl.clone()
    to.pathname = '/login'
    // Come back where the user was headed once they are in.
    to.search = pathname === '/' ? '' : `?suite=${encodeURIComponent(pathname + request.nextUrl.search)}`
    return NextResponse.redirect(to)
  }

  if (user && pathname === '/login') {
    const to = request.nextUrl.clone()
    to.pathname = '/recherche'
    to.search = ''
    return NextResponse.redirect(to)
  }

  return response
}

export const config = {
  // Everything except Next's own assets and the favicon. Listing exclusions rather than
  // inclusions keeps new routes protected by default.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
