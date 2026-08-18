import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  generateSecret as otpGenerateSecret,
  generateURI,
  verifySync,
} from "otplib";

const ALGO = "aes-256-gcm";

function key(): Buffer {
  const k = process.env.AUTH_TOTP_ENCRYPTION_KEY;
  if (!k) throw new Error("AUTH_TOTP_ENCRYPTION_KEY is not set");
  const buf = Buffer.from(k, "base64");
  if (buf.length !== 32) {
    throw new Error("AUTH_TOTP_ENCRYPTION_KEY must decode to 32 bytes");
  }
  return buf;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decryptSecret(ciphertext: string): string {
  const buf = Buffer.from(ciphertext, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString(
    "utf8",
  );
}

export function generateSecret(): string {
  return otpGenerateSecret();
}

export function otpauthUrl(
  email: string,
  secret: string,
  issuer = "Claude Code Starter",
): string {
  return generateURI({ issuer, label: email, secret });
}

export function verifyToken(token: string, secret: string): boolean {
  // RFC 6238 recommends a small backward tolerance to handle clock drift
  // between the server and the user's authenticator. `[30, 0]` (seconds)
  // accepts the previous 30-second step but no future steps.
  return verifySync({ secret, token, epochTolerance: [30, 0] }).valid;
}

// -----------------------------------------------------------------------------
// Recovery codes
//
// Format: 10 codes, each `XXXX-XXXX` (8 alphanumeric chars + a dash for
// readability). Hashed with SHA-256 (codes are high-entropy and single-use,
// so a slow hash like bcrypt would buy nothing). The plaintext set is only
// shown once via the FRESH_RECOVERY_CODES_COOKIE handoff.
// -----------------------------------------------------------------------------

const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

export const FRESH_RECOVERY_CODES_COOKIE = "claudecode_fresh_recovery_codes";

export function generateRecoveryCodes(): string[] {
  const out: string[] = [];
  while (out.length < RECOVERY_CODE_COUNT) {
    const bytes = randomBytes(8);
    let s = "";
    for (let i = 0; i < 8; i++) {
      s += RECOVERY_CODE_ALPHABET[bytes[i] % RECOVERY_CODE_ALPHABET.length];
    }
    out.push(`${s.slice(0, 4)}-${s.slice(4)}`);
  }
  return out;
}

export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

export function normalizeRecoveryCode(input: string): string | null {
  const trimmed = input.trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9-]{8,10}$/.test(trimmed)) return null;
  if (trimmed.length === 8) return `${trimmed.slice(0, 4)}-${trimmed.slice(4)}`;
  return trimmed;
}
