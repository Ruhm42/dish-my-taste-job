import { NextResponse, type NextRequest } from 'next/server'
import { parseFilters } from '@/lib/filters'
import { fetchPage } from '@/lib/results'
import { getUser } from '@/lib/supabase/server'

/**
 * One page of results for the infinite scroll.
 *
 * The middleware already blocks unauthenticated requests, but the session is checked here
 * too: an API route is one refactor of the matcher away from being exposed, and this one
 * serves Google Places data behind a closed access list (D11).
 */
export async function GET(request: NextRequest) {
  if (!(await getUser())) {
    return NextResponse.json({ error: 'non autorisé' }, { status: 401 })
  }

  const params = Object.fromEntries(request.nextUrl.searchParams.entries())
  const filters = parseFilters(params)

  // Both halves of the key or neither: a name without its id would loop forever on a
  // duplicate name.
  const afterName = request.nextUrl.searchParams.get('apres')
  const afterId = request.nextUrl.searchParams.get('apresId')
  const cursor = afterName !== null && afterId ? { name: afterName, id: afterId } : null

  try {
    const page = await fetchPage(filters, cursor)
    return NextResponse.json(page)
  } catch (error) {
    // Fail loudly on the server, plainly on the client: a swallowed error here would show
    // up as a scroll that silently stops, which reads exactly like "no more results".
    console.error('GET /api/etablissements', error)
    return NextResponse.json({ error: 'la recherche a échoué' }, { status: 500 })
  }
}
