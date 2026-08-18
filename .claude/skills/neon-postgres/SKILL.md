---
name: neon-postgres
description: Patterns and guidance for working with Neon Postgres in this starter — branching for schema work, pooled vs direct connections, Drizzle Kit usage, and the Neon docs as source of truth.
---

# Neon Postgres in the Claude Code Starter

The starter uses Neon — a serverless Postgres platform that separates compute and storage to offer autoscaling, branching, instant restore, and scale-to-zero. It is fully Postgres-compatible and works with any driver that supports Postgres, including the Drizzle ORM stack this starter uses.

This skill captures the patterns most relevant to working in *this* codebase. For broader Neon questions, fall back to the official docs.

## Environment Variables in This Starter

| Variable | Purpose | Connection shape |
|----------|---------|------------------|
| `DATABASE_URL` | Runtime app connection — used by `src/lib/db/index.ts` via `@neondatabase/serverless`. | Pooled (host includes `-pooler`). |
| `DATABASE_URL_UNPOOLED` | Drizzle Kit, migrations, scripts. | Direct (no `-pooler` suffix). |

Drizzle Kit (`npm run db:push`, `npm run db:generate`) needs a direct connection because it runs DDL. The app at runtime uses the pooled connection because serverless functions burst.

## Drizzle Kit Usage

The starter ships two commands:

- **`npm run db:push`** — compares `src/lib/db/schema.ts` to the live database and applies the difference. Fast, lossy, perfect for early development.
- **`npm run db:generate`** — emits a versioned SQL migration into `drizzle/`. Use once the schema is in a shape forks may have deployed; review and commit the generated file.
- **`npm run db:seed`** — runs `scripts/seed.ts` to seed roles, features, and the demo flag. Idempotent; safe to re-run.

`schema.ts` is the source of truth. Anything in the live database that isn't in `schema.ts` will be dropped on `db:push`.

## Branching Pattern for Schema Work

Neon's killer feature for app development is **branches** — instant, copy-on-write clones of your database with their own compute endpoint. Use them for any non-trivial schema change.

The recommended loop:

1. **Create a Neon branch** off `main` from the Neon console (or the Neon CLI: `neonctl branches create --name feature/api-keys`).
2. **Grab the branch's connection strings** (pooled + unpooled).
3. **Point `.env.local` at the branch** for both `DATABASE_URL` and `DATABASE_URL_UNPOOLED`.
4. **Iterate freely**: `npm run db:push` repeatedly while you shape the schema.
5. **Run `npm run db:seed`** to verify the seed still works against the new shape.
6. **When the schema is right, generate a migration**: `npm run db:generate`. Commit the SQL.
7. **Apply the same migration to `main`** when you merge — either by running `db:push` against `main` after merging, or by adding the migration to your deploy pipeline.
8. **Delete the branch** when the feature ships.

The point is that schema mistakes never touch production data — they happen on a disposable branch that can be deleted with one command.

## Pooled vs Direct Connections

- **Use the pooled host (`-pooler` suffix)** in `DATABASE_URL` for app code and edge functions. Neon's PgBouncer multiplexes connections so a bursty serverless workload doesn't exhaust the Postgres connection limit.
- **Use the direct host** (no `-pooler`) for `DATABASE_URL_UNPOOLED`, used by Drizzle Kit and any tooling that runs DDL or relies on session-level features.

The Edge runtime (middleware) cannot import `@/lib/db` regardless of which host is configured — it pulls in node-only crypto. Keep DB access in route handlers and server actions, not in middleware.

## Scale-to-Zero and Cold Starts

By default, Neon's compute suspends after a few minutes of inactivity and resumes on the next query. The first query after suspend has a noticeable cold-start penalty (hundreds of milliseconds). This usually doesn't matter, but if you're benchmarking, that's why the second request is faster.

Storage stays active while compute is suspended, so data is never paged out.

## Useful Patterns

### Working with the Drizzle client

```typescript
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const row = await db.query.users.findFirst({ where: eq(users.email, email) });
```

### Raw SQL escape hatch
```typescript
import { sql } from "drizzle-orm";
const result = await db.execute(sql`SELECT count(*) FROM audit_events`);
```

Use sparingly. Almost everything in this starter can be expressed via Drizzle's query builder, and the type safety is worth keeping.

### Connection in a script

```typescript
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "@/lib/db/schema";

const sql = neon(process.env.DATABASE_URL_UNPOOLED!);
const db = drizzle(sql, { schema });
```

Scripts (like `scripts/seed.ts`) use the unpooled URL.

## Neon Documentation

The Neon docs are the source of truth for platform behavior. Always verify against the docs before relying on a feature claim — Neon evolves.

- **Docs index:** https://neon.com/docs/llms.txt
- **Branching:** https://neon.com/docs/introduction/branching
- **Connection pooling:** https://neon.com/docs/connect/connection-pooling
- **Scale to zero:** https://neon.com/docs/introduction/scale-to-zero
- **Instant restore:** https://neon.com/docs/introduction/branch-restore
- **Neon CLI (`neonctl`):** https://neon.com/docs/reference/neon-cli

Any Neon doc page is available as Markdown by appending `.md` to the URL — useful when you want to fetch a single page rather than navigate the site.
