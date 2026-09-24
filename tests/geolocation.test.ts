import { describe, expect, it } from 'vitest'
import {
  PERMISSION_DENIED,
  POSITION_UNAVAILABLE,
  TIMEOUT,
  UNUSABLE_ACCURACY_M,
  initialState,
  isFarFromArea,
  isRetryable,
  isTooVague,
  lastKnown,
  messageFor,
  reduce,
} from '@/lib/geolocation'
import type { PositionState, UserPosition } from '@/lib/geolocation'

const SUPPORTED = { supported: true, secure: true }

/** Place Bellecour, well inside the swept perimeter. */
const LYON: UserPosition = { lat: 45.7578, lng: 4.8320, accuracy: 20, at: 1_000 }

function fix(over: Partial<UserPosition> = {}): UserPosition {
  return { ...LYON, ...over }
}

/** Walk a sequence of events from a starting state, as the hook would. */
function run(from: PositionState, ...events: Parameters<typeof reduce>[1][]): PositionState {
  return events.reduce(reduce, from)
}

describe('the arrival state', () => {
  it('separates a browser without the API from a page it will always refuse', () => {
    expect(initialState({ supported: false, secure: true })).toEqual({ kind: 'unsupported' })
    expect(initialState({ supported: true, secure: false })).toEqual({ kind: 'insecure' })
    expect(initialState(SUPPORTED)).toEqual({ kind: 'idle' })
  })

  // ─────────────────────────────────────────────────────────────
  // Both dead ends look identical on screen — a button that does
  // nothing — and have completely different remedies: one has none,
  // the other is "open this page over https". Merging them into a
  // single "unavailable" would send the reader after the wrong fix.
  // ─────────────────────────────────────────────────────────────
  it('gives the two dead ends different remedies', () => {
    const noApi = messageFor({ kind: 'unsupported' })
    const insecure = messageFor({ kind: 'insecure' })
    expect(noApi).not.toEqual(insecure)
    expect(insecure).toContain('https')
  })

  // ─────────────────────────────────────────────────────────────
  // The verdict is dispatched on mount, not computed at init: the
  // component is server-rendered, and reading `navigator` there
  // would have the server draw a button where the client draws a
  // message. It therefore has to arrive as an event, and it must
  // not be able to overwrite a position obtained since.
  // ─────────────────────────────────────────────────────────────
  it('arrives as an event, and never overwrites a fix obtained since', () => {
    const blocked = { supported: false, secure: true }

    expect(run({ kind: 'idle' }, { type: 'environment', env: blocked }))
      .toEqual({ kind: 'unsupported' })
    expect(run({ kind: 'active', position: LYON }, { type: 'environment', env: blocked }))
      .toEqual({ kind: 'active', position: LYON })
  })

  it('cannot be requested out of a dead end', () => {
    expect(run({ kind: 'unsupported' }, { type: 'requested' })).toEqual({ kind: 'unsupported' })
    expect(run({ kind: 'insecure' }, { type: 'requested' })).toEqual({ kind: 'insecure' })
  })
})

describe('a refusal', () => {
  // ─────────────────────────────────────────────────────────────
  // The state this whole module exists for. A browser that has been
  // refused once does NOT prompt again, so a button still offering
  // "Me localiser" promises something that can never happen. The
  // message has to carry the way out instead.
  // ─────────────────────────────────────────────────────────────
  it('stops offering an action, and says how to undo itself', () => {
    const denied = run({ kind: 'idle' }, { type: 'requested' }, { type: 'error', code: PERMISSION_DENIED })

    expect(denied).toEqual({ kind: 'denied' })
    expect(isRetryable(denied)).toBe(false)
    expect(messageFor(denied)).toMatch(/réglages du site/)
  })

  it('is reached from a withdrawal mid-watch, and not confused with a fresh start', () => {
    const revoked = run({ kind: 'active', position: LYON }, { type: 'revoked' })

    expect(revoked).toEqual({ kind: 'denied' })
    // Falling back to `idle` would redraw an inviting button and drop the explanation,
    // which is the one thing someone who just lost the permission needs to read.
    expect(revoked.kind).not.toBe('idle')
  })

  it('can still be left, but only by the browser granting it again', () => {
    // Not by clicking — `isRetryable` is false. The permission listener is what fires this.
    expect(run({ kind: 'denied' }, { type: 'requested' })).toEqual({ kind: 'locating' })
  })
})

