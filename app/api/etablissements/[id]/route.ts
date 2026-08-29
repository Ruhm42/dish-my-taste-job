import { NextResponse } from 'next/server'
import { fetchOne } from '@/lib/results'
import { getUser } from '@/lib/supabase/server'

/** Postgres raises on a malformed uuid, so a typo would surface as a 500. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * One establishment, in full — what the detail panel opens.
 *
 * The map carries every establishment that passes the filters while the list has loaded
 * only its first pages, so a marker click cannot rely on the row being on the client
 * already. It asks for the one it needs (D27).
 *
 * The middleware already blocks unauthenticated requests; the session is checked here too,
 * because this route serves Google Places data behind a closed access list (D11) and is one
 * refactor of the matcher away from being exposed.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await getUser())) {
    return NextResponse.json({ error: 'non autorisé' }, { status: 401 })
  }

  const { id } = await params
  if (!UUID.test(id)) {
    return NextResponse.json({ error: 'identifiant invalide' }, { status: 400 })
  }

  try {
    const row = await fetchOne(id)
    if (!row) return NextResponse.json({ error: 'établissement introuvable' }, { status: 404 })
    return NextResponse.json(row)
  } catch (error) {
    // Loudly on the server, plainly on the client: the panel says the sheet could not be
    // opened rather than showing an empty frame that reads like an establishment with no
    // information.
    console.error(`GET /api/etablissements/${id}`, error)
    return NextResponse.json({ error: 'la fiche n’a pas pu être chargée' }, { status: 500 })
  }
}
