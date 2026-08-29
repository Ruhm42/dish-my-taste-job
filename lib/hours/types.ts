/** 1 = Monday … 7 = Sunday. Google numbers days differently (0 = Sunday); the
 *  conversion happens on the way in, in `parse.ts`, and nowhere else. */
export type DayOfWeek = 1 | 2 | 3 | 4 | 5 | 6 | 7

/**
 * One service window, in minutes since midnight of the day it opens on.
 * `closesAt` may exceed 1440: a 1:30 a.m. close is written 1530, never 90 on the next day.
 * See .specs/technique/04-modele-de-donnees.md
 */
export interface ServiceWindow {
  day: DayOfWeek
  opensAt: number
  closesAt: number
}

export type SplitShiftRisk = 'none' | 'low' | 'medium' | 'high' | 'unknown'
export type Confidence = 'confirmed' | 'likely' | 'unverified'
export type ServicePattern = 'lunch_only' | 'dinner_only' | 'split' | 'continuous' | 'mixed'
export type TeamSize = 'small' | 'medium' | 'large' | 'unknown'

/**
 * Establishment kinds, grouped by how the work feels rather than by cuisine — the cuisine
 * is reported separately and says nothing about the rhythm.
 * Must stay in step with the `category` enum in lib/db/schema.ts.
 */
export type Category =
  | 'restaurant' | 'bistro' | 'fine_dining' | 'fast_food' | 'pizzeria'
  | 'bar' | 'cafe' | 'bakery' | 'caterer' | 'canteen' | 'other'

/** Shape of the opening hours Google returns (`regularOpeningHours`). */
export interface GoogleTimePoint { day: number; hour: number; minute: number }
export interface GooglePeriod { open: GoogleTimePoint; close?: GoogleTimePoint }
export interface GoogleOpeningHours { periods?: GooglePeriod[] }

export interface RhythmProfile {
  hasHours: boolean
  openDaysCount: number
  closedDays: DayOfWeek[]
  closedSaturday: boolean
  closedSunday: boolean
  closedWeekend: boolean
  maxConsecutiveDaysOff: number
  splitDaysCount: number
  splitShiftRisk: SplitShiftRisk
  confidence: Confidence
  servicePattern: ServicePattern
  earliestOpenMin: number | null
  latestCloseMin: number | null
  weeklyOpenMinutes: number
  /** Sentence shown to the user, in French. A verdict is never displayed without its reason. */
  explanation: string
}
