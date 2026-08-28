import { describe, expect, it } from 'vitest'
import { calculerProfil, parserHoraires, reposConsecutifsMax } from '@/lib/horaires'
import type { GoogleHoraires, GooglePeriode } from '@/lib/horaires'

/** Google numérote 0 = dimanche, 1 = lundi … 6 = samedi. */
const DIM = 0, LUN = 1, MAR = 2, MER = 3, JEU = 4, VEN = 5, SAM = 6

const p = (jourO: number, hO: number, mO: number, jourF: number, hF: number, mF: number) => ({
  open: { day: jourO, hour: hO, minute: mO },
  close: { day: jourF, hour: hF, minute: mF },
})

const horaires = (...periods: GooglePeriode[]): GoogleHoraires => ({ periods })

const profilDe = (h: GoogleHoraires | null, codeEffectif?: string | null) =>
  calculerProfil({ fenetres: parserHoraires(h), codeEffectif })

// ─────────────────────────────────────────────────────────────
// Les trois pièges Google. Ceux-là cassent en silence : ils passent d'abord.
// ─────────────────────────────────────────────────────────────
describe('pièges de conversion Google', () => {
  it('numérote le dimanche 0 côté Google et 7 côté application', () => {
    const f = parserHoraires(horaires(p(DIM, 12, 0, DIM, 15, 0)))
    expect(f).toHaveLength(1)
    expect(f[0].jour).toBe(7)
  })

  it('ramène une fermeture après minuit sur le jour d’ouverture, au-delà de 1440', () => {
    // Samedi 19h -> dimanche 1h30. Google date la fermeture au dimanche.
    const f = parserHoraires(horaires(p(SAM, 19, 0, DIM, 1, 30)))
    expect(f).toHaveLength(1)
    expect(f[0].jour).toBe(6)        // reste rattaché au samedi
    expect(f[0].ouvre).toBe(19 * 60) // 1140
    expect(f[0].ferme).toBe(1530)    // 1440 + 90, et non 90
  })

  it('traite une ouverture sans fermeture comme du 24h/24', () => {
    const f = parserHoraires({ periods: [{ open: { day: DIM, hour: 0, minute: 0 } }] })
    expect(f).toHaveLength(7)
    expect(f.every((x) => x.ouvre === 0 && x.ferme === 1440)).toBe(true)

    const profil = calculerProfil({ fenetres: f })
    expect(profil.joursOuverts).toBe(7)
    expect(profil.risqueCoupure).toBe('aucun')
  })
})

// ─────────────────────────────────────────────────────────────
// Cas normaux
// ─────────────────────────────────────────────────────────────
describe('cas normaux', () => {
  it('considère un jour absent des périodes comme fermé, sans erreur', () => {
    const profil = profilDe(horaires(p(MAR, 12, 0, MAR, 15, 0)))
    expect(profil.joursOuverts).toBe(1)
    expect(profil.joursFermes).toEqual([1, 3, 4, 5, 6, 7])
  })

  it('accepte l’absence totale d’horaires sans planter', () => {
    for (const vide of [null, {}, { periods: [] }] as (GoogleHoraires | null)[]) {
      const profil = profilDe(vide)
      expect(profil.aDesHoraires).toBe(false)
      expect(profil.risqueCoupure).toBe('inconnu')
      expect(profil.fiabilite).toBe('a_verifier')
    }
  })
})

// ─────────────────────────────────────────────────────────────
// Détection de la coupure
// ─────────────────────────────────────────────────────────────
describe('détection de la coupure', () => {
  it('détecte une coupure classique 12h-14h30 / 19h-22h30', () => {
    const profil = profilDe(horaires(
      p(MAR, 12, 0, MAR, 14, 30),
      p(MAR, 19, 0, MAR, 22, 30),
    ), '02')
    expect(profil.joursAvecCoupure).toBe(1)
    expect(profil.motifService).toBe('coupure')
  })

  it('ne compte PAS un écart court comme une coupure', () => {
    // 14h30 -> 15h30 : une respiration de service, ça ne libère personne.
    const profil = profilDe(horaires(
      p(MAR, 12, 0, MAR, 14, 30),
      p(MAR, 15, 30, MAR, 22, 0),
    ), '02')
    expect(profil.joursAvecCoupure).toBe(0)
    expect(profil.risqueCoupure).toBe('aucun')
  })

  it('reconnaît un service continu', () => {
    const profil = profilDe(horaires(p(MAR, 11, 0, MAR, 23, 0)), '02')
    expect(profil.motifService).toBe('continu')
    expect(profil.risqueCoupure).toBe('aucun')
  })

  it('reconnaît un service du midi seul', () => {
    const profil = profilDe(horaires(
      p(LUN, 12, 0, LUN, 15, 0),
      p(MAR, 12, 0, MAR, 15, 0),
    ), '02')
    expect(profil.motifService).toBe('midi_seul')
    expect(profil.risqueCoupure).toBe('aucun')
  })
})

