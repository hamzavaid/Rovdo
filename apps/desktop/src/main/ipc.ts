import { AppInfoSchema, EmptyRequestSchema } from '@rovdo/shared';
import type { AppInfo } from '@rovdo/shared';
import { isTrustedFrame } from './security';

export function getAppInfo(
  payload: unknown,
  sender: { url: string; isMainFrame: boolean },
  version: string,
): AppInfo {
  if (!isTrustedFrame(sender.url, sender.isMainFrame)) throw new Error('IPC_FORBIDDEN');
  if (!EmptyRequestSchema.safeParse(payload).success) throw new Error('VALIDATION_ERROR');
  const info = AppInfoSchema.safeParse({ name: 'Rovdo', version, milestone: 'career-jobs', networkEnabled: false });
  if (!info.success) throw new Error('INTERNAL_ERROR');
  return info.data;
}
