import { fenetresDuJour, formatHeure, trierFenetres } from './parse'
import type {
  Categorie, Fenetre, Fiabilite, JourSemaine, MotifService,
  Profil, RisqueCoupure, TailleEquipe,
} from './types'

/**
 * Écart minimal, en minutes, au-delà duquel deux services comptent comme une coupure.
 * 14h30 -> 19h fait 270 min : le salarié rentre chez lui, c'est une vraie coupure.
 * 14h30 -> 15h30 fait 60 min : c'est une respiration de service, ça ne libère personne.
 * Réglable — c'est une hypothèse à confronter au terrain, pas une vérité.
 */
export const SEUIL_COUPURE = 120

/** Frontière midi / soir, pour distinguer un service unique d'un service continu. */
const BASCULE_SOIR = 17 * 60

const TOUS_LES_JOURS: JourSemaine[] = [1, 2, 3, 4, 5, 6, 7]

const EFFECTIF_VERS_TAILLE: Record<string, TailleEquipe> = {
  '00': 'petit', '01': 'petit', '02': 'petit',
  '03': 'moyen', '11': 'moyen',
  '12': 'grand', '21': 'grand', '22': 'grand', '31': 'grand',
  '32': 'grand', '41': 'grand', '42': 'grand', '51': 'grand',
  '52': 'grand', '53': 'grand',
}

const EFFECTIF_LIBELLE: Record<string, string> = {
  '00': 'aucun salarié', '01': '1 à 2 salariés', '02': '3 à 5 salariés',
  '03': '6 à 9 salariés', '11': '10 à 19 salariés', '12': '20 à 49 salariés',
  '21': '50 à 99 salariés', '22': '100 à 199 salariés',
}

export function tailleEquipe(codeEffectif: string | null | undefined): TailleEquipe {
  if (!codeEffectif) return 'inconnu'
  return EFFECTIF_VERS_TAILLE[codeEffectif] ?? 'inconnu'
}

function libelleEffectif(code: string | null | undefined): string | null {
  return code ? (EFFECTIF_LIBELLE[code] ?? null) : null
}

/** Un jour comporte une coupure si deux services y sont séparés d'au moins SEUIL_COUPURE. */
export function jourAvecCoupure(fenetres: Fenetre[]): boolean {
  for (let i = 1; i < fenetres.length; i++) {
    if (fenetres[i].ouvre - fenetres[i - 1].ferme >= SEUIL_COUPURE) return true
  }
  return false
}

/**
 * Plus longue série de jours fermés, en parcours CIRCULAIRE : dimanche suivi de lundi
 * compte comme deux jours consécutifs. Un parcours linéaire manquerait le profil
 * dimanche + lundi, qui est justement l'un des plus recherchés.
 */
export function reposConsecutifsMax(joursFermes: JourSemaine[]): number {
  if (joursFermes.length === 0) return 0
  if (joursFermes.length === 7) return 7

  const ferme = TOUS_LES_JOURS.map((j) => joursFermes.includes(j))
  let max = 0
  let courant = 0
  // Deux tours pour couvrir le bouclage dimanche -> lundi.
  for (let i = 0; i < 14; i++) {
    courant = ferme[i % 7] ? courant + 1 : 0
    if (courant > max) max = courant
  }
  return Math.min(max, 7)
}

function motifService(fenetres: Fenetre[], joursOuverts: JourSemaine[], coupures: number): MotifService {
  if (joursOuverts.length === 0) return 'mixte'
  if (coupures > 0) return 'coupure'

  const parJour = joursOuverts.map((j) => fenetresDuJour(fenetres, j))
  const serviceUnique = parJour.every((f) => f.length === 1)
  if (!serviceUnique) return 'mixte'

  if (parJour.every((f) => f[0].ferme <= BASCULE_SOIR)) return 'midi_seul'
  if (parJour.every((f) => f[0].ouvre >= BASCULE_SOIR)) return 'soir_seul'
  if (parJour.every((f) => f[0].ouvre < BASCULE_SOIR && f[0].ferme > BASCULE_SOIR)) return 'continu'
  return 'mixte'
}

/** Le jour le plus parlant pour illustrer le verdict : celui qui porte la coupure. */
function jourRepresentatif(fenetres: Fenetre[], joursOuverts: JourSemaine[]): Fenetre[] {
  for (const j of joursOuverts) {
    const f = fenetresDuJour(fenetres, j)
    if (jourAvecCoupure(f)) return f
  }
  return joursOuverts.length ? fenetresDuJour(fenetres, joursOuverts[0]) : []
}

function decrireServices(f: Fenetre[]): string {
  if (f.length === 0) return ''
  return f.map((x) => `${formatHeure(x.ouvre)}-${formatHeure(x.ferme)}`).join(' puis ')
}

export interface EntreeProfil {
  fenetres: Fenetre[]
  codeEffectif?: string | null
  categorie?: Categorie
}

