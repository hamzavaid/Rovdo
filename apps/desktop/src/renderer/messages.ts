/**
 * User-facing explanations for the allow-listed provider failure codes.
 * Avoid displaying raw SDK exceptions, which may contain sensitive request details.
 */
import type { FailureCode } from '@rovdo/shared';

export const errorMessage: Record<FailureCode, string> = {
  VALIDATION_ERROR: 'Check the fields and try again.',
  IPC_FORBIDDEN: 'This window cannot perform that operation.',
  INTERNAL_ERROR: 'The operation could not complete. Retry or restart Rovdo.',
  VAULT_UNAVAILABLE: 'The OS credential vault is locked or unavailable. Unlock it and retry.',
  CREDENTIAL_ENTRY_UNAVAILABLE:
    'Native key entry is unavailable. Linux requires Zenity and an unlocked Secret Service vault.',
  KEY_REQUIRED: 'Store an API key in the OS vault first.',
  PROFILE_NOT_FOUND: 'Select an existing profile.',
  BUSY: 'Stop the current request before changing settings.',
  AUTH_FAILED: 'The provider rejected authentication. Check the key and account access.',
  RATE_LIMITED:
    'The provider rate limit was reached. Wait before retrying; no request was replayed.',
  PROVIDER_UNAVAILABLE: 'The provider is unavailable. Check connectivity, then retry explicitly.',
  INVALID_RESPONSE:
    'The model returned an unsupported, incomplete, or invalid response. No action was executed.',
  TIMEOUT: 'The request timed out. You can retry explicitly.',
  CANCELED: 'Stopped. Partial output was not added to conversation history.',
  DESTINATION_BLOCKED: 'The destination or redirect is blocked by the network policy.',
  CAPABILITY_REQUIRED:
    'Save settings and verify streaming and tool support with a connection test.',
  BUDGET_EXCEEDED:
    'The estimated limit cannot cover this request. Check pricing, token limits, and budget.',
};
