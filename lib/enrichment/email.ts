/**
 * SentinelFraud — email domain risk enrichment.
 *
 * Pure and offline: classifies an email address by its domain against a
 * bundled list of disposable/throwaway domains and a list of common free
 * consumer providers. No network call, so it is deterministic and always
 * available. (A keyless disposable-check API could be added as an optional
 * online fallback; the offline list keeps the demo reproducible.)
 */

export interface EmailInfo {
  domain: string | null;
  /** Domain belongs to a known disposable/throwaway email service. */
  disposable: boolean;
  /** Domain is a common free consumer provider (gmail, yahoo, ...). */
  freeProvider: boolean;
}

export const EMAIL_FALLBACK: EmailInfo = { domain: null, disposable: false, freeProvider: false };

/**
 * Bundled subset of the widely used open-source disposable-domain lists
 * (e.g. disposable-email-domains). Trimmed for a demo; extend as needed.
 */
export const DISPOSABLE_DOMAINS: ReadonlySet<string> = new Set([
  'mailinator.com',
  'guerrillamail.com',
  'guerrillamail.info',
  '10minutemail.com',
  '10minutemail.net',
  'temp-mail.org',
  'tempmail.com',
  'throwawaymail.com',
  'yopmail.com',
  'trashmail.com',
  'getnada.com',
  'sharklasers.com',
  'maildrop.cc',
  'dispostable.com',
  'fakeinbox.com',
  'mailnesia.com',
  'mohmal.com',
  'moakt.com',
  'emailondeck.com',
  'spam4.me',
  'grr.la',
  'mytemp.email',
  'tempmailo.com',
  'burnermail.io',
]);

/** Common free consumer providers — a weak signal, weighted lightly. */
export const FREE_PROVIDERS: ReadonlySet<string> = new Set([
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'aol.com',
  'icloud.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'mail.com',
  'yandex.com',
  'zoho.com',
]);

/** Extract a normalized domain from an email address, or null if malformed. */
export function emailDomain(email: string): string | null {
  const value = (email ?? '').trim().toLowerCase();
  const at = value.lastIndexOf('@');
  if (at <= 0 || at === value.length - 1) return null;
  const domain = value.slice(at + 1);
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return null;
  return domain;
}

/** Classify an email's domain. Pure; never throws. */
export function analyzeEmail(email: string): EmailInfo {
  const domain = emailDomain(email);
  if (!domain) return EMAIL_FALLBACK;
  return {
    domain,
    disposable: DISPOSABLE_DOMAINS.has(domain),
    freeProvider: FREE_PROVIDERS.has(domain),
  };
}
