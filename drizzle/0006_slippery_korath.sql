ALTER TABLE "email_queue" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_queue" ADD COLUMN "opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_queue" ADD COLUMN "clicked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_queue" ADD COLUMN "bounced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_queue" ADD COLUMN "complained_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "ix_email_queue_provider_message_id" ON "email_queue" USING btree ("provider_message_id");