/**
 * Traduit des horaires d'OUVERTURE en risque de coupure pour le SALARIÉ.
 *
 * Un restaurant ouvert midi et soir n'impose une coupure que s'il n'a qu'une brigade :
 * à 25 salariés deux équipes se relaient, à 4 c'est mécaniquement impossible.
 * D'où le croisement avec l'effectif. Voir .specs/technique/05-inference-des-horaires.md
 */
export function calculerProfil({ fenetres: brutes, codeEffectif, categorie }: EntreeProfil): Profil {
  const fenetres = trierFenetres(brutes)
  const joursOuverts = TOUS_LES_JOURS.filter((j) => fenetresDuJour(fenetres, j).length > 0)
  const joursFermes = TOUS_LES_JOURS.filter((j) => !joursOuverts.includes(j))

  const aDesHoraires = fenetres.length > 0
  const joursAvecCoupure = joursOuverts.filter((j) => jourAvecCoupure(fenetresDuJour(fenetres, j))).length
  const minutesHebdo = fenetres.reduce((t, f) => t + (f.ferme - f.ouvre), 0)
  const taille = tailleEquipe(codeEffectif)

  const base = {
    aDesHoraires,
    joursOuverts: joursOuverts.length,
    joursFermes,
    fermeSamedi: joursFermes.includes(6),
    fermeDimanche: joursFermes.includes(7),
    fermeWeekend: joursFermes.includes(6) && joursFermes.includes(7),
    reposConsecutifsMax: reposConsecutifsMax(joursFermes),
    joursAvecCoupure,
    motifService: motifService(fenetres, joursOuverts, joursAvecCoupure),
    ouvertureMin: aDesHoraires ? Math.min(...fenetres.map((f) => f.ouvre)) : null,
    fermetureMax: aDesHoraires ? Math.max(...fenetres.map((f) => f.ferme)) : null,
    minutesHebdo,
  }

  const { risqueCoupure, fiabilite, explication } = deduireCoupure({
    aDesHoraires, categorie, joursAvecCoupure, taille, codeEffectif, minutesHebdo,
    motif: base.motifService,
    services: decrireServices(jourRepresentatif(fenetres, joursOuverts)),
  })

  return { ...base, risqueCoupure, fiabilite, explication }
}

function deduireCoupure(ctx: {
  aDesHoraires: boolean
  categorie?: Categorie
  joursAvecCoupure: number
  taille: TailleEquipe
  codeEffectif?: string | null
  minutesHebdo: number
  motif: MotifService
  services: string
}): { risqueCoupure: RisqueCoupure; fiabilite: Fiabilite; explication: string } {
  const { aDesHoraires, categorie, joursAvecCoupure, taille, minutesHebdo, motif, services } = ctx

  // 1. Rien à déduire.
  if (!aDesHoraires) {
    return {
      risqueCoupure: 'inconnu',
      fiabilite: 'a_verifier',
      explication: 'Horaires inconnus — à vérifier sur Google',
    }
  }

  // 2 et 3. Certitudes structurelles : elles court-circuitent le raisonnement sur l'effectif.
  if (categorie === 'collectivite') {
    return {
      risqueCoupure: 'aucun',
      fiabilite: 'confirme',
      explication: `Sans coupure — restauration collective, horaires de journée (${services})`,
    }
  }

  if (joursAvecCoupure === 0) {
    const raison =
      motif === 'midi_seul' ? 'service du midi uniquement'
      : motif === 'soir_seul' ? 'service du soir uniquement'
      : motif === 'mixte' ? 'services rapprochés'
      : 'service continu'
    return {
      risqueCoupure: 'aucun',
      fiabilite: 'confirme',
      explication: `Sans coupure — ${raison} (${services})`,
    }
  }

  // 4. Il y a coupure à l'ouverture : tout dépend du nombre de brigades possibles.
  const effectif = libelleEffectif(ctx.codeEffectif)

  if (taille !== 'inconnu' && effectif) {
    const risque: RisqueCoupure = taille === 'petit' ? 'eleve' : taille === 'moyen' ? 'moyen' : 'faible'
    const mot = taille === 'petit' ? 'très probable' : taille === 'moyen' ? 'possible' : 'peu probable'
    return {
      risqueCoupure: risque,
      fiabilite: 'confirme',
      explication: `Coupure ${mot} — ouvert ${services}, ${effectif}`,
    }
  }

  // Repli : l'effectif est inconnu, ce qui est fréquent chez les petites structures —
  // précisément là où l'information compte le plus. On déduit de l'amplitude, et on
  // dégrade la fiabilité de façon visible plutôt que d'affirmer.
  const grosseAmplitude = minutesHebdo > 70 * 60
  return {
    risqueCoupure: grosseAmplitude ? 'moyen' : 'eleve',
    fiabilite: 'probable',
    explication: grosseAmplitude
      ? `Coupure possible — ouvert ${services}, forte amplitude, effectif inconnu`
      : `Coupure probable — ouvert ${services}, effectif inconnu`,
  }
}
