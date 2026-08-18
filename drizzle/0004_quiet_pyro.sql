CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category" text,
	"body" text NOT NULL,
	"context_path" text,
	"app_version" text,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback_prompt_state" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"opted_out" boolean DEFAULT false NOT NULL,
	"last_snoozed_date" text,
	"last_submitted_date" text
);
--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_prompt_state" ADD CONSTRAINT "feedback_prompt_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_feedback_status_created" ON "feedback" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "ix_feedback_user" ON "feedback" USING btree ("user_id");