/**
 * Optional anti-bot hook of the public signup. No external service is bundled: the default
 * verifier accepts everything (the honeypot field and the rate limiter are the built-in defences).
 * A deployment plugs a provider with `setCaptchaVerifier()` (Turnstile, hCaptcha…).
 */
export interface CaptchaVerifier {
  verify(token: string | undefined, ctx: { ip: string | null }): Promise<boolean>;
}

const acceptAll: CaptchaVerifier = { verify: () => Promise.resolve(true) };

let current: CaptchaVerifier = acceptAll;

export function setCaptchaVerifier(verifier: CaptchaVerifier | null): void {
  current = verifier ?? acceptAll;
}

export function getCaptchaVerifier(): CaptchaVerifier {
  return current;
}
