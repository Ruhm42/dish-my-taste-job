/**
 * The reader's own position: permission handling and its states.
 *
 * Pure module — no DOM, no `navigator`, no React. The browser plumbing lives in
 * `components/use-user-position.ts`; what is decided lives here, so it can be tested.
 * The repository has no jsdom environment and every existing suite targets a pure
 * module of `lib/`, which is the reason for the split rather than a preference.
 *
 * The rule the whole file serves: **a silent failure is worse than a visible one**. A
 * blue dot frozen at the wrong place looks exactly like a blue dot that is right, so
 * every state that is not working says so, in French, and says what to do about it.
 *
 * Nothing here costs anything. `navigator.geolocation` is a browser API: it never
 * touches our Google key, our Cloud project or the monthly quota. Google's own
 * Geolocation and Geocoding APIs would — both are capped at 0/day — and are never called.
 */

import { distanceInMeters } from '@/lib/grid'

export interface UserPosition {
  lat: number
  lng: number
  /** Radius in meters the browser reports at 95% confidence. */
  accuracy: number
  /** Epoch milliseconds of the fix. */
  at: number
}

export type PositionState =
  /** Nothing asked yet. The arrival state, and the only one that prompts on a click. */
  | { kind: 'idle' }
  /** Waiting for a first fix. */
  | { kind: 'locating' }
  | { kind: 'active'; position: UserPosition }
  /** The browser has no geolocation at all. */
  | { kind: 'unsupported' }
  /** Served over http: the API exists and will refuse every time. */
  | { kind: 'insecure' }
  /** Refused. The browser has memorised it and will not prompt again. */
  | { kind: 'denied' }
  /**
   * Lost the signal. Carries the last known point on purpose: losing the fix must not
   * erase the dot, but must say that it is the old one.
   */
  | { kind: 'failed'; reason: 'unavailable' | 'timeout'; last: UserPosition | null }

export type PositionEvent =
  /**
   * What the browser turned out to be capable of. Dispatched on mount, never computed at
   * init: this component is server-rendered too, and reading `navigator` there would make
   * the server and the client disagree on what to draw.
   */
  | { type: 'environment'; env: { supported: boolean; secure: boolean } }
  | { type: 'requested' }
  | { type: 'fixed'; position: UserPosition }
  | { type: 'error'; code: number }
  /** The permission was withdrawn from the browser's settings while we were watching. */
  | { type: 'revoked' }
  /** The map left the screen and the watch was cleared. */
  | { type: 'stopped' }

/**
 * `GeolocationPositionError` codes, named here so this module stays free of DOM types.
 */
export const PERMISSION_DENIED = 1
export const POSITION_UNAVAILABLE = 2
export const TIMEOUT = 3

/**
 * Beyond this radius the fix cannot place someone in a street, which is the only scale
 * this product works at. The dot is still drawn — with its circle — but it says so.
 */
export const UNUSABLE_ACCURACY_M = 1_000

/** Where the map opens, and the centre of the swept perimeter. */
const AREA_CENTER = { lat: 45.757, lng: 4.832 }

/**
 * Radius that covers the whole perimeter. D26 measured that 10 km from the centre of
 * Lyon already covers it; 15 km leaves Villeurbanne's far edge room without telling a
 * legitimate reader they are an outsider.
 */
const AREA_RADIUS_M = 15_000

/**
 * The two structural dead ends are known before anything is asked, and they are not the
 * same failure: one has no remedy, the other has one the reader cannot apply from here.
 * Telling them apart is the whole point of computing this up front.
 */
export function initialState(env: { supported: boolean; secure: boolean }): PositionState {
  if (!env.supported) return { kind: 'unsupported' }
  if (!env.secure) return { kind: 'insecure' }
  return { kind: 'idle' }
}

/** The last point we held, whatever state we are in now. What the map draws. */
export function lastKnown(state: PositionState): UserPosition | null {
  if (state.kind === 'active') return state.position
  if (state.kind === 'failed') return state.last
  return null
}

