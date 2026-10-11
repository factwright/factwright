import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron';
import type { FactwrightApi } from '../shared/api.ts';

// The window's only way to reach the main process. Each call maps to one checked handler.
const api: FactwrightApi = {
  platform: process.platform,
  claudeStatus: () => ipcRenderer.invoke('claude:status'),
  startClaude: (size) => ipcRenderer.invoke('claude:start', size),
  stopClaude: () => ipcRenderer.send('claude:stop'),
  writeToClaude: (data) => ipcRenderer.send('claude:input', data),
  resizeClaude: (size) => ipcRenderer.send('claude:resize', size),
  onClaudeOutput: (listener) => subscribe('claude:output', listener),
  onClaudeSignal: (listener) => subscribe('claude:signal', listener),
  listJobs: () => ipcRenderer.invoke('jobs:list'),
  jobDocs: (jobId) => ipcRenderer.invoke('jobs:docs', jobId),
  updateJob: (jobId, changes) => ipcRenderer.invoke('jobs:update', jobId, changes),
  addJob: (job) => ipcRenderer.invoke('jobs:add', job),
  addCall: (jobId, call) => ipcRenderer.invoke('calls:add', jobId, call),
  updateCall: (callId, changes) => ipcRenderer.invoke('calls:update', callId, changes),
  deleteCall: (callId) => ipcRenderer.invoke('calls:delete', callId),
  redateStatusChange: (changeId, at) => ipcRenderer.invoke('history:redate', changeId, at),
  undoStatusChange: (changeId) => ipcRenderer.invoke('history:undo', changeId),
  onJobsChanged: (listener) => subscribe('jobs:changed', listener),
};

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('factwright', api);