describe('a lost signal', () => {
  // ─────────────────────────────────────────────────────────────
  // A refusal is permanent, a timeout is not. Collapsing them into
  // one "it failed" would either strand a retryable case behind a
  // dead button, or keep offering a prompt that will never appear.
  // ─────────────────────────────────────────────────────────────
  it('stays retryable, unlike a refusal', () => {
    const timedOut = run({ kind: 'locating' }, { type: 'error', code: TIMEOUT })
    const unavailable = run({ kind: 'locating' }, { type: 'error', code: POSITION_UNAVAILABLE })

    expect(timedOut).toMatchObject({ kind: 'failed', reason: 'timeout' })
    expect(unavailable).toMatchObject({ kind: 'failed', reason: 'unavailable' })
    expect(isRetryable(timedOut)).toBe(true)
    expect(isRetryable(unavailable)).toBe(true)
  })

  // ─────────────────────────────────────────────────────────────
  // The dot stays drawn after a signal loss, so the state has to
  // carry the point that is still on screen. Dropping it would
  // leave an unexplained marker at a place the reader has left —
  // the silent lie the map refuses everywhere else.
  // ─────────────────────────────────────────────────────────────
  it('keeps the last known point and says the dot is old', () => {
    const lost = run(
      { kind: 'active', position: LYON },
      { type: 'error', code: POSITION_UNAVAILABLE },
    )

    expect(lastKnown(lost)).toEqual(LYON)
    expect(messageFor(lost)).toMatch(/dernier connu/)
  })

  // ─────────────────────────────────────────────────────────────
  // A lost signal is not a watching state, so the watch is already
  // cleared by the time it is reached. Retrying has to be able to
  // start a new one from here, or a single dropout would strand the
  // feature until the page is reloaded.
  // ─────────────────────────────────────────────────────────────
  it('can start watching again, keeping nothing of the failure', () => {
    const lost = run({ kind: 'active', position: LYON }, { type: 'error', code: TIMEOUT })

    expect(run(lost, { type: 'requested' })).toEqual({ kind: 'locating' })
  })

  it('says nothing about a stale dot when there was never one to draw', () => {
    const never = run({ kind: 'locating' }, { type: 'error', code: TIMEOUT })

    expect(lastKnown(never)).toBeNull()
    expect(messageFor(never)).not.toMatch(/dernier connu/)
  })
})

describe('a request in flight', () => {
  // ─────────────────────────────────────────────────────────────
  // Tapping "Me localiser" and switching straight to the list tab
  // clears the watch. Without this the button would read
  // "Localisation…" for the rest of the visit, disabled, with
  // nothing left running to ever answer it.
  // ─────────────────────────────────────────────────────────────
  it('is undone when the map leaves the screen', () => {
    expect(run({ kind: 'locating' }, { type: 'stopped' })).toEqual({ kind: 'idle' })
  })

  it('leaves a fix we already hold alone, since the watch resumes in silence', () => {
    const active: PositionState = { kind: 'active', position: LYON }
    expect(run(active, { type: 'stopped' })).toEqual(active)
    expect(run({ kind: 'denied' }, { type: 'stopped' })).toEqual({ kind: 'denied' })
  })
})

describe('a position that is drawn but not trustworthy', () => {
  // ─────────────────────────────────────────────────────────────
  // A dot drawn sharp on a fix accurate to two kilometres looks
  // exactly like one accurate to ten metres. The product judges
  // establishments street by street, so a fix that cannot name a
  // street has to admit it rather than be quietly rendered.
  // ─────────────────────────────────────────────────────────────
  it('states an accuracy too coarse to place someone in a street', () => {
    const vague = fix({ accuracy: UNUSABLE_ACCURACY_M + 1 })
    const sharp = fix({ accuracy: UNUSABLE_ACCURACY_M })

    expect(isTooVague(vague)).toBe(true)
    expect(isTooVague(sharp)).toBe(false)
    expect(messageFor({ kind: 'active', position: vague })).toMatch(/approximative/)
    expect(messageFor({ kind: 'active', position: sharp })).toBeNull()
  })

  it('states a position outside the swept perimeter', () => {
    // Paris: a reader testing from home would otherwise get a blue dot in a void and
    // read it as a broken map.
    const paris = fix({ lat: 48.8566, lng: 2.3522 })
    // Villeurbanne's far edge stays inside — the perimeter is Lyon AND Villeurbanne.
    const villeurbanne = fix({ lat: 45.7772, lng: 4.8902 })

    expect(isFarFromArea(paris)).toBe(true)
    expect(isFarFromArea(villeurbanne)).toBe(false)
    expect(messageFor({ kind: 'active', position: paris })).toMatch(/hors du secteur/)
    expect(messageFor({ kind: 'active', position: villeurbanne })).toBeNull()
  })
})

describe('a working position', () => {
  it('says nothing at all', () => {
    const active = run({ kind: 'idle' }, { type: 'requested' }, { type: 'fixed', position: LYON })

    expect(active).toEqual({ kind: 'active', position: LYON })
    expect(messageFor(active)).toBeNull()
    expect(isRetryable(active)).toBe(true)
    expect(lastKnown(active)).toEqual(LYON)
  })

  // ─────────────────────────────────────────────────────────────
  // The permission listener fires on every grant, including grants
  // we are already acting on. Letting that reach `locating` would
  // drop the point and blink the dot off the map for no reason.
  // ─────────────────────────────────────────────────────────────
  it('ignores a request while it is already located', () => {
    const active: PositionState = { kind: 'active', position: LYON }
    expect(run(active, { type: 'requested' })).toEqual(active)
  })

  it('replaces the previous point as the watch reports, without passing through a gap', () => {
    const moved = fix({ lat: 45.7600, at: 2_000 })
    const state = run(
      { kind: 'active', position: LYON },
      { type: 'fixed', position: moved },
    )

    expect(state).toEqual({ kind: 'active', position: moved })
  })
})
