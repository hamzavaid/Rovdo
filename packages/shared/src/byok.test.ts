import { describe, expect, it } from 'vitest';
import { ProviderConfigSchema, ChatRequestSchema } from './byok';

const profile = {
  id: 'e7aca4d4-058c-49b9-8f41-ef362fe15d07',
  label: 'OpenAI',
  kind: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  model: 'my-model',
  timeoutMs: 10000,
  maxOutputTokens: 1024,
  includeUsage: true,
};
describe('BYOK input boundary', () => {
  it('accepts explicit settings without secrets', () =>
    expect(ProviderConfigSchema.parse(profile)).toEqual(profile));
  it.each([
    { apiKey: 'canary' },
    { password: 'canary' },
    { baseUrl: 'https://attacker.example/v1' },
    { baseUrl: 'https://api.openai.com/v1?key=canary' },
    { timeoutMs: 0 },
    { maxOutputTokens: -1 },
    { model: '' },
    { pricing: { inputPerMillion: -1, outputPerMillion: 2, version: 'x' } },
  ])('rejects invalid profiles: %j', (extra) =>
    expect(ProviderConfigSchema.safeParse({ ...profile, ...extra }).success).toBe(false),
  );
  it.each([
    'file:///etc/passwd',
    'http://public.example/v1',
    'https://user:secret@models.example/v1',
    'https://169.254.169.254/v1',
    'https://localhost.local/v1',
    'http://2130706433/v1',
    'http://0x7f000001/v1',
  ])('rejects unsafe compatible endpoints %s', (baseUrl) => {
    expect(
      ProviderConfigSchema.safeParse({ ...profile, kind: 'compatible', baseUrl }).success,
    ).toBe(false);
  });
  it('allows explicit literal loopback compatible endpoints', () => {
    expect(
      ProviderConfigSchema.safeParse({
        ...profile,
        kind: 'compatible',
        baseUrl: 'http://127.0.0.1:11434/v1',
      }).success,
    ).toBe(true);
  });
  it('allows explicitly unauthenticated compatible endpoints without weakening hosted authentication', () => {
    expect(
      ProviderConfigSchema.safeParse({
        ...profile,
        kind: 'compatible',
        baseUrl: 'http://127.0.0.1:11434/v1',
        authMode: 'none',
      }).success,
    ).toBe(true);
    expect(ProviderConfigSchema.safeParse({ ...profile, authMode: 'none' }).success).toBe(false);
  });
  it('requires per-request transmission consent and a bounded budget', () => {
    const chat = {
      requestId: profile.id,
      profileId: profile.id,
      text: 'Hello',
      consent: true,
      maxUsd: 1,
    };
    expect(ChatRequestSchema.safeParse(chat).success).toBe(true);
    expect(ChatRequestSchema.safeParse({ ...chat, consent: false }).success).toBe(false);
    expect(ChatRequestSchema.safeParse({ ...chat, maxUsd: -1 }).success).toBe(false);
    expect(ChatRequestSchema.safeParse({ ...chat, apiKey: 'canary' }).success).toBe(false);
  });
});
