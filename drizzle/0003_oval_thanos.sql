CREATE TABLE "email_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"to_email" text NOT NULL,
	"from_email" text,
	"reply_to" text,
	"subject" text NOT NULL,
	"html_body" text NOT NULL,
	"text_body" text,
	"template_key" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 8 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"provider_message_id" text,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ix_email_queue_status_next" ON "email_queue" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "ix_email_queue_status_last" ON "email_queue" USING btree ("status","last_attempt_at");