// ─────────────────────────────────────────────────────────────
// Jours de repos — le parcours doit être circulaire
// ─────────────────────────────────────────────────────────────
describe('jours de repos', () => {
  it('compte dimanche + lundi comme deux jours consécutifs', () => {
    expect(reposConsecutifsMax([7, 1])).toBe(2)
  })

  it('compte samedi + dimanche comme deux jours consécutifs', () => {
    expect(reposConsecutifsMax([6, 7])).toBe(2)
  })

  it('ne relie pas deux jours de repos séparés', () => {
    expect(reposConsecutifsMax([1, 4])).toBe(1)
  })

  it('repère la fermeture dimanche + lundi sur un vrai profil', () => {
    const profil = profilDe(horaires(
      p(MAR, 12, 0, MAR, 15, 0), p(MER, 12, 0, MER, 15, 0),
      p(JEU, 12, 0, JEU, 15, 0), p(VEN, 12, 0, VEN, 15, 0),
      p(SAM, 12, 0, SAM, 15, 0),
    ))
    expect(profil.joursFermes).toEqual([1, 7])
    expect(profil.reposConsecutifsMax).toBe(2)
    expect(profil.fermeDimanche).toBe(true)
    expect(profil.fermeWeekend).toBe(false) // samedi ouvert
  })

  it('repère un week-end complet libre', () => {
    const profil = profilDe(horaires(
      p(LUN, 12, 0, LUN, 15, 0), p(MAR, 12, 0, MAR, 15, 0),
      p(MER, 12, 0, MER, 15, 0), p(JEU, 12, 0, JEU, 15, 0),
      p(VEN, 12, 0, VEN, 15, 0),
    ))
    expect(profil.fermeWeekend).toBe(true)
    expect(profil.reposConsecutifsMax).toBe(2)
  })
})

// ─────────────────────────────────────────────────────────────
// Le cœur : horaires d'ouverture != horaires de travail
// ─────────────────────────────────────────────────────────────
describe('inférence du risque pour le salarié', () => {
  const coupure = horaires(
    p(MAR, 12, 0, MAR, 14, 30),
    p(MAR, 19, 0, MAR, 22, 30),
  )

  it('petite équipe : la coupure est mécaniquement certaine', () => {
    const profil = profilDe(coupure, '02') // 3 à 5 salariés
    expect(profil.risqueCoupure).toBe('eleve')
    expect(profil.fiabilite).toBe('confirme')
  })

  it('grande équipe : deux brigades sont probables', () => {
    const profil = profilDe(coupure, '12') // 20 à 49 salariés
    expect(profil.risqueCoupure).toBe('faible')
  })

  it('équipe moyenne : risque intermédiaire', () => {
    const profil = profilDe(coupure, '11') // 10 à 19 salariés
    expect(profil.risqueCoupure).toBe('moyen')
  })

  it('effectif inconnu : on dégrade la fiabilité au lieu d’affirmer', () => {
    const profil = profilDe(coupure, null)
    expect(profil.fiabilite).toBe('probable')
    expect(profil.risqueCoupure).toBe('eleve') // hypothèse prudente
  })

  it('la restauration collective court-circuite le raisonnement sur l’effectif', () => {
    const profil = calculerProfil({
      fenetres: parserHoraires(horaires(p(MAR, 7, 0, MAR, 15, 0))),
      codeEffectif: '02',
      categorie: 'collectivite',
    })
    expect(profil.risqueCoupure).toBe('aucun')
  })
})

// ─────────────────────────────────────────────────────────────
// Explicabilité : le verdict n'est jamais montré sans sa raison
// ─────────────────────────────────────────────────────────────
describe('explicabilité', () => {
  it('énonce les horaires ET l’effectif dans l’explication', () => {
    const profil = profilDe(horaires(
      p(MAR, 12, 0, MAR, 14, 30),
      p(MAR, 19, 0, MAR, 22, 30),
    ), '02')
    expect(profil.explication).toBe(
      'Coupure très probable — ouvert 12h-14h30 puis 19h-22h30, 3 à 5 salariés',
    )
  })

  it('signale explicitement l’effectif inconnu', () => {
    const profil = profilDe(horaires(
      p(MAR, 12, 0, MAR, 14, 30),
      p(MAR, 19, 0, MAR, 22, 30),
    ), null)
    expect(profil.explication).toContain('effectif inconnu')
  })

  it('n’affiche jamais de score chiffré', () => {
    const profil = profilDe(horaires(p(MAR, 11, 0, MAR, 23, 0)), '02')
    expect(profil.explication).not.toMatch(/\d+\s*%|0\.\d/)
  })
})
