/**
 * Routes the narrow BYOK IPC commands to the main-process model service.
 * The renderer receives validated settings, status and events, never credential values.
 */
import {
  BYOK_CHANNELS,
  ChatEventSchema,
  ChatRequestSchema,
  EmptyRequestSchema,
  ProbeRequestSchema,
  ProfileIdSchema,
  ProviderConfigSchema,
  RequestIdSchema,
  SettingsViewSchema,
  CliPreferenceSchema,
  CliTestSchema,
  CliAccessSchema,
  CliRefreshSchema,
  ChatPickSchema,
  ChatReleaseSchema,
  ChatFilesResultSchema,
  DictationCommandSchema,
  DictationResultSchema,
} from '@rovdo/shared';
import type { ChatEvent, Result } from '@rovdo/shared';
import { ByokService, failureCode } from './byok-service';
import { isTrustedFrame } from './security';

export async function handleByok(
  service: ByokService,
  channel: string,
  payload: unknown,
  sender: { url: string; isMainFrame: boolean; ownsWindow: boolean },
  send: (event: ChatEvent) => void,
): Promise<
  | Result
  | { ok: true; settings: ReturnType<typeof SettingsViewSchema.parse> }
  | ReturnType<typeof ChatFilesResultSchema.parse>
  | ReturnType<typeof DictationResultSchema.parse>
> {
  if (!sender.ownsWindow || !isTrustedFrame(sender.url, sender.isMainFrame))
    return { ok: false, code: 'IPC_FORBIDDEN' };
  const checked = <T>(schema: {
    safeParse(value: unknown): { success: true; data: T } | { success: false };
  }): T => {
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw new Error('VALIDATION_ERROR');
    return parsed.data;
  };
  try {
    switch (channel) {
      case BYOK_CHANNELS.cliAccess:
        await service.setCliAccess(checked(CliAccessSchema));
        break;
      case BYOK_CHANNELS.filesPick:
        return { ok: true, attachments: await service.pickFiles(checked(ChatPickSchema).kind) };
      case BYOK_CHANNELS.filesRelease:
        service.releaseFiles(checked(ChatReleaseSchema).ids);
        break;
      case BYOK_CHANNELS.dictation:
        return { ok: true, supported: service.dictation(checked(DictationCommandSchema), send) };
      case BYOK_CHANNELS.cliRefresh:
        await service.refreshClis(checked(CliRefreshSchema).force ?? true);
        break;
      case BYOK_CHANNELS.cliSave:
        await service.saveCli(checked(CliPreferenceSchema));
        break;
      case BYOK_CHANNELS.cliTest: {
        const value = checked(CliTestSchema);
        await service.testCli(value.id, value.requestId);
        break;
      }
      case BYOK_CHANNELS.settings:
        checked(EmptyRequestSchema);
        return { ok: true, settings: SettingsViewSchema.parse(await service.list()) };
      case BYOK_CHANNELS.save:
        await service.save(checked(ProviderConfigSchema));
        break;
      case BYOK_CHANNELS.remove:
        await service.remove(checked(ProfileIdSchema).profileId);
        break;
      case BYOK_CHANNELS.enterKey:
        await service.enterKey(checked(ProfileIdSchema).profileId);
        break;
      case BYOK_CHANNELS.removeKey:
        await service.removeKey(checked(ProfileIdSchema).profileId);
        break;
      case BYOK_CHANNELS.probe: {
        const value = checked(ProbeRequestSchema);
        await service.probe(value.profileId, value.consent);
        break;
      }
      case BYOK_CHANNELS.chat: {
        const value = checked(ChatRequestSchema);
        const emit = (event: ChatEvent) => send(ChatEventSchema.parse(event));
        void service.run(value, emit).catch((error: unknown) =>
          emit({
            type: 'done',
            requestId: value.requestId,
            status: 'failed',
            code: failureCode(error),
          }),
        );
        break;
      }
      case BYOK_CHANNELS.cancel:
        service.cancel(checked(RequestIdSchema).requestId);
        break;
      case BYOK_CHANNELS.clear:
        checked(EmptyRequestSchema);
        service.clear();
        break;
      default:
        throw new Error('VALIDATION_ERROR');
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      code: failureCode(error),
      ...(error instanceof Error &&
      'retryAfterMs' in error &&
      typeof error.retryAfterMs === 'number'
        ? { retryAfterMs: error.retryAfterMs }
        : {}),
    };
  }
}
