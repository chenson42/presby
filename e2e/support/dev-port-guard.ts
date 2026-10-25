/**
 * Refuses to run the Playwright dev lane from a linked git worktree against
 * port 3000 (Workflow Rule 16: "a run that attached to :3000 is discarded").
 *
 * Port 3000 is the main checkout's dev-server port. From a worktree, anything
 * listening there is probably another checkout's server, and the config's
 * `reuseExistingServer` would happily attach to it: the run then tests the wrong
 * code against the wrong database. Three QA runs were discarded or contaminated
 * that way before this was mechanical.
 *
 * Throws only when ALL hold: CI is unset, PW_ALLOW_3000 is not exactly "1", the
 * resolved base URL is a loopback host on port 3000, and the project directory
 * is a linked worktree. The main checkout, CI, an unreadable git and an
 * unparsable URL never throw (Playwright reports a bad URL itself).
 *
 * Imported by playwright.config.ts, which reloads in every worker, so the throw
 * repeats harmlessly there. It applies to the dev lane and the visual run (both
 * start or reuse a dev server) and never to the production-build lane, which
 * already rejects E2E_BASE_URL and port 3000 on its own.
 */
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";

const DEFAULT_BASE_URL = "http://localhost:3000";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);

export interface DevPort {
  port: number;
  origin: string;
  loopback: boolean;
}

/** The port a base URL means (80/443 when absent), or null when it is not a URL. */
export function resolveDevPort(baseUrl: string | undefined): DevPort | null {
  let url: URL;
  try {
    url = new URL(baseUrl ?? DEFAULT_BASE_URL);
  } catch {
    return null;
  }
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  return { port, origin: url.origin, loopback: LOOPBACK_HOSTS.has(url.hostname) };
}

type Git = (args: string[], cwd: string) => string;

const defaultGit: Git = (args, cwd) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

/**
 * True when `dir` is a linked worktree: `git rev-parse --git-dir` differs from
 * `--git-common-dir`. Any git failure means "treat as the main checkout".
 */
export function isLinkedWorktree(dir: string, git: Git = defaultGit): boolean {
  try {
    const gitDir = path.resolve(dir, git(["rev-parse", "--git-dir"], dir));
    const commonDir = path.resolve(dir, git(["rev-parse", "--git-common-dir"], dir));
    const real = (p: string) => {
      try {
        return realpathSync(p);
      } catch {
        return p;
      }
    };
    return real(gitDir) !== real(commonDir);
  } catch {
    return false;
  }
}

export interface GuardOptions {
  baseUrl?: string | undefined;
  projectDir?: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  /** Injected by tests; defaults to a real `git rev-parse` check of projectDir. */
  isWorktree?: (dir: string) => boolean;
}

/** The refusal text, or null when the run is allowed. */
export function devLaneGuardMessage(opts: GuardOptions = {}): string | null {
  const env = opts.env ?? process.env;
  if (env.CI) return null;
  if (env.PW_ALLOW_3000 === "1") return null;
  const resolved = resolveDevPort(opts.baseUrl);
  if (!resolved || !resolved.loopback || resolved.port !== 3000) return null;
  const dir = opts.projectDir ?? process.cwd();
  if (!(opts.isWorktree ?? ((d: string) => isLinkedWorktree(d)))(dir)) return null;
  return (
    `Refusing to run Playwright from a linked git worktree against ${resolved.origin} (port 3000).\n` +
    "Port 3000 is the shared dev-server port; anything already listening there is probably another checkout's server, so this run would test the wrong code against the wrong database.\n" +
    'Start your own server on your assigned port and set E2E_BASE_URL to it (docs/testing.md, "Running Playwright from a worktree").\n' +
    "To use port 3000 anyway, set PW_ALLOW_3000=1."
  );
}

export function assertDevLaneAllowed(opts: GuardOptions = {}): void {
  const message = devLaneGuardMessage(opts);
  if (message) throw new Error(message);
}
