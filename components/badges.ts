import type { Fiabilite, RisqueCoupure } from '@/lib/horaires'

/** Vocabulaire métier, jamais technique. Aucun score chiffré n'est affiché. */
export const RISQUE: Record<RisqueCoupure, { label: string; couleur: string; classe: string }> = {
  aucun:   { label: 'Sans coupure',          couleur: '#16a34a', classe: 'bg-green-100 text-green-900 border-green-300' },
  faible:  { label: 'Coupure peu probable',  couleur: '#84cc16', classe: 'bg-lime-100 text-lime-900 border-lime-300' },
  moyen:   { label: 'Coupure possible',      couleur: '#f59e0b', classe: 'bg-amber-100 text-amber-900 border-amber-300' },
  eleve:   { label: 'Coupure probable',      couleur: '#dc2626', classe: 'bg-red-100 text-red-900 border-red-300' },
  inconnu: { label: 'Horaires inconnus',     couleur: '#a8a29e', classe: 'bg-stone-100 text-stone-600 border-stone-300' },
}

export const FIABILITE: Record<Fiabilite, string> = {
  confirme: 'Confirmé',
  probable: 'Probable',
  a_verifier: 'À vérifier',
}

export const CATEGORIE_LABEL: Record<string, string> = {
  bistrot: 'Bistrot', brasserie: 'Brasserie', gastronomique: 'Gastronomique',
  rapide: 'Restauration rapide', collectivite: 'Restauration collective',
  bar: 'Bar', pizzeria: 'Pizzeria', autre: 'Autre',
}

export const ZONES = [
  { insee: '69381', label: 'Lyon 1er' }, { insee: '69382', label: 'Lyon 2e' },
  { insee: '69383', label: 'Lyon 3e' }, { insee: '69384', label: 'Lyon 4e' },
  { insee: '69385', label: 'Lyon 5e' }, { insee: '69386', label: 'Lyon 6e' },
  { insee: '69387', label: 'Lyon 7e' }, { insee: '69388', label: 'Lyon 8e' },
  { insee: '69389', label: 'Lyon 9e' }, { insee: '69266', label: 'Villeurbanne' },
  { insee: '69029', label: 'Bron' }, { insee: '69259', label: 'Vénissieux' },
]
