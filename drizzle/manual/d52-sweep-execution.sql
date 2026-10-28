-- D52: the spend journal, `sweep_execution`.
--
-- Applied BY HAND in production, BEFORE the code that reads it is merged: sweep.yml runs
-- main's code on every schedule, whether Vercel deployed it or not. Never on the 1st or the
-- 16th before that day's pass has finished. Never through db:push.
--
--   psql "$SESSION_POOLER_URL" -v ON_ERROR_STOP=1 -f drizzle/manual/d52-sweep-execution.sql
--
-- One transaction: the table as drizzle-kit generates it from lib/db/schema.ts, RLS, the past,
-- and the check that the past adds up. Any failure rolls all of it back.
--
-- See .specs/technique/14-cycle-d-import-mensuel.md § 5.

BEGIN;

CREATE TABLE IF NOT EXISTS "sweep_execution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"source" text DEFAULT 'sweep' NOT NULL,
	"note" text,
	"trigger" text,
	"actor" text,
	"commit_sha" text,
	"github_run_id" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"period" text NOT NULL,
	"pass" text,
	"pass_ceiling" integer,
	"spent_at_start" integer,
	"calls_made" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"error" text,
	"cover" text,
	"cover_planned" integer,
	"cover_served" integer,
	"empty_replays" integer,
	"discovery_calls" integer,
	"fresh_at_start" real,
	"forecast_at_start" real,
	"forecast_at_end" real,
	"out_of_reach_records" integer,
	"places_returned" integer,
	"places_with_hours" integer,
	"places_new" integer,
	CONSTRAINT "sweep_execution_hand_note" CHECK ("sweep_execution"."source" <> 'hand' OR "sweep_execution"."note" IS NOT NULL)
);

DO $$ BEGIN
 ALTER TABLE "sweep_execution" ADD CONSTRAINT "sweep_execution_run_id_sweep_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."sweep_run"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "sweep_execution_period" ON "sweep_execution" USING btree ("period");

-- The default privileges of schema public grant anon and authenticated every right on a new
-- table. RLS with no policy is the only thing keeping the publishable key, which is public,
-- from deleting journal rows through the Data API — that is, from reopening the ceiling.
ALTER TABLE "sweep_execution" ENABLE ROW LEVEL SECURITY;

-- The past, on the one plan in place. Times are the workflow runs' for the two scheduled
-- passes, and the first and last stamps of 4 September for the local run; nothing records when
-- the August sweep ended.
INSERT INTO "sweep_execution"
  ("run_id", "source", "note", "trigger", "commit_sha", "github_run_id", "started_at", "finished_at", "period", "calls_made", "status")
SELECT (SELECT "id" FROM "sweep_run"), 'hand', v.note, v.trigger, v.commit_sha, v.github_run_id,
  v.started_at::timestamptz, v.finished_at::timestamptz, v.period, v.calls_made, 'recorded'
FROM (VALUES
  ('2026-08', 900, 'first sweep, launched from a workstation on 28-29 August UTC; start from sweep_run.started_at',
    'local', NULL, NULL, '2026-08-28 23:55:04+00', NULL),
  ('2026-09', 737, 'scheduled pass of 1 September, stopped on HTTP 500; count from its Actions log',
    'schedule', 'd55074b872d382fb5545ccd48496ebba228cc743', '33515957346', '2026-09-01 13:51:43+00', '2026-09-01 14:21:42+00'),
  ('2026-09', 163, 'resume launched from a workstation on 4 September, no workflow run; count from its stamps',
    'local', NULL, NULL, '2026-09-04 17:06:42+00', '2026-09-04 17:10:55+00'),
  ('2026-10', 900, 'scheduled pass of 1 October, stopped on its ceiling; count from its Actions log',
    'schedule', '9b76ff68cd67b4152a663374ca10fc74badfd74f', '36887894355', '2026-10-01 15:54:19+00', '2026-10-01 16:27:20+00')
) AS v(period, calls_made, note, trigger, commit_sha, github_run_id, started_at, finished_at);

-- Any --go of the old code since 26 October 2026 — the pass of 1 November, if it ran before
-- this — goes in here as one more row, its count read from its Actions log. Without it the
-- check below refuses. For example:
--
-- INSERT INTO "sweep_execution"
--   ("run_id", "source", "note", "trigger", "github_run_id", "started_at", "finished_at", "period", "pass", "calls_made", "status")
-- VALUES ((SELECT "id" FROM "sweep_run"), 'hand', 'scheduled pass of 1 November, old code; count from its Actions log',
--   'schedule', '<run id>', '<start>', '<end>', '2026-11', 'first', <calls>, 'recorded');

DO $$
DECLARE
  plans int;
  logged int;
  booked int;
BEGIN
  SELECT count(*) INTO plans FROM "sweep_run";
  IF plans <> 1 THEN
    RAISE EXCEPTION 'expected exactly one plan in sweep_run, found %', plans;
  END IF;
  SELECT "calls_made" INTO logged FROM "sweep_run";
  SELECT coalesce(sum("calls_made"), 0) INTO booked FROM "sweep_execution";
  IF booked <> logged THEN
    RAISE EXCEPTION 'the journal books % call(s), sweep_run.calls_made says %: add the old-code executions it lacks, then apply again', booked, logged;
  END IF;
END $$;

COMMIT;
