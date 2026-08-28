CREATE TYPE "public"."application_status" AS ENUM('to_contact', 'cv_submitted', 'followed_up', 'interview', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."category" AS ENUM('bistro', 'brasserie', 'fine_dining', 'fast_food', 'canteen', 'bar', 'pizzeria', 'other');--> statement-breakpoint
CREATE TYPE "public"."cell_status" AS ENUM('pending', 'done', 'truncated', 'irreducible', 'failed');--> statement-breakpoint
CREATE TYPE "public"."confidence" AS ENUM('confirmed', 'likely', 'unverified');--> statement-breakpoint
CREATE TYPE "public"."service_pattern" AS ENUM('lunch_only', 'dinner_only', 'split', 'continuous', 'mixed');--> statement-breakpoint
CREATE TYPE "public"."split_shift_risk" AS ENUM('none', 'low', 'medium', 'high', 'unknown');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "application" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"status" "application_status" DEFAULT 'to_contact' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cell" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sweep_run_id" uuid NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"radius" double precision NOT NULL,
	"sirene_count" integer DEFAULT 0 NOT NULL,
	"google_count" integer,
	"last_result_distance" double precision,
	"depth" smallint DEFAULT 0 NOT NULL,
	"parent_id" uuid,
	"status" "cell_status" DEFAULT 'pending' NOT NULL,
	"queried_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "restaurant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"google_place_id" text NOT NULL,
	"name" text NOT NULL,
	"formatted_address" text,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"google_types" text[],
	"business_status" text,
	"insee_code" text,
	"commune" text,
	"district" smallint,
	"category" "category" DEFAULT 'other' NOT NULL,
	"phone" text,
	"siret" text,
	"naf_code" text,
	"headcount_code" text,
	"match_score" real,
	"raw_opening_hours" jsonb,
	"hours_fetched_at" timestamp with time zone,
	"hours_expires_at" timestamp with time zone,
	"schedule" jsonb,
	"has_hours" boolean DEFAULT false NOT NULL,
	"open_days_count" smallint DEFAULT 0 NOT NULL,
	"closed_days" smallint[],
	"closed_saturday" boolean DEFAULT false NOT NULL,
	"closed_sunday" boolean DEFAULT false NOT NULL,
	"closed_weekend" boolean DEFAULT false NOT NULL,
	"max_consecutive_days_off" smallint DEFAULT 0 NOT NULL,
	"split_days_count" smallint DEFAULT 0 NOT NULL,
	"split_shift_risk" "split_shift_risk" DEFAULT 'unknown' NOT NULL,
	"confidence" "confidence" DEFAULT 'unverified' NOT NULL,
	"service_pattern" "service_pattern",
	"earliest_open_min" integer,
	"latest_close_min" integer,
	"weekly_open_minutes" integer DEFAULT 0 NOT NULL,
	"explanation" text DEFAULT '' NOT NULL,
	"profile_computed_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now(),
	"last_seen_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "restaurant_google_place_id_unique" UNIQUE("google_place_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sirene_establishment" (
	"siret" text PRIMARY KEY NOT NULL,
	"siren" text,
	"name" text,
	"naf" text,
	"headcount_code" text,
	"commune_code" text NOT NULL,
	"commune" text,
	"address" text,
	"postal_code" text,
	"lat" double precision,
	"lng" double precision,
	"geocode_score" real,
	"google_place_id" text,
	"imported_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sweep_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now(),
	"finished_at" timestamp with time zone,
	"cells_planned" integer DEFAULT 0 NOT NULL,
	"cells_queried" integer DEFAULT 0 NOT NULL,
	"calls_made" integer DEFAULT 0 NOT NULL,
	"truncated_unresolved" integer DEFAULT 0 NOT NULL,
	"irreducible_cells" integer DEFAULT 0 NOT NULL,
	"places_found" integer DEFAULT 0 NOT NULL,
	"sirene_unmatched" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"error" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "application" ADD CONSTRAINT "application_restaurant_id_restaurant_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "application_user_restaurant" ON "application" USING btree ("user_id","restaurant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cell_run" ON "cell" USING btree ("sweep_run_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sirene_commune" ON "sirene_establishment" USING btree ("commune_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sirene_position" ON "sirene_establishment" USING btree ("lat","lng");