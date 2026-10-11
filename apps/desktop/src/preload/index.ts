import { contextBridge, ipcRenderer } from 'electron';
import type { FactwrightApi } from '../shared/api.ts';

// The window's only way to reach the main process. Each call maps to one checked handler.
const api: FactwrightApi = {
  platform: process.platform,
  claudeStatus: () => ipcRenderer.invoke('claude:status'),
};

contextBridge.exposeInMainWorld('factwright', api);
