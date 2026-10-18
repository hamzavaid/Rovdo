import { contextBridge, ipcRenderer } from 'electron';
import { APP_INFO_CHANNEL, AppInfoSchema, BYOK_CHANNELS, ChatEventSchema, ChatRequestSchema, EmptyRequestSchema, ProbeRequestSchema, ProfileIdSchema, ProviderConfigSchema, RequestIdSchema, ResultSchema, SettingsResultSchema } from '@rovdo/shared';
import type { DesktopApi } from '@rovdo/shared';
import { BROWSER_CHANNEL, BrowserCommandSchema, BrowserResultSchema } from '@rovdo/shared';
import { CAREER_CHANNEL, CareerCommandSchema, CareerResultSchema } from '@rovdo/shared';
import { INTELLIGENCE_CHANNEL, IntelligenceCommandSchema, IntelligenceResultSchema } from '@rovdo/shared';

function validated<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error('VALIDATION_ERROR');
  return parsed.data;
}
async function invoke<T>(channel: string, payload: unknown, schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }): Promise<T> {
  try { return validated(schema, await ipcRenderer.invoke(channel, payload)); }
  catch { throw new Error('INTERNAL_ERROR'); }
}

const api: DesktopApi = Object.freeze<DesktopApi>({
  intelligenceCommand: (input) => invoke(INTELLIGENCE_CHANNEL, validated(IntelligenceCommandSchema, input), IntelligenceResultSchema),
  careerCommand: (input) => invoke(CAREER_CHANNEL, validated(CareerCommandSchema, input), CareerResultSchema),
  browserCommand: (input) => invoke(BROWSER_CHANNEL, validated(BrowserCommandSchema, input), BrowserResultSchema),
  async getAppInfo() {
    const result: unknown = await ipcRenderer.invoke(APP_INFO_CHANNEL, {});
    const parsed = AppInfoSchema.safeParse(result);
    if (!parsed.success) throw new Error('VALIDATION_ERROR');
    return parsed.data;
  },
  getSettings: () => invoke(BYOK_CHANNELS.settings, {}, SettingsResultSchema),
  saveProfile: (input) => invoke(BYOK_CHANNELS.save, validated(ProviderConfigSchema, input), ResultSchema),
  removeProfile: (input) => invoke(BYOK_CHANNELS.remove, validated(ProfileIdSchema, input), ResultSchema),
  enterKey: (input) => invoke(BYOK_CHANNELS.enterKey, validated(ProfileIdSchema, input), ResultSchema),
  removeKey: (input) => invoke(BYOK_CHANNELS.removeKey, validated(ProfileIdSchema, input), ResultSchema),
  testConnection: (input) => invoke(BYOK_CHANNELS.probe, validated(ProbeRequestSchema, input), ResultSchema),
  startChat: (input) => invoke(BYOK_CHANNELS.chat, validated(ChatRequestSchema, input), ResultSchema),
  cancelChat: (input) => invoke(BYOK_CHANNELS.cancel, validated(RequestIdSchema, input), ResultSchema),
  clearChat: () => invoke(BYOK_CHANNELS.clear, validated(EmptyRequestSchema, {}), ResultSchema),
  onChatEvent(listener) {
    const handle = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      const event = ChatEventSchema.safeParse(payload); if (event.success) listener(event.data);
    };
    ipcRenderer.on(BYOK_CHANNELS.event, handle);
    return () => { ipcRenderer.removeListener(BYOK_CHANNELS.event, handle); };
  },
});

contextBridge.exposeInMainWorld('rovdo', api);
