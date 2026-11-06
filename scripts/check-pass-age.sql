-- The age of the last pass, checked every day (D50). Run by .github/workflows/pass-age.yml:
--
--   psql "$DATABASE_URL" --no-psqlrc --set ON_ERROR_STOP=1 --file scripts/check-pass-age.sql
--
-- Fails when no pass of the sweep has finished since the latest scheduled pass whose deadline
-- is behind us. A pass that never runs produces no red of its own: there is no run to fail.
--
-- The deadline is the scheduled start plus nine hours: CYCLE.maxScheduleDelayHours of GitHub's
-- delay, and the sweep job's 60-minute timeout. Until a pass's deadline, the check reads the
-- pass before it.
--
-- It reads the spend journal, `sweep_execution` (D52), and counts as a pass an execution of the
-- sweep that closed `succeeded`, `capped` or `failed`:
--   - not `refused`: a refusal spent nothing and refreshed nothing, it is a pass that did not
--     start (D52, technique/14 § 5);
--   - `failed` counts: the pass took place, and its red is sweep.yml's own. This check watches
--     that passes happen, not how they went — counting it would otherwise turn a defect that
--     recurs at every pass, an irreducible cell, into a red every day;
--   - not a hand row (`source = 'hand'`): it records spend after the fact, with whatever times
--     its writer copied from a log, and nothing in the code holds them;
--   - not a row without `finished_at`: still running, or killed and closed by the next one.
--
-- The schedule is written out below, not read from lib/config.ts: psql is all the job needs.
-- tests/pass-age.test.ts holds it to CYCLE and to the delay.

-- Without it, psql runs a file to its end and exits 0 whatever failed in it.
\set ON_ERROR_STOP on

begin read only;

do $$
declare
  -- A setting only so that the tests can stand at any hour. The workflow never sets it.
  clock timestamptz := coalesce(nullif(current_setting('pass_age.now', true), ''), now()::text)::timestamptz;
  -- On UTC's calendar, where sweep.yml's cron reads the 1st and the 16th at 09:00.
  latest_due timestamp := (clock at time zone 'UTC') - interval '9 hours';
  scheduled timestamptz;
  deadline timestamptz;
  finished timestamptz;
  last_row text;
begin
  select max(s) at time zone 'UTC' into scheduled
    from (values
      (date_trunc('month', latest_due) - interval '1 month' + interval '15 days 9 hours'),
      (date_trunc('month', latest_due) + interval '9 hours'),
      (date_trunc('month', latest_due) + interval '15 days 9 hours')
    ) as candidates(s)
   where s <= latest_due;
  deadline := scheduled + interval '9 hours';

  select max(finished_at) into finished
    from sweep_execution
   where source = 'sweep'
     and status in ('succeeded', 'capped', 'failed')
     and finished_at >= scheduled
     and finished_at <= clock;

  -- The latest row of any kind, so that a red says what the journal holds instead.
  select format('%s %s, started %s, finished %s, %s calls%s',
                source, status, started_at, coalesce(finished_at::text, 'never'), calls_made,
                coalesce(': ' || error, ''))
    into last_row
    from sweep_execution
   where started_at <= clock
   order by started_at desc
   limit 1;

  if finished is null then
    raise exception 'no pass has finished since the one scheduled at %, due by %', scheduled, deadline
      using detail = 'latest journal row: ' || coalesce(last_row, 'none'),
            hint = 'a pass GitHub dropped, a workflow disabled by hand, or a sweep that never '
                   'opened its row. Read the runs of sweep.yml, then technique/14 § 6 and § 9.';
  end if;

  raise notice 'pass scheduled at % finished at %, before its deadline %', scheduled, finished, deadline;
end
$$;

commit;
