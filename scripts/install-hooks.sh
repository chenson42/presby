#!/bin/sh
# install-hooks.sh — Install the project's git hooks into .git/hooks/.
#
# Idempotent: safe to run repeatedly (e.g., on every `npm install` via the
# `prepare` lifecycle script). Each run overwrites the hook with the current
# content; .git/hooks/commit-msg.bak is also overwritten, which is fine.
#
# Safe-on-no-git: if .git/ is absent (CI shallow clone, deployed env, Vercel
# build), the script prints an informational message and exits 0.

set -e

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || true

# Step 1 — Detect .git presence
if [ -z "$REPO_ROOT" ] || [ ! -d "$REPO_ROOT/.git" ]; then
  echo "No .git directory found — skipping hook installation"
  exit 0
fi

HOOKS_DIR="$REPO_ROOT/.git/hooks"
HOOK_TARGET="$HOOKS_DIR/commit-msg"
HOOK_BACKUP="$HOOKS_DIR/commit-msg.bak"
HOOK_SOURCE="$REPO_ROOT/scripts/commit-msg.mjs"

# Step 2 — Back up any existing hook before overwriting
if [ -f "$HOOK_TARGET" ]; then
  cp "$HOOK_TARGET" "$HOOK_BACKUP"
  echo "Backed up existing commit-msg hook to .git/hooks/commit-msg.bak"
fi

# Step 3 — Write the hook wrapper
cat > "$HOOK_TARGET" << 'HOOK'
#!/bin/sh
node "$(git rev-parse --show-toplevel)/scripts/commit-msg.mjs" "$1"
HOOK

# Step 4 — Make it executable
chmod +x "$HOOK_TARGET"

# Step 5 — Confirm
echo "commit-msg hook installed."
