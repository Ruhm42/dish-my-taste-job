---
name: agenda
description: Write, move or close items in .specs/agenda/, the day-by-day list of what has to be checked, done or decided on a given date (D53). Use whenever work here creates, moves or settles something with a date — a decision or annotation that sets a deadline, a deploy, migration or schedule change whose effect first shows on a later day, an open choice with a cut-off, a scheduled pass or run to verify — when a check is performed and its result must be recorded, and before any work on the import cycle, to read what is due. Also when the user asks what is due, what to check, or to add something to the agenda.
user-invocable: true
---

# /agenda — what is due, and when

`.specs/agenda/` holds one file per day that carries something: checks, actions and decisions
with a date, each pointing to the decision it comes from. Its README gives the rationale, the
recurring rhythm and the checklist for every pass. This skill is the procedure.

**The agenda decides nothing.** An item points to a decision (`Dxx`), an open choice (`Cx`) or
a spec section. If the source is wrong, fix the source first, then the item.

**CI enforces the format.** `tests/agenda.test.ts` runs in `npm test`: a malformed day file fails
the build. Run it before committing:

```bash
npx vitest run tests/agenda.test.ts
```

---

## 1. Read what is due

Before touching the cycle, a deploy, or anything the agenda mentions:

```bash
ls .specs/agenda
```

Read today's file and the next ones, plus *Ce qui revient* and *À chaque passe* in the README.
Unchecked items from past days are overdue: say so.

## 2. When an item has to be written

Write one, **in the same commit as the work that creates it**, when:

- a decision, annotation or spec you write states a date, a deadline (« avant le … »), a cut-off,
  or « the first time » something happens;
- you ship something whose effect only shows later: a deploy that a scheduled run will exercise
  first, a hand migration, a schedule or ceiling change;
- an open choice in `PROCHAINES-ETAPES` has a date after which an option is gone;
- evidence is about to expire — Actions logs after 90 days, Vercel logs after about an hour —
  and the figures matter: record them in the day file of the event.

A change to something **recurring** (a new scheduled workflow, a new daily check, a time change)
goes in the README's *Ce qui revient* table, not in a day file.

## 3. Adding an item

1. **Pick the day**: the day the item becomes checkable, or the last day it can still be done.
   Times are UTC; GitHub schedules start up to 8 hours late.
2. **Open or create** `.specs/agenda/AAAA-MM-JJ.md`. The first line is the date in French,
   weekday first, `1er` for the first of the month: `# Dimanche 1er novembre 2026`. The test
   checks the weekday.
3. **Add the checklist line** at the top, in time order: `- [ ] **Verb**, time — what.` The
   verb is one of:
   - **Vérifier**: read a result and compare it with what is expected, read-only;
   - **Faire**: an action, saying what it touches;
   - **Décider**: an open choice with a deadline. It is settled in `PROCHAINES-ETAPES` or by a
     decision, never in the agenda.
4. **Add its detail** under `## Détail`, as a `###` section **at the same position as its
   checklist line**: the test pairs them by order. The fields are list lines opening on the
   field name in italics, and depend on the verb:

   | Verb | Fields, all required |
   |---|---|
   | Vérifier, Faire | `*Quand*`, `*Comment*`, `*Attendu*`, `*Sinon*`, `*Vient de*` |
   | Décider | `*Quand*`, `*Quoi*`, `*Si rien n'est décidé*`, `*Vient de*` |

5. **`*Vient de*` carries at least one relative link**: a decision anchor
   (`../DECISIONS.md#d52--…`), a choice anchor (`../PROCHAINES-ETAPES.md#c2-…`), or a spec file.
   Every link in the file must resolve, anchors included.
6. **Attendu holds what was measured**, with its date and source — « 95,9 %, relevé le
   28 octobre ». If nothing was measured, say what is expected and that it is unmeasured. Never
   invent a figure.

### Templates

Vérifier, or Faire with the same fields:

```markdown
- [ ] **Vérifier**, 09:00 à 17:00 — <ce qui est vérifié>.

### <Titre court>

- *Quand* : <l'heure UTC, le retard possible, ce qui doit avoir eu lieu avant>.
- *Comment* : <la commande ou la requête, en lecture seule ; ou le run à lire>.
- *Attendu* : <le chiffre ou l'état, et d'où il vient>.
- *Sinon* : <ce que ça veut dire, et vers quoi se tourner>.
- *Vient de* : [Dxx](../DECISIONS.md#dxx--…), [`technique/NN`](../technique/NN-….md) § N.
```

Décider:

```markdown
- [ ] **Décider** — Cx : <la question>. Avant le <date heure>.

### Cx — <titre>

- *Quand* : <la date limite, et pourquoi c'est celle-là>.
- *Quoi* : <les options, ou un renvoi vers le choix qui les chiffre>.
- *Si rien n'est décidé* : <ce qui se passe par défaut>.
- *Vient de* : [Cx](../PROCHAINES-ETAPES.md#cx-…).
```

## 4. Closing an item

Once the check is done or the action taken:

1. tick the box: `- [x]`;
2. end its detail with a dated line, figures included:

   ```markdown
   - *Fait le 2026-11-01* : ligne `2026-11`, `first`, `capped`, 450 appels comme le log ;
     `sweep_run.calls_made` 3 150.
   ```

The test fails on a checked item without that line, and on an unchecked one with it. If the
result is not the expected one, say so in the line, and write the follow-up item on the day it
is due. **Never delete a past file or rewrite a past result**: the agenda is read as a chronology.

## 5. Moving an item

When an item slips to another day:

1. on the old day, replace its checklist line by
   `- [x] **Déplacé** au [AAAA-MM-JJ](AAAA-MM-JJ.md) — <ce qui était prévu>.` and remove its
   detail section, which moves with it;
2. on the new day, add the item as in § 3.

## Don't

- Don't decide anything in the agenda: a *Décider* item points to where the choice is settled.
- Don't write Places content. The repository is public: aggregates, cell ids and run ids only,
  never a named place, an address, hours or coordinates.
- Don't use local time: UTC, and the Pacific month where the quota is concerned.
- Don't leave a checked item without its result, or a result without a checked box.
