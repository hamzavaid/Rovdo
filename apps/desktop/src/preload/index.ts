import { contextBridge, ipcRenderer } from 'electron';
import { APP_INFO_CHANNEL, AppInfoSchema } from '@rovdo/shared';
import type { DesktopApi } from '@rovdo/shared';

const api: DesktopApi = Object.freeze({
  async getAppInfo() {
    const result: unknown = await ipcRenderer.invoke(APP_INFO_CHANNEL, {});
    const parsed = AppInfoSchema.safeParse(result);
    if (!parsed.success) throw new Error('VALIDATION_ERROR');
    return parsed.data;
  },
});

contextBridge.exposeInMainWorld('rovdo', api);
