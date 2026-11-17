import type { Express } from 'express';
import request from 'supertest';
import { expect } from 'vitest';
import type { Services } from '../../src/core/container.js';
import type { EffectivePolicy } from '../../src/core/security-policy.js';
import { overrideAuthMailer, type AuthMessage } from '../../src/modules/auth/index.js';
import { hashPassword } from '../../src/modules/auth/passwords.js';

export const PASSWORD = 'Correct-Horse-9-Battery';

/** Captures auth e-mails (reset links, invitations, verification) instead of queueing them. */
export function captureMail(): AuthMessage[] {
  const sent: AuthMessage[] = [];
  overrideAuthMailer((_s, m) => {
    sent.push(m);
    return Promise.resolve();
  });
  return sent;
}

/** Extracts `token=` from the last captured link of a template. */
export function tokenFrom(sent: AuthMessage[], code: string): string {
  const msg = [...sent].reverse().find((m) => m.templateCode === code);
  expect(msg).toBeTruthy();
  const json = JSON.stringify(msg!.data);
  const m = /token=([A-Za-z0-9_%-]+)/.exec(json);
  expect(m).toBeTruthy();
  return decodeURIComponent(m![1]!);
}

export async function setPassword(services: Services, userId: string, password = PASSWORD) {
  const u = await services.admin.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(password), passwordChangedAt: new Date() },
  });
  return u.email;
}

export async function setPolicy(
  services: Services,
  tenantId: string,
  data: Partial<Omit<EffectivePolicy, 'mfaMode'>> & { mfaMode?: EffectivePolicy['mfaMode'] },
) {
  await services.admin.securityPolicy.upsert({
    where: { tenantId },
    create: { tenantId, ...data },
    update: data,
  });
  await services.securityPolicies.invalidate(tenantId);
}

export function cookiesOf(res: request.Response): Record<string, string> {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const out: Record<string, string> = {};
  for (const c of raw ?? []) {
    const [pair] = c.split(';');
    const i = pair!.indexOf('=');
    out[pair!.slice(0, i)] = decodeURIComponent(pair!.slice(i + 1));
  }
  return out;
}

export interface StaffSession {
  accessToken: string;
  refresh: string;
  csrf: string;
  body: Record<string, unknown>;
}

export async function staffLogin(
  app: Express,
  host: string,
  email: string,
  password = PASSWORD,
): Promise<StaffSession> {
  const res = await request(app)
    .post('/api/v1/t/auth/login')
    .set('Host', host)
    .send({ email, password });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const c = cookiesOf(res);
  return {
    accessToken: res.body.accessToken as string,
    refresh: c.hm_rt!,
    csrf: c.hm_csrf!,
    body: res.body as Record<string, unknown>,
  };
}

export const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

export function refreshReq(
  app: Express,
  host: string,
  refresh: string,
  csrf: string,
  path = '/api/v1/t/auth/refresh',
) {
  return request(app)
    .post(path)
    .set('Host', host)
    .set('Cookie', `hm_rt=${refresh}; hm_prt=${refresh}; hm_art=${refresh}; hm_csrf=${csrf}`)
    .set('X-CSRF-Token', csrf);
}
