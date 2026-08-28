import type { Fenetre, GoogleHoraires, GooglePeriode, JourSemaine } from './types'

const MINUTES_PAR_JOUR = 1440

/** Google : 0 = dimanche. Nous : 1 = lundi, 7 = dimanche. */
function versJourSemaine(jourGoogle: number): JourSemaine {
  return (jourGoogle === 0 ? 7 : jourGoogle) as JourSemaine
}

/**
 * Un établissement ouvert en continu renvoie une ouverture SANS fermeture associée.
 * C'est le seul cas où `close` est absent.
 */
function estOuvertEnContinu(periodes: GooglePeriode[]): boolean {
  return periodes.some((p) => p.open && !p.close)
}

function fenetresContinues(): Fenetre[] {
  return ([1, 2, 3, 4, 5, 6, 7] as JourSemaine[]).map((jour) => ({
    jour,
    ouvre: 0,
    ferme: MINUTES_PAR_JOUR,
  }))
}

/**
 * Convertit les horaires Google en fenêtres normalisées.
 *
 * Trois pièges traités ici, et nulle part ailleurs :
 *  - `day` 0 vaut dimanche, pas lundi
 *  - une fermeture après minuit porte le jour SUIVANT : on la ramène sur le jour
 *    d'ouverture en dépassant 1440
 *  - une ouverture sans fermeture signifie 24h/24
 *
 * Un jour fermé est simplement absent des périodes : ce n'est pas une plage vide.
 */
export function parserHoraires(horaires: GoogleHoraires | null | undefined): Fenetre[] {
  const periodes = horaires?.periods
  if (!periodes || periodes.length === 0) return []

  if (estOuvertEnContinu(periodes)) return fenetresContinues()

  const fenetres: Fenetre[] = []

  for (const periode of periodes) {
    if (!periode.open || !periode.close) continue

    const jour = versJourSemaine(periode.open.day)
    const ouvre = periode.open.hour * 60 + periode.open.minute
    const fermeBrut = periode.close.hour * 60 + periode.close.minute

    // Écart de jours entre ouverture et fermeture, en tenant compte du bouclage
    // samedi -> dimanche. Vaut 0 (même jour) ou 1 (après minuit).
    const ecartJours = (periode.close.day - periode.open.day + 7) % 7
    let ferme = ecartJours * MINUTES_PAR_JOUR + fermeBrut

    // Filet : une fermeture antérieure à l'ouverture le même jour est une fermeture
    // après minuit mal étiquetée.
    if (ferme <= ouvre) ferme += MINUTES_PAR_JOUR

    fenetres.push({ jour, ouvre, ferme })
  }

  return trierFenetres(fenetres)
}

export function trierFenetres(fenetres: Fenetre[]): Fenetre[] {
  return [...fenetres].sort((a, b) => a.jour - b.jour || a.ouvre - b.ouvre)
}

export function fenetresDuJour(fenetres: Fenetre[], jour: JourSemaine): Fenetre[] {
  return fenetres.filter((f) => f.jour === jour).sort((a, b) => a.ouvre - b.ouvre)
}

/** 750 -> "12h30", 720 -> "12h", 1530 -> "1h30" (le lendemain). */
export function formatHeure(minutes: number): string {
  const m = minutes % MINUTES_PAR_JOUR
  const h = Math.floor(m / 60)
  const reste = m % 60
  return reste === 0 ? `${h}h` : `${h}h${String(reste).padStart(2, '0')}`
}
