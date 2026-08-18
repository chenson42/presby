---
name: release-notes
description: Write or update release notes for a code change, bump the version in package.json, and create a new minor-version file when needed
---

# Release Notes

When the user invokes `/release-notes`, write a release-notes entry for the current change, bump the version in `package.json`, and ensure the file structure stays consistent.

---

## Versioning Strategy

This starter uses semantic versioning: **MAJOR.MINOR.PATCH**.

| Segment | When to increment |
|---------|-------------------|
| **MAJOR** | Significant new functionality, breaking changes, or major milestones. |
| **MINOR** | New features, enhancements, non-breaking changes. |
| **PATCH** | Bug fixes, defect corrections, minor adjustments. |

`package.json` uses the natural form (e.g., `"0.2.1"`). Release-notes filenames use the major.minor form (`v0.2.md`).

---

## File Structure

Release notes live in `docs/release-notes/`. Each minor version gets its own file:

```
docs/release-notes/
├── v0.2.md   ← current
├── v0.1.md   ← previous
└── ...
```

The admin docs viewer (under `/admin/docs`) renders these files. The current minor-version file is the one linked from the admin docs index. Older files remain accessible via direct URL.

When a new **major** version starts (e.g., `v1.x`), create the new file and link it from the previous one.

---

## Step 1: Determine the Version Number

1. Read `package.json` to get the current version.
2. Read the table of contents in the current minor-version file (e.g., `docs/release-notes/v0.2.md`) to see the most recent entry.
3. Determine the next version:
   - **Bug fix / small change** → increment PATCH (e.g., `0.2.0` → `0.2.1`).
   - **New feature / enhancement** → increment MINOR (e.g., `0.2.1` → `0.3.0`).
   - **Breaking change or major milestone** → increment MAJOR.
4. Ask the user to confirm if unclear.

---

## Step 2: Create a New Minor-Version File if Needed

If you're bumping MINOR (e.g., `0.2.x` → `0.3.0`), create the new file using the **New Minor Version File** template at the bottom of this document. Then add a nav link at the bottom of the previous file: `→ [v0.3](v0.3.md)`.

If the admin docs viewer maintains an explicit allowlist of file paths (check `src/app/(admin)/admin/docs/` and any associated route handler), update it so the new file appears in the navigation and the old file is still reachable by direct link.

---

## Step 3: Write the Entry

Add to the current minor-version file, newest first.

1. **Add a row to the Table of Contents** at the top of the file:
   ```
   | [X.Y.Z](#X.Y.Z) | YYYY-MM-DD | [Type] | [One-line description] |
   ```

2. **Add the full entry** below the previous entry using the appropriate template (Feature, Enhancement, Defect Fix, Infrastructure, Security).

3. Use these types in the TOC:
   - `Feature` — new user-facing functionality.
   - `Enhancement` — improvement to an existing feature.
   - `Defect Fix` — bug correction.
   - `Security` — security update.
   - `Infrastructure` — internal/technical change with no direct user impact.

---

## Step 4: Update CLAUDE.md

Review `CLAUDE.md` for drift introduced by the release:

- **Capability Map** (and README's "What you get out of the box") — if the release adds any user-visible capability (a new page, a new auth flow, a new library, a new pattern like `ActionResult<T>`), add it to the relevant Capability Map bullet in CLAUDE.md and the detailed catalog in README. Keep the existing tone: concise, no internal implementation detail unless it's a concept a fork will copy.
- **Functionality map (Workflow Rule 14)** — update `docs/product/functionality-map.md` for every feature the release adds, materially changes, or removes: the full-map bullet (one line, primary file as jump-off) and the short Index if a whole surface/area shifted. Bump the map's version/surveyed stamp to match the release.
- **"Project Layout"** — if the release adds any route group or top-level directory under `src/app/`, add the corresponding line to the tree in the right alphabetical/logical position.
- **"Common Commands"** — if the release adds any npm script that a developer or agent would need to invoke, add it to the command block.

If none of these apply (e.g., a pure bug fix touching only internal logic with no new routes or patterns), skip with a one-line note: "CLAUDE.md: no user-visible surface changes."

---

## Step 5: Bump the Version

**Only bump when the branch is being prepared to merge into `main`.** If work is still in progress on a feature branch, skip this step — all changes ship as a single version when the branch merges.

**Documentation-only changes do not get a version bump.** If a PR only changes docs (no code), skip Step 5 entirely.

**All code changes on a branch ship as a single version.** Combine the entries; don't create one per commit.

When ready to merge, update `package.json` `version` to match the release-notes version number.

---

## Templates

### Feature

```markdown
<a name="X.Y.Z"></a>
## X.Y.Z — YYYY-MM-DD

### Feature: [Feature Name]

**Value:** [Why this was built — the problem it solves or the opportunity it captures]

#### What's New

- [User-facing change]
- [User-facing change]

#### Permissions

| Feature key | Required for |
|-------------|--------------|
| `area.action` | Description |

#### New Routes

- `GET /path` — Description
- `POST /api/...` — Description
```

> **No file lists.** Release notes describe user-facing value and bug context — not implementation. Don't add `Files Added`, `Files Modified`, or any per-file inventory. If a reader needs a per-file diff, they can run `git log vA.B.C..vX.Y.Z`.

---

### Enhancement

```markdown
<a name="X.Y.Z"></a>
## X.Y.Z — YYYY-MM-DD

### Enhancement: [Brief Description]

**Value:** [Why this improvement matters]

**Changes:**
- [Change]
- [Change]
```

---

### Defect Fix

```markdown
<a name="X.Y.Z"></a>
## X.Y.Z — YYYY-MM-DD

### Defect Fix: [Brief Description]

**Problem:** [What the user experienced]

**Root Cause:** [Why it happened]

**Fix:** [What was changed]

**Testing:**
- [x] Test case 1
- [x] Test case 2
```

---

### Infrastructure / Security

```markdown
<a name="X.Y.Z"></a>
## X.Y.Z — YYYY-MM-DD

### [Infrastructure | Security]: [Brief Description]

**Background:** [Context for the change]

**Changes:**
- [Change]
- [Change]
```

---

### New Minor Version File Template

```markdown
# Release Notes — vX.Y

*← [vX.(Y-1)](vX.(Y-1).md)*

---

## Table of Contents

| Version | Date | Type | Description |
|---------|------|------|-------------|
| [X.Y.0](#X.Y.0) | YYYY-MM-DD | Feature | Description |

---

[entries go here, newest first]
```
