/// <reference types="vite/client" />
import type { DesktopApi } from '@rovdo/shared';

declare global {
  interface Window {
    readonly rovdo?: DesktopApi;
  }
}