export function reduce(state: PositionState, event: PositionEvent): PositionState {
  switch (event.type) {
    case 'environment':
      // Only from the arrival state. A verdict landing after the reader has been located
      // must never erase the fix — and `idle` is the only state that predates the answer.
      return state.kind === 'idle' ? initialState(event.env) : state

    case 'requested':
      // Already located: the watch is running and re-requesting would drop the point back
      // to `locating`, blinking the dot off screen. The permission listener fires this on
      // every grant, including ones we already act on.
      if (state.kind === 'active') return state

      // Neither dead end can be requested out of: a browser without the API will not
      // grow one, and an insecure page is refused before a prompt is ever shown. A
      // refusal, on the other hand, CAN be undone — from the browser's own settings,
      // which reaches us as a permission change, not as a click.
      if (state.kind === 'unsupported' || state.kind === 'insecure') return state
      return { kind: 'locating' }

    case 'fixed':
      return { kind: 'active', position: event.position }

    case 'error':
      if (event.code === PERMISSION_DENIED) return { kind: 'denied' }
      return {
        kind: 'failed',
        reason: event.code === TIMEOUT ? 'timeout' : 'unavailable',
        last: lastKnown(state),
      }

    case 'revoked':
      return { kind: 'denied' }

    case 'stopped':
      // Only a request in flight needs undoing: without this, tapping "Me localiser" and
      // switching straight to the list tab would leave the button saying "Localisation…"
      // for the rest of the visit. A fix we already hold survives — the watch resumes in
      // silence when the map comes back.
      return state.kind === 'locating' ? { kind: 'idle' } : state
  }
}

/**
 * Whether a click could still lead anywhere.
 *
 * The three states this excludes are dead ends no click can leave: a browser without the
 * API, a page the API always refuses, and a refusal the browser has memorised and will
 * not prompt for again. Offering a button there would promise something that cannot
 * happen — the message says what to do instead.
 */
export function isRetryable(state: PositionState): boolean {
  return state.kind !== 'denied' && state.kind !== 'insecure' && state.kind !== 'unsupported'
}

/** A fix too vague to place someone in a street. */
export function isTooVague(position: UserPosition): boolean {
  return position.accuracy > UNUSABLE_ACCURACY_M
}

/** Outside the swept perimeter — the dot would sit in an empty map. */
export function isFarFromArea(position: UserPosition): boolean {
  return distanceInMeters(AREA_CENTER, position) > AREA_RADIUS_M
}

/**
 * What the reader is told, or `null` when the position is simply working.
 *
 * French, like everything that reaches the screen. Each message names the remedy rather
 * than the fault: "refused" alone leaves someone stuck, since the browser will never ask
 * again on its own.
 */
export function messageFor(state: PositionState): string | null {
  switch (state.kind) {
    case 'denied':
      return 'Localisation refusée. Pour l’autoriser à nouveau, ouvrez les réglages du site '
        + 'dans votre navigateur — le cadenas à gauche de l’adresse.'

    case 'insecure':
      return 'La localisation exige une connexion sécurisée (https). '
        + 'Elle est indisponible à cette adresse.'

    case 'unsupported':
      return 'Ce navigateur ne sait pas donner votre position.'

    case 'failed': {
      // The dot stays on screen, so the message has to account for it: an old point left
      // unexplained is exactly the silent lie this module exists to prevent.
      const stale = state.last ? ' Le point affiché est le dernier connu.' : ''
      return state.reason === 'timeout'
        ? `Position introuvable pour l’instant. Réessayez.${stale}`
        : `Signal indisponible — en intérieur, il faut parfois ressortir.${stale}`
    }

    case 'active':
      if (isTooVague(state.position))
        return 'Position approximative : votre navigateur ne la situe qu’à '
          + `${Math.round(state.position.accuracy / 100) / 10} km près. Le cercle en donne l’étendue.`
      if (isFarFromArea(state.position))
        return 'Vous êtes hors du secteur couvert (Lyon et Villeurbanne) : '
          + 'aucun établissement n’est répertorié autour de vous.'
      return null

    default:
      return null
  }
}
