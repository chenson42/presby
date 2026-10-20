import type { RecordHint } from "./checklist";

/**
 * hints.ts - plain-English copy for the per-record hints the checks write
 * (G11) and the "Why isn't it working?" causes (G31). PURE. Provider text is
 * never used here (G30); these are our words. Nothing tells the church to delete
 * an MX or SPF record.
 */

export const HINT_COPY: Record<RecordHint, string> = {
  keep_record: "Keep this record in place; it protects your domain from being claimed by someone else.",
  apex_alias:
    "A bare domain can't hold a CNAME. Use an A record with this value, or your DNS provider's ALIAS, ANAME or \"CNAME flattening\" setting (Cloudflare calls it CNAME flattening; GoDaddy and most registrars use an A record).",
  proxied:
    "This record is passing through Cloudflare's proxy (the orange cloud). Set it to DNS only (grey cloud) so visitors reach us directly.",
  leftover_aaaa:
    "There's an old AAAA record on this name. It sends some visitors to your old website. Delete it.",
  caa: "A CAA record on your domain doesn't allow our certificate authority. Add one that allows letsencrypt.org, or remove the CAA record.",
  dnssec:
    "DNSSEC looks misconfigured for this domain, so some visitors can't look it up. Fix or turn off DNSSEC at your registrar.",
};

export interface DiagnosisCause {
  key: "proxied" | "leftover_aaaa" | "caa" | "wrong_primary" | "propagation";
  title: string;
  body: string;
}

/** The first-line causes, in the order a support person checks them. */
export const DIAGNOSIS_CAUSES: readonly DiagnosisCause[] = [
  {
    key: "proxied",
    title: "The record is proxied (Cloudflare's orange cloud)",
    body: "Set the record to DNS only (grey cloud). A proxied record hides where the domain points, so we can't confirm your site is live.",
  },
  {
    key: "leftover_aaaa",
    title: "An old AAAA record is still there",
    body: "An AAAA record sends visitors on newer networks to your old host even when your A record is right. Delete any AAAA record on the same name.",
  },
  {
    key: "caa",
    title: "A CAA record blocks our certificate",
    body: "If your domain has a CAA record, it must allow letsencrypt.org, or we can't secure your site with HTTPS.",
  },
  {
    key: "wrong_primary",
    title: "The records are on a different address than your primary one",
    body: "Check that each record is at exactly the name shown, for example www.yourchurch.org and yourchurch.org are two different names.",
  },
  {
    key: "propagation",
    title: "DNS changes take time",
    body: "DNS changes can take up to an hour to be seen. If you just made a change, wait a little and press Check now.",
  },
];
