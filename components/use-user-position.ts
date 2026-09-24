'use client'

import { useCallback, useEffect, useReducer, useState } from 'react'
import { lastKnown, reduce } from '@/lib/geolocation'
import type { PositionState, UserPosition } from '@/lib/geolocation'

/**
 * `navigator.geolocation`, wired to the state machine in `lib/geolocation.ts`.
 *
 * Deliberately thin: it translates browser callbacks into events and owns the lifetime of
 * the watch. Every decision — what a refusal means, what stays on screen, what can be
 * retried — belongs to the pure module, where it is tested.
 */

const OPTIONS: PositionOptions = {
  // A job hunt happens street by street: a Wi-Fi fix to the neighbourhood would place the
  // reader on the wrong side of the block, which is the only distinction that matters here.
  enableHighAccuracy: true,
  timeout: 10_000,
  maximumAge: 15_000,
}

function toUserPosition(p: GeolocationPosition): UserPosition {
  return {
    lat: p.coords.latitude,
    lng: p.coords.longitude,
    accuracy: p.coords.accuracy,
    at: p.timestamp,
  }
}

export interface UserPositionHandle {
  state: PositionState
  /** The last point held, whatever the current state. What the map draws. */
  position: UserPosition | null
  /** Ask for the position. The prompt appears here, and nowhere else. */
  request: () => void
}

/**
 * @param enabled whether the map is on screen. The watch runs only while it is.
 */
export function useUserPosition(enabled: boolean): UserPositionHandle {
  const [state, dispatch] = useReducer(reduce, { kind: 'idle' })

  // Answered on mount rather than at init: this component is server-rendered too, and
  // reading `navigator` during that render would make the server emit a button where the
  // client emits "your browser cannot".
  useEffect(() => {
    dispatch({
      type: 'environment',
      env: {
        supported: 'geolocation' in navigator,
        // False over plain http — a phone reaching a dev server by its LAN address, for
        // instance. The API is present there and refuses every call, so the reason has to
        // be named or it reads as a broken feature.
        secure: window.isSecureContext,
      },
    })
  }, [])

  /**
   * Silent restore, and withdrawal.
   *
   * Someone who has already granted the permission should not have to grant it again on
   * every visit; someone who revokes it mid-visit must be told rather than left watching a
   * dot that has stopped moving.
   */
  useEffect(() => {
    // Not universal, and its absence is not a failure: without it we simply do not know in
    // advance, and the button is still there to ask.
    if (!navigator.permissions) return

    let cancelled = false
    let status: PermissionStatus | null = null

    const onChange = () => {
      if (!status) return
      if (status.state === 'denied') dispatch({ type: 'revoked' })
      if (status.state === 'granted') dispatch({ type: 'requested' })
    }

    void (async () => {
      try {
        status = await navigator.permissions.query({ name: 'geolocation' })
      } catch {
        // Safari has not always known this permission name and throws for it. Not knowing
        // is not a refusal — leave the button to do the asking.
        return
      }
      if (cancelled) {
        status = null
        return
      }
      if (status.state === 'granted') dispatch({ type: 'requested' })
      status.addEventListener('change', onChange)
    })()

    return () => {
      cancelled = true
      status?.removeEventListener('change', onChange)
    }
  }, [])

  /**
   * The browser tab itself. A phone in a pocket keeps the page mounted, and a GPS left
   * running there costs battery for a map nobody is looking at.
   */
  const [pageVisible, setPageVisible] = useState(true)
  useEffect(() => {
    const sync = () => setPageVisible(document.visibilityState === 'visible')
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [])

  /**
   * The watch.
   *
   * `wanted` is collapsed to a boolean on purpose: it stays true across `locating` →
   * `active`, so a first fix does not tear down the watch that just produced it and start
   * another. Depending on `state` here would restart the GPS on every single update.
   */
  const wanted = state.kind === 'locating' || state.kind === 'active'

  useEffect(() => {
    if (!enabled || !pageVisible || !wanted) return

    // This call is what raises the permission prompt — there is no separate ask.
    const id = navigator.geolocation.watchPosition(
      (p) => dispatch({ type: 'fixed', position: toUserPosition(p) }),
      (e) => dispatch({ type: 'error', code: e.code }),
      OPTIONS,
    )

    return () => {
      navigator.geolocation.clearWatch(id)
      dispatch({ type: 'stopped' })
    }
  }, [enabled, pageVisible, wanted])

  const request = useCallback(() => dispatch({ type: 'requested' }), [])

  return { state, position: lastKnown(state), request }
}
