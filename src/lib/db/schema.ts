import {
  pgTable,
  text,
  uuid,
  timestamp,
  boolean,
  integer,
  primaryKey,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// NextAuth adapter tables. snake_case property names are required by
// @auth/drizzle-adapter — do not rename.

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  image: text("image"),
  password: text("password"),
  isActive: boolean("is_active").notNull().default(true),
  // presby (D7). Governs which PAGES are reachable. It does NOT bypass RLS —
  // that is what the separate presby_platform connection is for. A boolean that
  // skipped the WHERE clause would make tenant isolation an application
  // property; two connections make it a database property.
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  twoFactorRequired: boolean("two_factor_required").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

// Roles → features (permissions). Multiple roles per user. Each role grants
// a set of features. Features are the unit checked at runtime.

export const roles = pgTable("roles", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  displayName: text("display_name").notNull(),
  description: text("description"),
  isSystem: boolean("is_system").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const userRoles = pgTable(
  "user_roles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("ix_user_roles_user_role").on(t.userId, t.roleId)],
);

export const features = pgTable("features", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category").notNull(),
});

export const roleFeatures = pgTable(
  "role_features",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    featureKey: text("feature_key")
      .notNull()
      .references(() => features.key, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("ix_role_features_role_feature").on(t.roleId, t.featureKey),
  ],
);

// TOTP 2FA. Secret stored AES-256-GCM encrypted; see src/lib/two-factor.

export const userTotp = pgTable("user_totp", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  secretCiphertext: text("secret_ciphertext").notNull(),
  enrolledAt: timestamp("enrolled_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

// Pending enrollments. The user has scanned a QR code but not yet confirmed
// the first 6-digit code. Holding the ciphertext server-side closes the
// "client posts back any secret it wants" gap. One row per user; expires after
// 10 minutes to keep dead rows from accumulating.
export const userTotpPendingEnrollments = pgTable(
  "user_totp_pending_enrollments",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    secretCiphertext: text("secret_ciphertext").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const userTotpRecoveryCodes = pgTable(
  "user_totp_recovery_codes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("ix_recovery_user").on(t.userId)],
);

// Feature flags — distinct from permissions. Permissions are "is this user
// allowed to use feature X". Flags are "is feature X on for this environment
// (or this cohort)". Same word, different concept.

export const featureFlags = pgTable("feature_flags", {
  key: text("key").primaryKey(),
  description: text("description"),
  enabled: boolean("enabled").notNull().default(false),
  rolloutPercent: integer("rollout_percent").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Append-only audit log for security-sensitive actions.

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    actorEmail: text("actor_email"),
    action: text("action").notNull(),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("ix_audit_actor").on(t.actorUserId),
    index("ix_audit_action_time").on(t.action, t.createdAt),
    index("ix_audit_created").on(t.createdAt),
  ],
);

export const migrationSeeds = pgTable("migration_seeds", {
  key: text("key").primaryKey(),
  appliedAt: timestamp("applied_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Email verification tokens — used for self-serve email address changes.
// A new token is minted when the user submits a new email; it expires after
// 24 hours. The uniqueIndex on userId enforces one in-flight change per user.

export const emailVerificationTokens = pgTable(
  "email_verification_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull(), // SHA-256 hex of crypto.randomBytes(32).toString("hex"); raw token travels in email URL
    newEmail: text("new_email").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("ix_email_ver_token").on(t.token),
    uniqueIndex("ix_email_ver_user").on(t.userId),
  ],
);

// Password reset tokens — used for self-serve forgot-password flow.
// The raw token is emailed; only the SHA-256 hex is stored.
// The uniqueIndex on userId enforces one in-flight reset per user (delete-then-insert).

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull(), // SHA-256 hex of crypto.randomBytes(32).toString("base64url")
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("ix_pwd_reset_token").on(t.token),
    uniqueIndex("ix_pwd_reset_user").on(t.userId),
  ],
);

// Email queue — persist-first outbound email with exponential-backoff retry.
// Rendered HTML (including token URLs) is stored at rest; see DECISION-018
// Sub-decision 2 for the privacy tradeoff and fork accommodation note.
// Single-recipient only: insert one row per recipient for multi-recipient needs.

export const emailQueue = pgTable(
  "email_queue",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Intended recipient. Always the real address even when EMAIL_DEV_REDIRECT_TO
    // overrides the live send. Stored for monitoring and permanent-fail auditing.
    toEmail: text("to_email").notNull(),
    // Nullable; if null, the send step defaults to RESEND_FROM_EMAIL at send time.
    // Storing it ensures retries use the same from address as the initial attempt.
    fromEmail: text("from_email"),
    replyTo: text("reply_to"),
    subject: text("subject").notNull(),
    // Fully rendered HTML including any token URLs. See DECISION-018.
    htmlBody: text("html_body").notNull(),
    textBody: text("text_body"),
    // Label for the email type: 'password_reset' | 'email_change_verify'.
    // Used for monitoring/filtering and permanent-fail audit events.
    // NOT used to re-render at send time.
    templateKey: text("template_key").notNull(),
    // 'queued' | 'processing' | 'sent' | 'failed' — text per existing schema convention (no pgEnum).
    status: text("status").notNull().default("queued"),
    // Incremented on each attempt (inline or worker). Starts at 0.
    attemptCount: integer("attempt_count").notNull().default(0),
    // Default 8: inline attempt + up to 7 worker retries before permanent failure.
    maxAttempts: integer("max_attempts").notNull().default(8),
    // NULL on insert = eligible for immediate inline attempt.
    // Set to backoff schedule (now + delay) after each failed worker attempt.
    // After the inline attempt completes (success or failure), this is non-null.
    // The worker NEVER sees a null nextAttemptAt row in practice because the
    // inline path resolves before the first cron window (sub-second vs 5 minutes).
    // The COALESCE in the claim SQL handles the null case defensively.
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    // Set to NOW() when the worker claims the row (via the CTE UPDATE).
    // Also used for the lease-recovery query: rows in 'processing' with
    // lastAttemptAt < now() - 10 minutes are considered stuck and re-queued.
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    // Set when status transitions to 'sent'.
    sentAt: timestamp("sent_at", { withTimezone: true }),
    // Resend message ID on successful send; 'dev-intercepted:<uuid>' in dev mode.
    providerMessageId: text("provider_message_id"),
    // Last error message from Resend on failure. Overwritten on each attempt.
    // Also set on bounce events from the Resend webhook (see deliveredAt below).
    failureReason: text("failure_reason"),
    // Delivery-event timestamps from Resend webhook (via POST /api/webhooks/resend).
    // All nullable: NULL = event not yet received or webhook not configured.
    // 'dev-intercepted:*' providerMessageId rows never receive these (Resend never
    // sees the email); webhook updates on those rows silently find no match.
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    clickedAt: timestamp("clicked_at", { withTimezone: true }),
    bouncedAt: timestamp("bounced_at", { withTimezone: true }),
    complainedAt: timestamp("complained_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Primary worker query filter: WHERE status='queued' AND nextAttemptAt <= now()
    index("ix_email_queue_status_next").on(t.status, t.nextAttemptAt),
    // Lease-recovery query: WHERE status='processing' AND lastAttemptAt < now()-10min
    index("ix_email_queue_status_last").on(t.status, t.lastAttemptAt),
    // Webhook UPDATE path: WHERE provider_message_id = $1 (one lookup per event).
    index("ix_email_queue_provider_message_id").on(t.providerMessageId),
  ],
);

// Member feedback submissions. Append-only; status progresses forward only.
// Status lifecycle: new → triaged → done (delivered)
//                  new → declined (won't do)
//                  triaged → declined (decided against after review)
// Terminal states (done, declined) never regress — enforced in updateFeedbackStatus action.
// FK to users only — no joins to roles, sessions, or any other application table
// (privacy invariant: the admin triage page shows member display name only, not email).
export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // 'suggestion' | 'bug' | 'other' | null (member didn't choose).
    // Text, not pgEnum — consistent with project convention (see emailQueue.status).
    category: text("category"),
    // Member-supplied text. Trimmed; length enforced server-side (1–2000 chars).
    body: text("body").notNull(),
    // Bug-only metadata. Null when category !== 'bug'.
    contextPath: text("context_path"), // max 512 chars, page URL at submit time
    appVersion: text("app_version"), // max 32 chars, from src/lib/version.ts
    // 'new' | 'triaged' | 'done' | 'declined' — text, not pgEnum.
    status: text("status").notNull().default("new"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Serves the admin page (ORDER BY created_at DESC with status filter) and
    // the SessionStart hook (WHERE status = 'new' count). One index covers both.
    index("ix_feedback_status_created").on(t.status, t.createdAt),
    // Per-user history and rate-limit context lookups.
    index("ix_feedback_user").on(t.userId),
  ],
);

// Per-user daily prompt suppression state. One row per user (userId is PK).
//
// CLOBBER-PREVENTION INVARIANT: each upsert operation (submit, snooze, opt-out)
// sets ONLY its own column in onConflictDoUpdate.set. The other two columns
// retain their existing values. Never touch more than one field per upsert.
//
// Date fields are 'YYYY-MM-DD' text in the member's LOCAL timezone, derived from
// client-provided tzOffsetMinutes at write time. The server reads UTC 'today' for
// the shouldShow suppression check — this is a known imprecision (DECISION-023).
export const feedbackPromptState = pgTable("feedback_prompt_state", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  // true = member permanently dismissed the daily prompt.
  optedOut: boolean("opted_out").notNull().default(false),
  // Last date member clicked "Not today". Compared with UTC today for suppression.
  lastSnoozedDate: text("last_snoozed_date"),
  // Last date member submitted feedback. Compared with UTC today for suppression.
  lastSubmittedDate: text("last_submitted_date"),
});

// What's new entries — admin-published announcements shown to members on /home and /whats-new.
// Body is plain text only; validated server-side (HTML rejected, not stripped).
// publishedAt is set on INSERT only; UPDATE actions must never touch this column
// so that edits don't resurface old entries as "new" in the list ordering.

export const whatsNewEntries = pgTable(
  "whats_new_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Optional; ≤2 Unicode code points validated via [...emoji].length server-side.
    emoji: text("emoji"),
    title: text("title").notNull(), // ≤100 chars, plain text, validated server-side
    body: text("body").notNull(), // ≤500 chars, plain text, validated server-side
    publishedAt: timestamp("published_at", { withTimezone: true })
      .notNull()
      .defaultNow(), // set on INSERT only; UPDATE actions MUST NOT include this column
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()), // per $onUpdate convention (users, emailQueue)
    updatedBy: uuid("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    // Hot-path query: member home card and /whats-new list both ORDER BY published_at DESC.
    index("ix_whats_new_published").on(t.publishedAt.desc()),
  ],
);

// Relations

export const usersRelations = relations(users, ({ many, one }) => ({
  accounts: many(accounts),
  sessions: many(sessions),
  roles: many(userRoles),
  totp: one(userTotp, {
    fields: [users.id],
    references: [userTotp.userId],
  }),
  emailVerificationTokens: many(emailVerificationTokens),
  passwordResetTokens: many(passwordResetTokens),
  feedback: many(feedback),
  feedbackPromptState: one(feedbackPromptState, {
    fields: [users.id],
    references: [feedbackPromptState.userId],
  }),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  userRoles: many(userRoles),
  roleFeatures: many(roleFeatures),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, { fields: [userRoles.userId], references: [users.id] }),
  role: one(roles, { fields: [userRoles.roleId], references: [roles.id] }),
}));

