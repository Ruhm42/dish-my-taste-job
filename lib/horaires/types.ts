/** 1 = lundi … 7 = dimanche. Google numérote autrement (0 = dimanche), la conversion
 *  se fait à l'entrée dans `parse.ts` et nulle part ailleurs. */
export type JourSemaine = 1 | 2 | 3 | 4 | 5 | 6 | 7

/**
 * Une fenêtre de service, en minutes depuis minuit du jour d'ouverture.
 * `ferme` peut dépasser 1440 : une fermeture à 1h30 se note 1530, jamais 90 au jour suivant.
 * Voir .specs/technique/04-modele-de-donnees.md
 */
export interface Fenetre {
  jour: JourSemaine
  ouvre: number
  ferme: number
}

export type RisqueCoupure = 'aucun' | 'faible' | 'moyen' | 'eleve' | 'inconnu'
export type Fiabilite = 'confirme' | 'probable' | 'a_verifier'
export type MotifService = 'midi_seul' | 'soir_seul' | 'coupure' | 'continu' | 'mixte'
export type TailleEquipe = 'petit' | 'moyen' | 'grand' | 'inconnu'

export type Categorie =
  | 'bistrot' | 'brasserie' | 'gastronomique' | 'rapide'
  | 'collectivite' | 'bar' | 'pizzeria' | 'autre'

/** Forme des horaires renvoyées par Google (`regularOpeningHours`). */
export interface GooglePoint { day: number; hour: number; minute: number }
export interface GooglePeriode { open: GooglePoint; close?: GooglePoint }
export interface GoogleHoraires { periods?: GooglePeriode[] }

export interface Profil {
  aDesHoraires: boolean
  joursOuverts: number
  joursFermes: JourSemaine[]
  fermeSamedi: boolean
  fermeDimanche: boolean
  fermeWeekend: boolean
  reposConsecutifsMax: number
  joursAvecCoupure: number
  risqueCoupure: RisqueCoupure
  fiabilite: Fiabilite
  motifService: MotifService
  ouvertureMin: number | null
  fermetureMax: number | null
  minutesHebdo: number
  /** Phrase affichée à l'utilisateur. Le verdict n'est jamais montré sans sa raison. */
  explication: string
}
