import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron';
import type { FactwrightApi } from '../shared/api.ts';

// The window's only way to reach the main process. Each call maps to one checked handler.
const api: FactwrightApi = {
  platform: process.platform,
  claudeStatus: () => ipcRenderer.invoke('claude:status'),
  setupCheck: () => ipcRenderer.invoke('setup:latest'),
  checkSetup: () => ipcRenderer.invoke('setup:check'),
  onSetupCheck: (listener) => subscribe('setup:checked', listener),
  startClaude: (size, task) => ipcRenderer.invoke('claude:start', size, task),
  runTask: (task) => ipcRenderer.invoke('claude:task', task),
  stopClaude: () => ipcRenderer.send('claude:stop'),
  writeToClaude: (data) => ipcRenderer.send('claude:input', data),
  resizeClaude: (size) => ipcRenderer.send('claude:resize', size),
  onClaudeOutput: (listener) => subscribe('claude:output', listener),
  onClaudeSignal: (listener) => subscribe('claude:signal', listener),
  onClaudeTrust: (listener) => subscribe('claude:trust', listener),
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
  openFile: (path) => ipcRenderer.invoke('files:open', path),
  readPdf: (path) => ipcRenderer.invoke('files:pdf', path),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  saveFile: (name, text) => ipcRenderer.invoke('files:save', name, text),
  claudeModels: () => ipcRenderer.invoke('claude:models'),
  setClaudeModels: (models) => ipcRenderer.invoke('claude:set-models', models),
  claudePermissions: () => ipcRenderer.invoke('claude:permissions'),
  setClaudePermissions: (permissions) => ipcRenderer.invoke('claude:set-permissions', permissions),
  syncStatus: () => ipcRenderer.invoke('sync:status'),
  onSyncStatus: (listener) => subscribe('sync:status', listener),
  signInToSync: () => ipcRenderer.invoke('sync:sign-in'),
  cancelSyncSignIn: () => ipcRenderer.send('sync:cancel-sign-in'),
  makeRecoveryKey: () => ipcRenderer.invoke('sync:recovery-key'),
  turnOnSync: () => ipcRenderer.invoke('sync:turn-on'),
  linkWithCode: (code) => ipcRenderer.invoke('sync:link', code),
  useRecoveryKey: (recoveryKey) => ipcRenderer.invoke('sync:recover', recoveryKey),
  makeLinkCode: () => ipcRenderer.invoke('sync:link-code'),
  cancelLinkCode: (id) => ipcRenderer.send('sync:cancel-link-code', id),
  syncNow: () => ipcRenderer.send('sync:now'),
  syncAccount: () => ipcRenderer.invoke('sync:account'),
  removeSyncDevice: (id) => ipcRenderer.invoke('sync:remove-device', id),
  signOutOfSync: () => ipcRenderer.invoke('sync:sign-out'),
  openAccountPage: () => ipcRenderer.invoke('sync:account-page'),
  profile: () => ipcRenderer.invoke('about:profile'),
  saveAnswers: (changes) => ipcRenderer.invoke('about:save', changes),
  saveNotes: (text) => ipcRenderer.invoke('about:notes', text),
  saveConfidential: (names) => ipcRenderer.invoke('about:confidential', names),
  addFile: (upload) => ipcRenderer.invoke('about:add-file', upload),
  addLinkedIn: (upload) => ipcRenderer.invoke('about:add-linkedin', upload),
  removeFile: (path) => ipcRenderer.invoke('about:remove-file', path),
  startProfile: () => ipcRenderer.invoke('about:start'),
  useAnswersForCriteria: () => ipcRenderer.invoke('about:use-answers'),
  templatePreview: (layout, name) => ipcRenderer.invoke('about:preview', layout, name),
  onProfileChanged: (listener) => subscribe('about:changed', listener),
  openTerminal: () => ipcRenderer.invoke('system:open-terminal'),
};

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('factwright', api);