export const roleFeaturesRelations = relations(roleFeatures, ({ one }) => ({
  role: one(roles, { fields: [roleFeatures.roleId], references: [roles.id] }),
  feature: one(features, {
    fields: [roleFeatures.featureKey],
    references: [features.key],
  }),
}));

export const emailVerificationTokensRelations = relations(
  emailVerificationTokens,
  ({ one }) => ({
    user: one(users, {
      fields: [emailVerificationTokens.userId],
      references: [users.id],
    }),
  }),
);

export const passwordResetTokensRelations = relations(
  passwordResetTokens,
  ({ one }) => ({
    user: one(users, {
      fields: [passwordResetTokens.userId],
      references: [users.id],
    }),
  }),
);

export const feedbackRelations = relations(feedback, ({ one }) => ({
  user: one(users, { fields: [feedback.userId], references: [users.id] }),
}));

export const feedbackPromptStateRelations = relations(
  feedbackPromptState,
  ({ one }) => ({
    user: one(users, {
      fields: [feedbackPromptState.userId],
      references: [users.id],
    }),
  }),
);

export const whatsNewEntriesRelations = relations(
  whatsNewEntries,
  ({ one }) => ({
    creator: one(users, {
      fields: [whatsNewEntries.createdBy],
      references: [users.id],
    }),
    updater: one(users, {
      fields: [whatsNewEntries.updatedBy],
      references: [users.id],
    }),
  }),
);

// presby domain schema. See src/lib/db/domain/index.ts and docs/schema-design.md.
export * from "./domain";
