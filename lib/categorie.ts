import type { Categorie } from './horaires'

/**
 * Déduction de la catégorie d'établissement à partir des trois seuls signaux dont on
 * dispose : types Google, code d'activité SIRENE, nom.
 *
 * La catégorie sert à deux choses : c'est un filtre exposé à l'utilisateur, et c'est un
 * raccourci d'inférence — la restauration collective court-circuite tout le raisonnement
 * sur la coupure. Voir .specs/technique/05-inference-des-horaires.md, étape 5.
 *
 * `autre` signifie « aucun indice », pas « c'est autre chose ». L'appelant qui dispose
 * déjà d'une catégorie ne doit pas l'écraser avec cette valeur.
 */

/** Le code d'activité s'écrit `56.10C` en config et `5610C` dans le fichier stock SIRENE. */
const sansSeparateur = (code: string): string => code.toUpperCase().replace(/[^0-9A-Z]/g, '')

const NAF_COLLECTIVITE = ['56.29A', '56.29B'].map(sansSeparateur)
const NAF_RAPIDE = sansSeparateur('56.10C')
const NAF_BAR = sansSeparateur('56.30Z')

/**
 * Google nomme le même concept `fast_food_restaurant` (Places v1) ou `fast_food`
 * (ancienne API) : on cherche le fragment plutôt que d'énumérer les variantes.
 */
const FRAGMENT_RAPIDE = 'fast_food'
const FRAGMENT_PIZZA = 'pizza'

const AUTRES_TYPES_RAPIDE = new Set(['hamburger_restaurant', 'sandwich_shop'])

/** Correspondance exacte, sinon `barbecue_restaurant` deviendrait un bar. */
const TYPES_BAR = new Set(['bar', 'pub', 'wine_bar'])

const TYPE_GASTRONOMIQUE = 'fine_dining_restaurant'

const MOTS_GASTRONOMIQUE = /gastronomi/
const MOTS_BRASSERIE = /brasserie|taverne/
const MOTS_BISTROT = /bistro|bouchon|estaminet|troquet/

/** Minuscules sans accents : « Pizzéria » et « PIZZERIA » doivent tomber sur la même règle. */
const normaliserNom = (nom: string): string =>
  nom.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

export interface SignauxCategorie {
  /** `googleTypes` de l'établissement. */
  types?: readonly string[] | null
  /** Code d'activité SIRENE, nul tant que l'établissement n'est pas apparié. */
  naf?: string | null
  nom?: string | null
}

export function deduireCategorie({ types, naf, nom }: SignauxCategorie): Categorie {
  const t = new Set((types ?? []).map((x) => x.toLowerCase()))
  const code = naf ? sansSeparateur(naf) : ''
  const n = nom ? normaliserNom(nom) : ''

  const unTypeContient = (fragment: string) => [...t].some((x) => x.includes(fragment))

  // Le code d'activité prime : c'est le seul signal déclaré, les deux autres sont du
  // commerce. La collectivité passe en premier parce qu'elle court-circuite l'inférence
  // de coupure — se tromper ici affirmerait « sans coupure » à tort.
  if (NAF_COLLECTIVITE.includes(code)) return 'collectivite'

  if (code === NAF_RAPIDE || unTypeContient(FRAGMENT_RAPIDE)) return 'rapide'
  if ([...t].some((x) => AUTRES_TYPES_RAPIDE.has(x))) return 'rapide'

  if (code === NAF_BAR || [...t].some((x) => TYPES_BAR.has(x))) return 'bar'

  if (unTypeContient(FRAGMENT_PIZZA) || /pizz/.test(n)) return 'pizzeria'

  if (t.has(TYPE_GASTRONOMIQUE) || MOTS_GASTRONOMIQUE.test(n)) return 'gastronomique'
  if (MOTS_BRASSERIE.test(n)) return 'brasserie'
  if (MOTS_BISTROT.test(n)) return 'bistrot'

  return 'autre'
}
