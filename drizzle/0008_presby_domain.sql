CREATE TYPE "public"."organization_type" AS ENUM('general_assembly', 'synod', 'presbytery', 'congregation', 'new_worshiping_community');--> statement-breakpoint
CREATE TYPE "public"."roll_action_kind" AS ENUM('opening_balance', 'profession_of_faith', 'reaffirmation', 'restoration', 'certificate_received', 'other_gain', 'baptized_member_enrolled', 'affiliate_received', 'other_participant_enrolled', 'certificate_dismissed', 'death', 'removed_by_session', 'renunciation_of_jurisdiction', 'other_loss', 'affiliate_ended', 'other_participant_removed', 'void');--> statement-breakpoint
CREATE TYPE "public"."ordered_ministry" AS ENUM('ruling_elder', 'deacon', 'minister_of_word_and_sacrament');--> statement-breakpoint
CREATE TABLE "org_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_type" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_units_id_org_key" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "organization_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"pcusa_pin" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"organization_type" "organization_type" NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"path" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug"),
	CONSTRAINT "organizations_id_key" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"household_id" uuid,
	"person_id" uuid,
	"address_type" text NOT NULL,
	"line1" text,
	"line2" text,
	"city" text,
	"region" text,
	"postal_code" text,
	"country" text DEFAULT 'US',
	"latitude" numeric,
	"longitude" numeric,
	"season_start" date,
	"season_end" date,
	"is_primary" boolean DEFAULT false NOT NULL,
	CONSTRAINT "addresses_subject_check" CHECK ("addresses"."household_id" is not null or "addresses"."person_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "contact_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"subtype" text,
	"value" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"do_not_contact" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"formal_name" text,
	"informal_name" text,
	"is_giving_unit" boolean DEFAULT true NOT NULL,
	"org_unit_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "households_id_org_key" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"title" text,
	"first_name" text NOT NULL,
	"preferred_name" text,
	"middle_name" text,
	"last_name" text NOT NULL,
	"suffix" text,
	"former_name" text,
	"date_of_birth" date,
	"birth_year_only" boolean DEFAULT false NOT NULL,
	"date_of_death" date,
	"merged_into_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"org_unit_id" uuid,
	"household_id" uuid,
	"household_role" text,
	"marital_status" text,
	"anniversary_date" date,
	"occupation" text,
	"employer" text,
	"school" text,
	"grade" text,
	"primary_language" text,
	"photo_key" text,
	"photo_updated_at" timestamp with time zone,
	"engagement_status" text DEFAULT 'visitor' NOT NULL,
	"first_visit_date" date,
	"how_heard" text,
	"current_roll" text,
	"current_roll_since" date,
	"external_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"mailchimp_status" text,
	"mailchimp_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_profiles_person_org_key" UNIQUE("person_id","organization_id"),
	CONSTRAINT "person_profiles_id_org_key" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "person_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"related_person_id" uuid,
	"related_name" text,
	"relationship" text NOT NULL,
	"is_emergency_contact" boolean DEFAULT false NOT NULL,
	"notes" text,
	CONSTRAINT "person_relationships_target_check" CHECK ("person_relationships"."related_person_id" is not null or "person_relationships"."related_name" is not null)
);
--> statement-breakpoint
CREATE TABLE "background_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"check_type" text NOT NULL,
	"provider" text,
	"status" text NOT NULL,
	"completed_on" date,
	"expires_on" date,
	"reference" text,
	"recorded_by" uuid
);
--> statement-breakpoint
CREATE TABLE "follow_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"workflow" text,
	"step" text,
	"assigned_to_person_id" uuid,
	"due_on" date,
	"status" text DEFAULT 'open' NOT NULL,
	"completed_at" timestamp with time zone,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "person_medical" (
	"person_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"allergies" text,
	"medical_notes" text,
	"medications" text,
	"authorized_pickup" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"milestone" text NOT NULL,
	"occurred_on" date,
	"location" text,
	"officiant_person_id" uuid,
	"officiant_name" text,
	"witnesses" text,
	"performed_by_org_id" uuid,
	"roll_action_id" uuid,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "person_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"note_type" text DEFAULT 'general' NOT NULL,
	"visibility" text DEFAULT 'staff' NOT NULL,
	"body" text NOT NULL,
	"occurred_on" date,
	"author_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_tags" (
	"organization_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_tags_pk" UNIQUE("person_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "person_talents" (
	"organization_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"talent_type_id" uuid NOT NULL,
	"proficiency" text,
	"willing_to_serve" boolean DEFAULT true NOT NULL,
	CONSTRAINT "person_talents_pk" UNIQUE("person_id","talent_type_id")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"color" text,
	CONSTRAINT "tags_org_name_key" UNIQUE("organization_id","name"),
	CONSTRAINT "tags_id_org_key" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "talent_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"category" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "talent_types_id_org_key" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "roll_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" "roll_action_kind" NOT NULL,
	"effective_date" date NOT NULL,
	"resulting_roll" text,
	"age_at_action" integer,
	"approval_status" text DEFAULT 'pending' NOT NULL,
	"minute_reference" text,
	"approved_on" date,
	"approved_by" uuid,
	"denial_reason" text,
	"voids_action_id" uuid,
	"proposed_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roll_actions_id_org_key" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "transfer_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"issuing_org_id" uuid NOT NULL,
	"issuing_person_id" uuid NOT NULL,
	"issuing_household_id" uuid,
	"receiving_org_id" uuid,
	"claim_token" text NOT NULL,
	"member_name" text NOT NULL,
	"issued_on" date NOT NULL,
	"expires_on" date,
	"dismissal_action_id" uuid,
	"claimed_at" timestamp with time zone,
	"reception_action_id" uuid,
	"status" text DEFAULT 'issued' NOT NULL,
	CONSTRAINT "transfer_certificates_claim_token_unique" UNIQUE("claim_token")
);
--> statement-breakpoint
CREATE TABLE "officer_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"office" text NOT NULL,
	"class_year" integer,
	"elected_on" date,
	"installed_on" date,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"end_reason" text,
	"minute_reference" text,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "officer_terms_id_org_key" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "ordinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"ministry" "ordered_ministry" NOT NULL,
	"ordained_on" date NOT NULL,
	"ordaining_org_id" uuid,
	"minute_reference" text,
	"ended_on" date,
	"ended_reason" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ordinations_id_org_key" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "group_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"group_role" text DEFAULT 'member' NOT NULL,
	"source" text DEFAULT 'managed' NOT NULL,
	"starts_on" date DEFAULT now() NOT NULL,
	"ends_on" date
);
--> statement-breakpoint
CREATE TABLE "group_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"key" text NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"group_type_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"membership_source" text DEFAULT 'managed' NOT NULL,
	"derived_from" text,
	"is_protected" boolean DEFAULT false NOT NULL,
	"meets_when" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "groups_id_org_key" UNIQUE("id","organization_id"),
	CONSTRAINT "groups_org_derived_key" UNIQUE("organization_id","derived_from"),
	CONSTRAINT "groups_derived_check" CHECK ("groups"."membership_source" = 'managed' or "groups"."derived_from" is not null)
);
--> statement-breakpoint
CREATE TABLE "administrative_commissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_org_id" uuid NOT NULL,
	"target_org_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"role_id" uuid,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"minute_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_key" text NOT NULL,
	CONSTRAINT "app_role_permissions_pk" UNIQUE("role_id","permission_key")
);
--> statement-breakpoint
CREATE TABLE "app_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"organization_type_scope" "organization_type",
	"key" text NOT NULL,
	"name" text NOT NULL,
	"role_kind" text DEFAULT 'custom' NOT NULL,
	"is_protected" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_roles_org_key" UNIQUE("organization_id","key")
);
--> statement-breakpoint
CREATE TABLE "org_delegations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grantor_org_id" uuid NOT NULL,
	"grantee_org_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"minute_reference" text,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"key" text PRIMARY KEY NOT NULL,
	"module" text NOT NULL,
	"description" text NOT NULL,
	"sensitivity_tier" smallint DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"person_id" uuid,
	"group_id" uuid,
	"starts_on" date DEFAULT now() NOT NULL,
	"ends_on" date,
	"granted_by" uuid,
	"grant_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_grants_principal_check" CHECK (num_nonnulls("role_grants"."person_id", "role_grants"."group_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"consent_type" text NOT NULL,
	"granted" boolean NOT NULL,
	"effective_date" date NOT NULL,
	"expires_on" date,
	"source" text NOT NULL,
	"granted_by_person_id" uuid,
	"recorded_by" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_demographics" (
	"person_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"gender" text,
	"racial_ethnic" text[],
	"source" text DEFAULT 'self' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_disabilities" (
	"person_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"category" text NOT NULL,
	"source" text DEFAULT 'staff_observed' NOT NULL,
	CONSTRAINT "person_disabilities_pk" UNIQUE("person_id","category")
);
--> statement-breakpoint
CREATE TABLE "person_privacy" (
	"person_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"directory_hidden" boolean DEFAULT false NOT NULL,
	"hide_email" boolean DEFAULT false NOT NULL,
	"hide_phone" boolean DEFAULT false NOT NULL,
	"hide_address" boolean DEFAULT false NOT NULL,
	"hide_birthday" boolean DEFAULT true NOT NULL,
	"hide_talents" boolean DEFAULT true NOT NULL,
	"hide_photo" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sasr_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"report_year" integer NOT NULL,
	"official_beginning_balance" integer NOT NULL,
	"computed_beginning_balance" integer,
	"ending_active" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"minute_reference" text,
	"submitted_at" timestamp with time zone,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sasr_reports_org_year_key" UNIQUE("organization_id","report_year")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_platform_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_parent_id_organizations_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_household_fk" FOREIGN KEY ("household_id","organization_id") REFERENCES "public"."households"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_person_fk" FOREIGN KEY ("person_id","organization_id") REFERENCES "public"."person_profiles"("person_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_methods" ADD CONSTRAINT "contact_methods_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_methods" ADD CONSTRAINT "contact_methods_person_fk" FOREIGN KEY ("person_id","organization_id") REFERENCES "public"."person_profiles"("person_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "households" ADD CONSTRAINT "households_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "households" ADD CONSTRAINT "households_org_unit_fk" FOREIGN KEY ("org_unit_id","organization_id") REFERENCES "public"."org_units"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_merged_into_id_people_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_profiles" ADD CONSTRAINT "person_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_profiles" ADD CONSTRAINT "person_profiles_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_profiles" ADD CONSTRAINT "person_profiles_household_fk" FOREIGN KEY ("household_id","organization_id") REFERENCES "public"."households"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_profiles" ADD CONSTRAINT "person_profiles_org_unit_fk" FOREIGN KEY ("org_unit_id","organization_id") REFERENCES "public"."org_units"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_relationships" ADD CONSTRAINT "person_relationships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_relationships" ADD CONSTRAINT "person_relationships_person_fk" FOREIGN KEY ("person_id","organization_id") REFERENCES "public"."person_profiles"("person_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_relationships" ADD CONSTRAINT "person_relationships_related_fk" FOREIGN KEY ("related_person_id","organization_id") REFERENCES "public"."person_profiles"("person_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_checks" ADD CONSTRAINT "background_checks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_checks" ADD CONSTRAINT "background_checks_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_checks" ADD CONSTRAINT "background_checks_person_fk" FOREIGN KEY ("person_id","organization_id") REFERENCES "public"."person_profiles"("person_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_person_fk" FOREIGN KEY ("person_id","organization_id") REFERENCES "public"."person_profiles"("person_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_assignee_fk" FOREIGN KEY ("assigned_to_person_id","organization_id") REFERENCES "public"."person_profiles"("person_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_medical" ADD CONSTRAINT "person_medical_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_medical" ADD CONSTRAINT "person_medical_person_fk" FOREIGN KEY ("person_id","organization_id") REFERENCES "public"."person_profiles"("person_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_milestones" ADD CONSTRAINT "person_milestones_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_milestones" ADD CONSTRAINT "person_milestones_performed_by_org_id_organizations_id_fk" FOREIGN KEY ("performed_by_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_milestones" ADD CONSTRAINT "person_milestones_roll_action_id_roll_actions_id_fk" FOREIGN KEY ("roll_action_id") REFERENCES "public"."roll_actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_milestones" ADD CONSTRAINT "person_milestones_person_fk" FOREIGN KEY ("person_id","organization_id") REFERENCES "public"."person_profiles"("person_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_milestones" ADD CONSTRAINT "person_milestones_officiant_fk" FOREIGN KEY ("officiant_person_id","organization_id") REFERENCES "public"."person_profiles"("person_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_notes" ADD CONSTRAINT "person_notes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_notes" ADD CONSTRAINT "person_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_notes" ADD CONSTRAINT "person_notes_person_fk" FOREIGN KEY ("person_id","organization_id") REFERENCES "public"."person_profiles"("person_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_tags" ADD CONSTRAINT "person_tags_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_tags" ADD CONSTRAINT "person_tags_person_fk" FOREIGN KEY ("person_id","organization_id") REFERENCES "public"."person_profiles"("person_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_tags" ADD CONSTRAINT "person_tags_tag_fk" FOREIGN KEY ("tag_id","organization_id") REFERENCES "public"."tags"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_talents" ADD CONSTRAINT "person_talents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_talents" ADD CONSTRAINT "person_talents_person_fk" FOREIGN KEY ("person_id","organization_id") REFERENCES "public"."person_profiles"("person_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_talents" ADD CONSTRAINT "person_talents_type_fk" FOREIGN KEY ("talent_type_id","organization_id") REFERENCES "public"."talent_types"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_types" ADD CONSTRAINT "talent_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roll_actions" ADD CONSTRAINT "roll_actions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roll_actions" ADD CONSTRAINT "roll_actions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roll_actions" ADD CONSTRAINT "roll_actions_voids_action_id_roll_actions_id_fk" FOREIGN KEY ("voids_action_id") REFERENCES "public"."roll_actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roll_actions" ADD CONSTRAINT "roll_actions_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roll_actions" ADD CONSTRAINT "roll_actions_person_fk" FOREIGN KEY ("person_id","organization_id") REFERENCES "public"."person_profiles"("person_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_certificates" ADD CONSTRAINT "transfer_certificates_issuing_org_id_organizations_id_fk" FOREIGN KEY ("issuing_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_certificates" ADD CONSTRAINT "transfer_certificates_issuing_person_id_people_id_fk" FOREIGN KEY ("issuing_person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_certificates" ADD CONSTRAINT "transfer_certificates_issuing_household_id_households_id_fk" FOREIGN KEY ("issuing_household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_certificates" ADD CONSTRAINT "transfer_certificates_receiving_org_id_organizations_id_fk" FOREIGN KEY ("receiving_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_certificates" ADD CONSTRAINT "transfer_certificates_dismissal_action_id_roll_actions_id_fk" FOREIGN KEY ("dismissal_action_id") REFERENCES "public"."roll_actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_certificates" ADD CONSTRAINT "transfer_certificates_reception_action_id_roll_actions_id_fk" FOREIGN KEY ("reception_action_id") REFERENCES "public"."roll_actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "officer_terms" ADD CONSTRAINT "officer_terms_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "officer_terms" ADD CONSTRAINT "officer_terms_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "officer_terms" ADD CONSTRAINT "officer_terms_person_fk" FOREIGN KEY ("person_id","organization_id") REFERENCES "public"."person_profiles"("person_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordinations" ADD CONSTRAINT "ordinations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordinations" ADD CONSTRAINT "ordinations_ordaining_org_id_organizations_id_fk" FOREIGN KEY ("ordaining_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordinations" ADD CONSTRAINT "ordinations_person_fk" FOREIGN KEY ("person_id","organization_id") REFERENCES "public"."person_profiles"("person_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_group_fk" FOREIGN KEY ("group_id","organization_id") REFERENCES "public"."groups"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_person_fk" FOREIGN KEY ("person_id","organization_id") REFERENCES "public"."person_profiles"("person_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_types" ADD CONSTRAINT "group_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_group_type_id_group_types_id_fk" FOREIGN KEY ("group_type_id") REFERENCES "public"."group_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "administrative_commissions" ADD CONSTRAINT "administrative_commissions_parent_org_id_organizations_id_fk" FOREIGN KEY ("parent_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "administrative_commissions" ADD CONSTRAINT "administrative_commissions_target_org_id_organizations_id_fk" FOREIGN KEY ("target_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "administrative_commissions" ADD CONSTRAINT "administrative_commissions_role_id_app_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."app_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_role_permissions" ADD CONSTRAINT "app_role_permissions_role_id_app_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."app_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_role_permissions" ADD CONSTRAINT "app_role_permissions_permission_key_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."permissions"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_roles" ADD CONSTRAINT "app_roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_delegations" ADD CONSTRAINT "org_delegations_grantor_org_id_organizations_id_fk" FOREIGN KEY ("grantor_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_delegations" ADD CONSTRAINT "org_delegations_grantee_org_id_organizations_id_fk" FOREIGN KEY ("grantee_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_delegations" ADD CONSTRAINT "org_delegations_role_id_app_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."app_roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_grants" ADD CONSTRAINT "role_grants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_grants" ADD CONSTRAINT "role_grants_role_id_app_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."app_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_grants" ADD CONSTRAINT "role_grants_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_grants" ADD CONSTRAINT "role_grants_person_fk" FOREIGN KEY ("person_id","organization_id") REFERENCES "public"."person_profiles"("person_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_grants" ADD CONSTRAINT "role_grants_group_fk" FOREIGN KEY ("group_id","organization_id") REFERENCES "public"."groups"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_person_fk" FOREIGN KEY ("person_id","organization_id") REFERENCES "public"."person_profiles"("person_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_guardian_fk" FOREIGN KEY ("granted_by_person_id","organization_id") REFERENCES "public"."person_profiles"("person_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_demographics" ADD CONSTRAINT "person_demographics_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_demographics" ADD CONSTRAINT "person_demographics_person_fk" FOREIGN KEY ("person_id","organization_id") REFERENCES "public"."person_profiles"("person_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_disabilities" ADD CONSTRAINT "person_disabilities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_disabilities" ADD CONSTRAINT "person_disabilities_person_fk" FOREIGN KEY ("person_id","organization_id") REFERENCES "public"."person_profiles"("person_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_privacy" ADD CONSTRAINT "person_privacy_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_privacy" ADD CONSTRAINT "person_privacy_person_fk" FOREIGN KEY ("person_id","organization_id") REFERENCES "public"."person_profiles"("person_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sasr_reports" ADD CONSTRAINT "sasr_reports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_units_org_idx" ON "org_units" USING btree ("organization_id","unit_type");--> statement-breakpoint
CREATE INDEX "organizations_parent_idx" ON "organizations" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "organizations_type_idx" ON "organizations" USING btree ("organization_type");--> statement-breakpoint
CREATE INDEX "addresses_org_household_idx" ON "addresses" USING btree ("organization_id","household_id");--> statement-breakpoint
CREATE INDEX "addresses_org_person_idx" ON "addresses" USING btree ("organization_id","person_id");--> statement-breakpoint
CREATE INDEX "contact_methods_org_person_idx" ON "contact_methods" USING btree ("organization_id","person_id");--> statement-breakpoint
CREATE INDEX "contact_methods_org_value_idx" ON "contact_methods" USING btree ("organization_id",lower("value"));--> statement-breakpoint
CREATE INDEX "households_org_name_idx" ON "households" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "people_name_idx" ON "people" USING btree ("last_name","first_name");--> statement-breakpoint
CREATE INDEX "people_user_idx" ON "people" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "person_profiles_org_roll_idx" ON "person_profiles" USING btree ("organization_id","current_roll");--> statement-breakpoint
CREATE INDEX "person_profiles_org_household_idx" ON "person_profiles" USING btree ("organization_id","household_id");--> statement-breakpoint
CREATE INDEX "person_profiles_org_engagement_idx" ON "person_profiles" USING btree ("organization_id","engagement_status");--> statement-breakpoint
CREATE INDEX "person_relationships_org_person_idx" ON "person_relationships" USING btree ("organization_id","person_id");--> statement-breakpoint
CREATE INDEX "background_checks_expiry_idx" ON "background_checks" USING btree ("organization_id","expires_on","status");--> statement-breakpoint
CREATE INDEX "background_checks_org_person_idx" ON "background_checks" USING btree ("organization_id","person_id");--> statement-breakpoint
CREATE INDEX "follow_ups_org_assignee_idx" ON "follow_ups" USING btree ("organization_id","assigned_to_person_id","status","due_on");--> statement-breakpoint
CREATE INDEX "person_milestones_org_person_idx" ON "person_milestones" USING btree ("organization_id","person_id");--> statement-breakpoint
CREATE INDEX "person_milestones_register_idx" ON "person_milestones" USING btree ("organization_id","milestone","occurred_on");--> statement-breakpoint
CREATE INDEX "person_notes_org_person_idx" ON "person_notes" USING btree ("organization_id","person_id","created_at");--> statement-breakpoint
CREATE INDEX "person_tags_org_tag_idx" ON "person_tags" USING btree ("organization_id","tag_id");--> statement-breakpoint
CREATE INDEX "roll_actions_org_person_idx" ON "roll_actions" USING btree ("organization_id","person_id","effective_date");--> statement-breakpoint
CREATE INDEX "roll_actions_pending_idx" ON "roll_actions" USING btree ("organization_id","effective_date") WHERE approval_status = 'pending';--> statement-breakpoint
CREATE INDEX "roll_actions_reporting_idx" ON "roll_actions" USING btree ("organization_id","effective_date","kind") WHERE approval_status = 'approved';--> statement-breakpoint
CREATE INDEX "transfer_certificates_issuing_idx" ON "transfer_certificates" USING btree ("issuing_org_id","status");--> statement-breakpoint
CREATE INDEX "transfer_certificates_receiving_idx" ON "transfer_certificates" USING btree ("receiving_org_id","status");--> statement-breakpoint
CREATE INDEX "officer_terms_org_office_idx" ON "officer_terms" USING btree ("organization_id","office","starts_on","ends_on");--> statement-breakpoint
CREATE INDEX "officer_terms_org_person_idx" ON "officer_terms" USING btree ("organization_id","person_id");--> statement-breakpoint
CREATE INDEX "ordinations_org_person_idx" ON "ordinations" USING btree ("organization_id","person_id");--> statement-breakpoint
CREATE INDEX "ordinations_org_ministry_idx" ON "ordinations" USING btree ("organization_id","ministry");--> statement-breakpoint
CREATE INDEX "group_memberships_org_group_idx" ON "group_memberships" USING btree ("organization_id","group_id","starts_on","ends_on");--> statement-breakpoint
CREATE INDEX "group_memberships_org_person_idx" ON "group_memberships" USING btree ("organization_id","person_id");--> statement-breakpoint
CREATE INDEX "group_types_org_idx" ON "group_types" USING btree ("organization_id","key");--> statement-breakpoint
CREATE INDEX "groups_org_idx" ON "groups" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "administrative_commissions_target_idx" ON "administrative_commissions" USING btree ("target_org_id","starts_on","ends_on");--> statement-breakpoint
CREATE INDEX "app_role_permissions_role_idx" ON "app_role_permissions" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "app_roles_template_idx" ON "app_roles" USING btree ("organization_type_scope");--> statement-breakpoint
CREATE INDEX "org_delegations_grantor_idx" ON "org_delegations" USING btree ("grantor_org_id","starts_on");--> statement-breakpoint
CREATE INDEX "org_delegations_grantee_idx" ON "org_delegations" USING btree ("grantee_org_id","starts_on");--> statement-breakpoint
CREATE INDEX "role_grants_org_person_idx" ON "role_grants" USING btree ("organization_id","person_id","starts_on","ends_on");--> statement-breakpoint
CREATE INDEX "role_grants_org_group_idx" ON "role_grants" USING btree ("organization_id","group_id","starts_on","ends_on");--> statement-breakpoint
CREATE INDEX "consents_org_person_idx" ON "consents" USING btree ("organization_id","person_id","consent_type","effective_date");