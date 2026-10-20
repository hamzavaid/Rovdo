/**
 * Re-exports the bounded public-read transport used to fulfill browser resource requests.
 * Keeping one transport preserves DNS/address checks across discovery and browser reads.
 */
export { readPublic } from '@rovdo/shared/network';
