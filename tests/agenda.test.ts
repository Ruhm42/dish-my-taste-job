import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

/*
 * The agenda (D53) is only worth keeping if every day file can be acted on without guessing:
 * when, how, what to expect, what the opposite means, and which decision it comes from. These
 * checks hold every file to the format of .specs/agenda/README.md, so a session that writes an
 * item the wrong way fails CI instead of leaving a check nobody can run.
 */

const AGENDA = '.specs/agenda'

const WEEKDAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi']
const MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

/** The fields every detail must carry, by the verb of its checklist line. */
const FIELDS: Record<string, string[]> = {
  'Vérifier': ['Quand', 'Comment', 'Attendu', 'Sinon', 'Vient de'],
  'Faire': ['Quand', 'Comment', 'Attendu', 'Sinon', 'Vient de'],
  'Décider': ['Quand', 'Quoi', "Si rien n'est décidé", 'Vient de'],
}
const MOVED = 'Déplacé'

const CHECKLIST_LINE = /^- \[( |x)\] \*\*([^*]+)\*\*(.*)$/
const DONE_LINE = /^- \*Fait le (\d{4}-\d{2}-\d{2})\*/
const LINK = /\]\(([^)\s]+)\)/g

/** French title of a date: « Dimanche 1er novembre 2026 ». */
function frenchTitle(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  return `${weekday} ${d === 1 ? '1er' : d} ${MONTHS[m - 1]} ${y}`
}

/** GitHub's heading anchors: lower case, punctuation dropped, each space a hyphen. */
function anchors(markdown: string): Set<string> {
  const seen = new Map<string, number>()
  const out = new Set<string>()
  for (const line of markdown.split('\n')) {
    const heading = /^#{1,6} (.*)$/.exec(line)
    if (!heading) continue
    const slug = heading[1].trim().toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\- ]/gu, '').replace(/ /g, '-')
    const n = seen.get(slug) ?? 0
    seen.set(slug, n + 1)
    out.add(n === 0 ? slug : `${slug}-${n}`)
  }
  return out
}

/** Every relative link of a file that does not lead anywhere. A link shown as code is an example. */
function brokenLinks(file: string, text: string): string[] {
  const broken: string[] = []
  const prose = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
  for (const [, target] of prose.matchAll(LINK)) {
    if (/^[a-z]+:/.test(target)) continue
    const [path, anchor] = target.split('#')
    const resolved = path ? normalize(join(dirname(file), path)) : file
    if (!existsSync(resolved)) {
      broken.push(`${target}: no such file`)
    } else if (anchor && resolved.endsWith('.md') && !anchors(readFileSync(resolved, 'utf8')).has(anchor)) {
      broken.push(`${target}: no such heading`)
    }
  }
  return broken
}

interface Item { done: boolean; verb: string; line: string }
interface Detail { title: string; body: string }

function parseDay(text: string): { title: string; items: Item[]; details: Detail[]; hasDetail: boolean } {
  const lines = text.split('\n')
  const items: Item[] = []
  for (const line of lines) {
    if (line === '## Détail') break
    const m = CHECKLIST_LINE.exec(line)
    if (m) items.push({ done: m[1] === 'x', verb: m[2], line })
  }
  const start = lines.indexOf('## Détail')
  const details: Detail[] = []
  if (start >= 0) {
    for (const line of lines.slice(start + 1)) {
      if (line.startsWith('### ')) details.push({ title: line.slice(4), body: '' })
      else if (details.length > 0) details[details.length - 1].body += `${line}\n`
    }
  }
  return { title: lines[0], items, details, hasDetail: start >= 0 }
}

/** A field is a list line opening on its name in italics: `- *Quand* : …`. */
function field(body: string, name: string): string | null {
  const lines = body.split('\n')
  const start = lines.findIndex((l) => l.startsWith(`- *${name}*`))
  if (start < 0) return null
  // The field runs on until the next one, its continuation lines included.
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => /^- \*[^*]+\*/.test(l))
  return [lines[start], ...(end < 0 ? rest : rest.slice(0, end))].join('\n')
}

const days = readdirSync(AGENDA).filter((f) => f !== 'README.md').sort()

describe('the agenda directory', () => {
  it('holds only the README and day files', () => {
    for (const f of days) expect(f, `${AGENDA}/${f}`).toMatch(/^\d{4}-\d{2}-\d{2}\.md$/)
  })

  it('has a README whose links all lead somewhere', () => {
    const file = `${AGENDA}/README.md`
    expect(brokenLinks(file, readFileSync(file, 'utf8'))).toEqual([])
  })
})

describe.each(days)('%s', (name) => {
  const file = `${AGENDA}/${name}`
  const text = readFileSync(file, 'utf8')
  const iso = name.slice(0, 10)
  const day = parseDay(text)
  const pending = day.items.filter((i) => i.verb !== MOVED)

  it('is named after a real date, and titled with it in French', () => {
    expect(new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10)).toBe(iso)
    expect(day.title).toBe(`# ${frenchTitle(iso)}`)
  })

  it('opens on a checklist of known verbs', () => {
    expect(day.items.length).toBeGreaterThan(0)
    for (const item of day.items) {
      expect([...Object.keys(FIELDS), MOVED], item.line).toContain(item.verb)
    }
  })

  it('details every item, in the order of the checklist', () => {
    expect(day.hasDetail, 'a "## Détail" heading').toBe(true)
    expect(day.details.map((d) => d.title)).toHaveLength(pending.length)
  })

  it('gives each detail the fields its verb calls for', () => {
    pending.forEach((item, i) => {
      const detail = day.details[i]
      if (!detail) return
      for (const name of FIELDS[item.verb] ?? []) {
        expect(field(detail.body, name), `"${detail.title}" lacks *${name}*`).not.toBeNull()
      }
    })
  })

  it('names a source for each item: a link in *Vient de*', () => {
    pending.forEach((_, i) => {
      const source = day.details[i] && field(day.details[i].body, 'Vient de')
      if (source !== null && source !== undefined) {
        expect([...source.matchAll(LINK)].length, `"${day.details[i].title}"`).toBeGreaterThan(0)
      }
    })
  })

  it('records what was observed on every checked item, and only on those', () => {
    pending.forEach((item, i) => {
      const detail = day.details[i]
      if (!detail) return
      const recorded = detail.body.split('\n').some((l) => DONE_LINE.test(l))
      expect(recorded, `"${detail.title}" is ${item.done ? 'checked without' : 'unchecked with'} a "Fait le" line`)
        .toBe(item.done)
    })
  })

  it('points a moved item to the day it moved to', () => {
    for (const item of day.items.filter((i) => i.verb === MOVED)) {
      expect(item.done, item.line).toBe(true)
      expect(item.line, item.line).toMatch(/\]\(\d{4}-\d{2}-\d{2}\.md(#[^)]*)?\)/)
    }
  })

  it('has links that all lead somewhere', () => {
    expect(brokenLinks(file, text)).toEqual([])
  })
})
