/**
 * Credential-vault abstraction with accounts scoped to a provider profile and destination.
 * Only main-process callers can retrieve keys; SQLite stores configuration and credential status separately.
 */
import { createHash } from 'node:crypto';
import type { ProviderConfig } from '@rovdo/shared';

export type VaultEntry = {
  getPassword(): Promise<string | null>;
  setPassword(value: string): Promise<void>;
  deleteCredential(): Promise<boolean>;
};
export function credentialAccount(profile: ProviderConfig): string {
  return `${profile.id}:${createHash('sha256').update(`${profile.kind}:${profile.baseUrl}`).digest('hex')}`;
}
export class CredentialVault {
  constructor(
    private readonly entry: (account: string) => VaultEntry,
    private readonly prompt: () => Promise<string | null>,
  ) {}
  async enter(profile: ProviderConfig): Promise<boolean> {
    try {
      const entry = this.entry(credentialAccount(profile));
      const secret = await this.prompt();
      if (secret === null) return false;
      if (!secret.trim() || secret.length > 4096 || /[\r\n]/.test(secret))
        throw new Error('VALIDATION_ERROR');
      await entry.setPassword(secret);
      return true;
    } catch (error) {
      if (
        error instanceof Error &&
        ['VALIDATION_ERROR', 'CREDENTIAL_ENTRY_UNAVAILABLE'].includes(error.message)
      )
        throw error;
      // eslint-disable-next-line preserve-caught-error -- Native error causes can contain credentials.
      throw new Error('VAULT_UNAVAILABLE');
    }
  }
  async get(profile: ProviderConfig): Promise<string | null> {
    try {
      return await this.entry(credentialAccount(profile)).getPassword();
    } catch {
      throw new Error('VAULT_UNAVAILABLE');
    }
  }
  async has(profile: ProviderConfig): Promise<boolean> {
    return (await this.get(profile)) !== null;
  }
  async remove(profile: ProviderConfig): Promise<void> {
    try {
      await this.entry(credentialAccount(profile)).deleteCredential();
    } catch {
      throw new Error('VAULT_UNAVAILABLE');
    }
  }
}
