import type { Fenetre, Profil } from './horaires'

/**
 * Traduction d'un `Profil` en colonnes de la table `restaurant`.
 *
 * Quatre scripts écrivent ces colonnes — `seed`, `sweep:google`, `match:sirene` et
 * `compute:profiles`. Recopiées à quatre endroits, elles finissent par diverger : un
 * script qui oublie `weeklyOpenMinutes` laisse une valeur périmée à côté de quinze
 * valeurs fraîches, et rien ne le signale puisque la ligne existe et paraît complète.
 *
 * `categorie` et `profileComputedAt` restent à l'appelant : le premier n'est pas dérivé
 * du profil, le second date l'exécution et pas le calcul.
 */
export function colonnesProfil(fenetres: Fenetre[], profil: Profil) {
  return {
    schedule: fenetres,
    hasHours: profil.aDesHoraires,
    openDaysCount: profil.joursOuverts,
    closedDays: profil.joursFermes,
    closedSaturday: profil.fermeSamedi,
    closedSunday: profil.fermeDimanche,
    closedWeekend: profil.fermeWeekend,
    maxConsecutiveDaysOff: profil.reposConsecutifsMax,
    splitDaysCount: profil.joursAvecCoupure,
    coupureRisk: profil.risqueCoupure,
    fiabilite: profil.fiabilite,
    motifService: profil.motifService,
    earliestOpenMin: profil.ouvertureMin,
    latestCloseMin: profil.fermetureMax,
    weeklyOpenMinutes: profil.minutesHebdo,
    explication: profil.explication,
  }
}
