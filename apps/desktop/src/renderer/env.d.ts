/**
 * Renderer-only Window typing for the validated preload API.
 * This declaration describes capabilities; it does not expose Node or Electron objects.
 */
/// <reference types="vite/client" />
import type { DesktopApi } from '@rovdo/shared';

declare global {
  interface Window {
    readonly rovdo?: DesktopApi;
  }
}
