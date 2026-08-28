'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useTransition } from 'react'
import { CATEGORIE_LABEL, ZONES } from './badges'

/** Les filtres vivent dans l'URL : une recherche se met en favori et se partage. */
export function PanneauFiltres({ nbActifs }: { nbActifs: number }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [enCours, demarrer] = useTransition()

  const maj = useCallback((mut: (p: URLSearchParams) => void) => {
    const p = new URLSearchParams(params.toString())
    mut(p)
    demarrer(() => router.replace(`${pathname}?${p.toString()}`, { scroll: false }))
  }, [params, pathname, router])

  const set = (cle: string, val: string) =>
    maj((p) => (val ? p.set(cle, val) : p.delete(cle)))

  const bascule = (cle: string, val: string) => maj((p) => {
    const actuels = p.getAll(cle)
    p.delete(cle)
    const suivants = actuels.includes(val) ? actuels.filter((v) => v !== val) : [...actuels, val]
    suivants.forEach((v) => p.append(cle, v))
  })

  const a = (cle: string, val: string) => params.getAll(cle).includes(val)
  const v = (cle: string) => params.get(cle) ?? ''

  return (
    <aside className={`space-y-6 ${enCours ? 'opacity-60' : ''} transition-opacity`}>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Filtres</h2>
        {nbActifs > 0 && (
          <button
            onClick={() => demarrer(() => router.replace(pathname, { scroll: false }))}
            className="text-sm text-stone-600 underline underline-offset-2 hover:text-stone-900"
          >
            Tout effacer ({nbActifs})
          </button>
        )}
      </div>

      <Bloc titre="Nom ou commune">
        <input
          type="search"
          defaultValue={v('q')}
          placeholder="Rechercher…"
          onChange={(e) => set('q', e.target.value)}
          className="w-full rounded border border-stone-300 px-3 py-2 text-sm"
        />
      </Bloc>

      <Bloc titre="Rythme de travail">
        <Choix label="Sans coupure" options={[
          ['', 'Peu importe'], ['sans', 'Oui'], ['sans-ou-probable', 'Oui ou probablement'],
        ]} valeur={v('coupure')} onChange={(x) => set('coupure', x)} />

        <Choix label="Week-end" options={[
          ['', 'Peu importe'], ['libre', 'Samedi et dimanche libres'], ['dimanche', 'Dimanche libre'],
        ]} valeur={v('weekend')} onChange={(x) => set('weekend', x)} />

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v('repos2') === '1'}
            onChange={(e) => set('repos2', e.target.checked ? '1' : '')} />
          2 jours de repos d’affilée
        </label>
      </Bloc>

      <Bloc titre="Zone">
        <div className="flex flex-wrap gap-1.5">
          {ZONES.map((z) => (
            <Puce key={z.insee} actif={a('zone', z.insee)} onClick={() => bascule('zone', z.insee)}>
              {z.label}
            </Puce>
          ))}
        </div>
      </Bloc>

      <Bloc titre="Type d’établissement">
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(CATEGORIE_LABEL).map(([cle, label]) => (
            <Puce key={cle} actif={a('categorie', cle)} onClick={() => bascule('categorie', cle)}>
              {label}
            </Puce>
          ))}
        </div>
      </Bloc>

      <Bloc titre="Taille de l’équipe">
        <Choix label="" options={[
          ['', 'Peu importe'], ['petit', 'Jusqu’à 5 salariés'],
          ['moyen', '6 à 19'], ['grand', '20 et plus'],
        ]} valeur={v('taille')} onChange={(x) => set('taille', x)} />
      </Bloc>
    </aside>
  )
}

function Bloc({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">{titre}</h3>
      {children}
    </div>
  )
}

function Choix({ label, options, valeur, onChange }: {
  label: string
  options: [string, string][]
  valeur: string
  onChange: (v: string) => void
}) {
  return (
    <div className="space-y-1">
      {label && <p className="text-sm text-stone-700">{label}</p>}
      <select
        value={valeur}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-stone-300 bg-white px-3 py-2 text-sm"
      >
        {options.map(([val, lib]) => <option key={val} value={val}>{lib}</option>)}
      </select>
    </div>
  )
}

function Puce({ actif, onClick, children }: {
  actif: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs transition ${
        actif ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 bg-white hover:border-stone-500'
      }`}
    >
      {children}
    </button>
  )
}
