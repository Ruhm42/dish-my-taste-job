'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useTransition } from 'react'
import { CATEGORY_LABELS, FILTERABLE_CATEGORIES, ZONES } from './badges'
import { JobBoards } from './job-boards'

/**
 * Filters live in the URL: a search can be bookmarked and shared.
 *
 * Parameter names and values are therefore frozen — they appear in links people already
 * hold. `categorie` is the exception: its values are the `category` enum, so they moved
 * with it. See lib/filters.ts.
 */
export function FiltersPanel({ activeCount }: { activeCount: number }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const update = useCallback((mutate: (p: URLSearchParams) => void) => {
    const p = new URLSearchParams(params.toString())
    mutate(p)
    startTransition(() => router.replace(`${pathname}?${p.toString()}`, { scroll: false }))
  }, [params, pathname, router])

  const set = (key: string, value: string) =>
    update((p) => (value ? p.set(key, value) : p.delete(key)))

  const toggle = (key: string, value: string) => update((p) => {
    const current = p.getAll(key)
    p.delete(key)
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
    next.forEach((v) => p.append(key, v))
  })

  const isOn = (key: string, value: string) => params.getAll(key).includes(value)
  const valueOf = (key: string) => params.get(key) ?? ''

  return (
    <aside className={`space-y-6 ${isPending ? 'opacity-60' : ''} transition-opacity`}>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Filtres</h2>
        {activeCount > 0 && (
          <button
            onClick={() => startTransition(() => router.replace(pathname, { scroll: false }))}
            className="text-sm text-stone-600 underline underline-offset-2 hover:text-stone-900"
          >
            Tout effacer ({activeCount})
          </button>
        )}
      </div>

      <Section title="Nom ou commune">
        <input
          type="search"
          defaultValue={valueOf('q')}
          placeholder="Rechercher…"
          onChange={(e) => set('q', e.target.value)}
          className="w-full rounded border border-stone-300 px-3 py-2 text-sm"
        />
      </Section>

      <Section title="Rythme de travail">
        <Choice label="Sans coupure" options={[
          ['', 'Peu importe'], ['sans', 'Oui'], ['sans-ou-probable', 'Oui ou probablement'],
        ]} value={valueOf('coupure')} onChange={(x) => set('coupure', x)} />

        <Choice label="Week-end" options={[
          ['', 'Peu importe'], ['libre', 'Samedi et dimanche libres'], ['dimanche', 'Dimanche libre'],
        ]} value={valueOf('weekend')} onChange={(x) => set('weekend', x)} />

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={valueOf('repos2') === '1'}
            onChange={(e) => set('repos2', e.target.checked ? '1' : '')} />
          2 jours de repos d’affilée
        </label>
      </Section>

      {/* Right after the rhythm block, because it is what qualifies it: on a sheet with no
          hours the tool cannot answer a single one of those three questions. */}
      <Section title="Horaires inconnus">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={valueOf('inconnus') === '1'}
            onChange={(e) => set('inconnus', e.target.checked ? '1' : '')}
          />
          <span>
            Afficher les établissements sans horaires publiés
            <span className="block text-xs text-stone-500">
              L’outil ne peut rien dire de leur rythme de travail.
            </span>
          </span>
        </label>
      </Section>

      <Section title="Zone">
        <div className="flex flex-wrap gap-1.5">
          {ZONES.map((z) => (
            <Chip key={z.insee} active={isOn('zone', z.insee)} onClick={() => toggle('zone', z.insee)}>
              {z.label}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="Type d’établissement">
        <div className="flex flex-wrap gap-1.5">
          {/* Driven by FILTERABLE_CATEGORIES, not by every label: `canteen` and
              `fine_dining` exist in the enum but would only ever return nothing. */}
          {FILTERABLE_CATEGORIES.map((key) => (
            <Chip key={key} active={isOn('categorie', key)} onClick={() => toggle('categorie', key)}>
              {CATEGORY_LABELS[key]}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="Taille de l’équipe">
        <Choice label="" options={[
          ['', 'Peu importe'], ['petit', 'Jusqu’à 5 salariés'],
          ['moyen', '6 à 19'], ['grand', '20 et plus'],
        ]} value={valueOf('taille')} onChange={(x) => set('taille', x)} />
      </Section>

      {/* Last, and deliberately outside every Section: it filters nothing. */}
      <JobBoards />
    </aside>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">{title}</h3>
      {children}
    </div>
  )
}

function Choice({ label, options, value, onChange }: {
  label: string
  options: [string, string][]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="space-y-1">
      {label && <p className="text-sm text-stone-700">{label}</p>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-stone-300 bg-white px-3 py-2 text-sm"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>{optionLabel}</option>
        ))}
      </select>
    </div>
  )
}

function Chip({ active, onClick, children }: {
  active: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs transition ${
        active ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 bg-white hover:border-stone-500'
      }`}
    >
      {children}
    </button>
  )
}
