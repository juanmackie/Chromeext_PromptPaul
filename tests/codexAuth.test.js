import { describe, expect, it } from 'vitest';
import {
  extractCodexAccountId,
  parseJwtClaims,
  sanitizeCodexAuth,
} from '../src/utils/codexAuth.js';

function jwtWithClaims(claims) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(claims)}.signature`;
}

describe('Codex authentication helpers', () => {
  it('parses the account id from the Codex JWT claim', () => {
    const token = jwtWithClaims({ chatgpt_account_id: 'account-123', email: 'user@example.com' });
    expect(parseJwtClaims(token)).toMatchObject({ chatgpt_account_id: 'account-123' });
    expect(extractCodexAccountId({ id_token: token })).toBe('account-123');
  });

  it('returns a secret-free connection status', () => {
    const status = sanitizeCodexAuth({
      accessToken: 'access-secret',
      refreshToken: 'refresh-secret',
      accountId: 'account-123',
      email: 'user@example.com',
      planType: 'plus',
      expiresAt: 123,
    });
    expect(status).toMatchObject({ connected: true, email: 'user@example.com', planType: 'plus' });
    expect(status.accessToken).toBeUndefined();
    expect(status.refreshToken).toBeUndefined();
  });
});
