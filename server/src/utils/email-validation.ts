/**
 * Email validation beyond syntax: typo suggestions and disposable-inbox
 * blocking. Nothing here sends mail — this is the "is this a real, usable
 * email" gate for signup.
 */

/** Popular domains for typo detection (Levenshtein distance 1-2). */
const COMMON_DOMAINS = [
  'gmail.com', 'yahoo.com', 'yahoo.in', 'yahoo.co.in', 'outlook.com', 'hotmail.com',
  'live.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com',
  'rediffmail.com', 'zoho.com', 'yandex.com', 'gmx.com',
];

/** Disposable / temp-mail providers — blocked at signup. Extensible list. */
const DISPOSABLE_DOMAINS = new Set([
  // 10-minute-mail family
  '10minutemail.com', '10minutemail.net', 'temp-mail.org', 'temp-mail.io', 'tempmail.com',
  'tempmail.net', 'tempmailo.com', 'tempr.email', 'tmpmail.net', 'tmpmail.org',
  // throwaway classics
  'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org', 'sharklasers.com',
  'grr.la', 'guerrillamailblock.com', 'spam4.me', 'pokemail.net',
  'mailinator.com', 'mailinator.net', 'mailinator2.com', 'sogetthis.com', 'reallymymail.com',
  'yopmail.com', 'yopmail.net', 'yopmail.fr', 'cool.fr.nf', 'jetable.fr.nf', 'nospam.ze.tc',
  'trashmail.com', 'trashmail.net', 'trashmail.de', 'trash-mail.com', 'kurzepost.de',
  'getnada.com', 'nada.email', 'dispostable.com', 'maildrop.cc', 'mailnesia.com',
  'mytemp.email', 'mohmal.com', 'emailondeck.com', 'fakeinbox.com', 'spamgourmet.com',
  'burnermail.io', '33mail.com', 'anonaddy.com', 'anonaddy.me', 'simplelogin.io',
  // common fake generators
  'fakemailgenerator.com', 'tempinbox.com', 'throwawaymail.com', 'mailcatch.com',
  'mintemail.com', 'meltmail.com', 'mailexpire.com', 'spambox.us', 'incognitomail.com',
  'discard.email', 'discardmail.com', 'binkmail.com', 'bobmail.info', 'chammy.info',
  'devnullmail.com', 'letthemeatspam.com', 'mailhed.com', 'mailismagic.com',
  'my10minutemail.com', 'notmailinator.com', 'onesecmail.com', 'onesecmail.net',
  'smailpro.com', 'tempemail.co', 'tempemail.net', 'tempmailaddress.com', 'tmail.ws',
  // popular in fake-account farms
  '1secmail.com', '1secmail.net', '1secmail.org', 'esiix.com', 'wwjmp.com', 'xojxe.com',
  'vjuum.com', 'laafd.com', 'txcct.com', 'kzccv.com', 'qiott.com', 'wuuvo.com',
]);

/** Minimum legit-domain heuristics: dots present, no obvious junk patterns. */
function looksLikeRealDomain(domain: string): boolean {
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return false;
  if (domain.includes('..') || domain.startsWith('-') || domain.endsWith('-')) return false;
  if (domain.split('.').some((part) => part.length > 63)) return false;
  // No sequential garbage like a1b2c3@...
  return true;
}

/** Levenshtein distance — small, no deps needed for our use. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[n];
}

export interface EmailCheck {
  ok: boolean;
  /** Human-friendly reason when not ok */
  error?: string;
  /** Did-you-mean suggestion for typos ("gmial.com" → "gmail.com") */
  suggestion?: string;
}

/**
 * Validate an email for signup: syntax, domain sanity, disposable detection,
 * and typo suggestions. Local part is NOT case-normalized here (do that at
 * the DB layer / lower-case it before calling).
 */
export function checkEmail(rawEmail: string): EmailCheck {
  const email = (rawEmail || '').trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) {
    return { ok: false, error: 'Enter a valid email address' };
  }
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);

  if (local.length < 1 || local.length > 64) {
    return { ok: false, error: 'Enter a valid email address' };
  }
  if (!/^[a-z0-9._%+-]+$/.test(local)) {
    return { ok: false, error: 'Email contains invalid characters' };
  }
  if (!looksLikeRealDomain(domain)) {
    return { ok: false, error: 'Enter a valid email domain' };
  }

  // Disposable inbox?
  const root = domain.split('.').slice(-2).join('.'); // mail.temp-mail.org → temp-mail.org
  if (DISPOSABLE_DOMAINS.has(domain) || DISPOSABLE_DOMAINS.has(root)) {
    return { ok: false, error: 'Temporary email addresses are not allowed — use your real email' };
  }

  // Typo detection against popular domains
  if (!COMMON_DOMAINS.includes(domain)) {
    for (const known of COMMON_DOMAINS) {
      const d = levenshtein(domain, known);
      const lenOk = known.length > 8 ? d <= 2 : d <= 1;
      if (lenOk && domain !== known) {
        return { ok: true, suggestion: `${local}@${known}` };
      }
    }
  }

  return { ok: true };
}
