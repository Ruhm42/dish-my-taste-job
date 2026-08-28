import {
  boolean, doublePrecision, index, integer, jsonb, pgEnum, pgTable, real,
  smallint, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core'

export const risqueCoupureEnum = pgEnum('risque_coupure', ['aucun', 'faible', 'moyen', 'eleve', 'inconnu'])
export const fiabiliteEnum = pgEnum('fiabilite', ['confirme', 'probable', 'a_verifier'])
export const motifServiceEnum = pgEnum('motif_service', ['midi_seul', 'soir_seul', 'coupure', 'continu', 'mixte'])
export const categorieEnum = pgEnum('categorie', [
  'bistrot', 'brasserie', 'gastronomique', 'rapide', 'collectivite', 'bar', 'pizzeria', 'autre',
])
export const statutCandidatureEnum = pgEnum('statut_candidature', [
  'a_contacter', 'cv_depose', 'relance', 'rdv', 'retenu', 'refuse',
])

/**
 * Registre, horaires brutes et profil de rythme dénormalisé.
 * Le profil est ce qu'on filtre : il est calculé une fois en batch, jamais à la requête.
 * Voir .specs/technique/04-modele-de-donnees.md
 */
export const restaurant = pgTable('restaurant', {
  id: uuid('id').defaultRandom().primaryKey(),

  // Identité — seule donnée Google stockable durablement.
  googlePlaceId: text('google_place_id').notNull().unique(),
  name: text('name').notNull(),
  formattedAddress: text('formatted_address'),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  googleTypes: text('google_types').array(),
  businessStatus: text('business_status'),
  inseeCode: text('insee_code'),
  commune: text('commune'),
  arrondissement: smallint('arrondissement'),
  categorie: categorieEnum('categorie').notNull().default('autre'),
  telephone: text('telephone'),

  // Rattachement SIRENE — nul si non apparié : mieux vaut vide que faux.
  siret: text('siret'),
  nafCode: text('naf_code'),
  effectifCode: text('effectif_code'),
  matchScore: real('match_score'),

  // Horaires. On garde le brut à côté du calculé pour pouvoir tout recalculer
  // sans redépenser un appel Google.
  rawOpeningHours: jsonb('raw_opening_hours'),
  hoursFetchedAt: timestamp('hours_fetched_at', { withTimezone: true }),
  hoursExpiresAt: timestamp('hours_expires_at', { withTimezone: true }),
  schedule: jsonb('schedule'),

  // Profil de rythme — les colonnes qu'on filtre.
  hasHours: boolean('has_hours').notNull().default(false),
  openDaysCount: smallint('open_days_count').notNull().default(0),
  closedDays: smallint('closed_days').array(),
  closedSaturday: boolean('closed_saturday').notNull().default(false),
  closedSunday: boolean('closed_sunday').notNull().default(false),
  closedWeekend: boolean('closed_weekend').notNull().default(false),
  maxConsecutiveDaysOff: smallint('max_consecutive_days_off').notNull().default(0),
  splitDaysCount: smallint('split_days_count').notNull().default(0),
  coupureRisk: risqueCoupureEnum('coupure_risk').notNull().default('inconnu'),
  fiabilite: fiabiliteEnum('fiabilite').notNull().default('a_verifier'),
  motifService: motifServiceEnum('motif_service'),
  earliestOpenMin: integer('earliest_open_min'),
  latestCloseMin: integer('latest_close_min'),
  weeklyOpenMinutes: integer('weekly_open_minutes').notNull().default(0),
  explication: text('explication').notNull().default(''),
  profileComputedAt: timestamp('profile_computed_at', { withTimezone: true }),

  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow(),
})

/** Le seul endroit où l'utilisateur écrit — et seulement sur ses propres démarches. */
export const candidature = pgTable('candidature', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull(),
  restaurantId: uuid('restaurant_id').notNull().references(() => restaurant.id, { onDelete: 'cascade' }),
  statut: statutCandidatureEnum('statut').notNull().default('a_contacter'),
  notes: text('notes').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  // Un établissement n'apparaît qu'une fois dans la liste de quelqu'un.
  unParUtilisateur: uniqueIndex('candidature_user_resto').on(t.userId, t.restaurantId),
}))

/**
 * Registre SIRENE géocodé. Deux rôles distincts :
 *  - fournir la tranche d'effectifs, seule source ouverte sur la taille des équipes (D4)
 *  - piloter le maillage du balayage AVANT le premier appel Google (D6)
 */
export const sirene = pgTable('sirene_etablissement', {
  siret: text('siret').primaryKey(),
  siren: text('siren'),
  nom: text('nom'),
  naf: text('naf'),
  effectifCode: text('effectif_code'),
  codeCommune: text('code_commune').notNull(),
  commune: text('commune'),
  adresse: text('adresse'),
  codePostal: text('code_postal'),
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  geocodeScore: real('geocode_score'),
  /** Rempli par match:sirene. Nul tant que non apparié — mieux vide que faux. */
  googlePlaceId: text('google_place_id'),
  importeLe: timestamp('importe_le', { withTimezone: true }).defaultNow(),
}, (t) => ({
  parCommune: index('sirene_commune').on(t.codeCommune),
  parPosition: index('sirene_position').on(t.lat, t.lng),
}))

export const statutCelluleEnum = pgEnum('statut_cellule', [
  'a_faire', 'faite', 'tronquee', 'irreductible', 'echec',
])

/**
 * Une cellule du plan de balayage : un cercle à interroger.
 * Conservées après coup — c'est la trace qui permet de repérer une zone
 * silencieusement manquée, le seul défaut qui ne se voit pas dans l'interface.
 */
export const cellule = pgTable('cellule', {
  id: uuid('id').defaultRandom().primaryKey(),
  sweepRunId: uuid('sweep_run_id').notNull(),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  rayon: doublePrecision('rayon').notNull(),
  /** Nombre d'établissements SIRENE dans la cellule : le détecteur de troncature. */
  sireneCount: integer('sirene_count').notNull().default(0),
  /** Nombre de lieux réellement renvoyés par Google. 20 = tronquée. */
  googleCount: integer('google_count'),
  /** Distance du dernier résultat : révèle le rayon réellement couvert. */
  distanceDernier: doublePrecision('distance_dernier'),
  profondeur: smallint('profondeur').notNull().default(0),
  parentId: uuid('parent_id'),
  statut: statutCelluleEnum('statut').notNull().default('a_faire'),
  interrogeeLe: timestamp('interrogee_le', { withTimezone: true }),
}, (t) => ({
  parRun: index('cellule_run').on(t.sweepRunId, t.statut),
}))

/** Journal de bord du seul poste coûteux du projet. */
export const sweepRun = pgTable('sweep_run', {
  id: uuid('id').defaultRandom().primaryKey(),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  cellsPlanned: integer('cells_planned').notNull().default(0),
  cellsQueried: integer('cells_queried').notNull().default(0),
  callsMade: integer('calls_made').notNull().default(0),
  truncatedUnresolved: integer('truncated_unresolved').notNull().default(0),
  irreducibleCells: integer('irreducible_cells').notNull().default(0),
  placesFound: integer('places_found').notNull().default(0),
  sireneUnmatched: integer('sirene_unmatched').notNull().default(0),
  status: text('status').notNull().default('en_cours'),
  error: text('error'),
})
