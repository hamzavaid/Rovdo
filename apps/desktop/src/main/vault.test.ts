import { describe, expect, it } from 'vitest';
import { CredentialVault } from './vault';

const profile = {
  id: 'e7aca4d4-058c-49b9-8f41-ef362fe15d07',
  label: 'Fixture',
  kind: 'compatible' as const,
  baseUrl: 'https://models.example.com/v1',
  model: 'fixture',
  timeoutMs: 5000,
  maxOutputTokens: 512,
  includeUsage: true,
};
describe('credential isolation', () => {
  it('binds credentials to profile, provider and destination; returns no value on entry', async () => {
    const values = new Map<string, string>();
    const vault = new CredentialVault(
      (account) => ({
        getPassword: async () => values.get(account) ?? null,
        setPassword: async (secret: string) => {
          values.set(account, secret);
        },
        deleteCredential: async () => values.delete(account),
      }),
      async () => 'secret-canary',
    );
    expect(await vault.enter(profile)).toBe(true);
    expect(await vault.has(profile)).toBe(true);
    expect(await vault.get({ ...profile, baseUrl: 'https://other.example.com/v1' })).toBeNull();
    expect(await vault.get(profile)).toBe('secret-canary');
    await vault.remove(profile);
    expect(await vault.has(profile)).toBe(false);
  });
  it('never substitutes plaintext storage when the OS vault is unavailable', async () => {
    const vault = new CredentialVault(
      () => {
        throw new Error('secret-canary');
      },
      async () => 'secret-canary',
    );
    await expect(vault.enter(profile)).rejects.toThrow('VAULT_UNAVAILABLE');
    await expect(vault.get(profile)).rejects.toThrow('VAULT_UNAVAILABLE');
  });
  it('preserves an existing key when native entry is canceled', async () => {
    let writes = 0;
    const vault = new CredentialVault(
      () => ({
        getPassword: async () => 'old',
        setPassword: async () => {
          writes++;
        },
        deleteCredential: async () => true,
      }),
      async () => null,
    );
    expect(await vault.enter(profile)).toBe(false);
    expect(writes).toBe(0);
  });
});
