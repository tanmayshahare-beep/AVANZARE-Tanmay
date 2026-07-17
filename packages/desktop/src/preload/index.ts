import { contextBridge, ipcRenderer } from 'electron';

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('avz', {
  profiles: {
    list: () => invoke('profiles:list'),
    save: (p: unknown) => invoke('profiles:save', p),
    delete: (name: string) => invoke('profiles:delete', name),
  },
  testConnections: (p: unknown) => invoke('connections:test', p),
  listModels: (llm: unknown) => invoke('llm:models', llm),
  runScreening: (input: unknown) => invoke('screening:run', input),
  setTier: (ids: number[], tier: string) => invoke('applications:setTier', ids, tier),
  analyze: (payload: unknown) => invoke('llm:analyze', payload),
  sendEmails: (payload: unknown) => invoke('emails:send', payload),
  exportTable: (payload: unknown) => invoke('export:table', payload),
  lastJob: () => invoke('job:last'),
  candidates: {
    list: () => invoke('candidates:list'),
    purge: (id: number) => invoke('candidates:purge', id),
    addNote: (payload: unknown) => invoke('candidates:addNote', payload),
    history: (id: number) => invoke('candidates:history', id),
  },
  updateContact: (payload: unknown) => invoke('contacts:update', payload),
  cvText: (applicationId: number) => invoke('applications:cvText', applicationId),
  jobs: () => invoke('jobs:list'),
  jobMetrics: (jobId: number) => invoke('jobs:metrics', jobId),
  jobApplications: (jobId: number) => invoke('jobs:applications', jobId),
  auditList: (limit?: number) => invoke('audit:list', limit),
  openFile: (path: string) => invoke('file:open', path),
  pickFolder: () => invoke('dialog:pickFolder'),
  onProgress: (cb: (p: unknown) => void) => {
    const listener = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on('avz:progress', listener);
    return () => { ipcRenderer.removeListener('avz:progress', listener); };
  },
});
