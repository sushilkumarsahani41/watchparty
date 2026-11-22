import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { JobEvent, WatchPartyApi } from "../shared/api";

const api: WatchPartyApi = {
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    save: (s) => ipcRenderer.invoke("settings:save", s),
  },
  auth: {
    signIn: (email, password) => ipcRenderer.invoke("auth:signIn", email, password),
    signOut: () => ipcRenderer.invoke("auth:signOut"),
  },
  pickFile: () => ipcRenderer.invoke("file:pick"),
  job: {
    start: (input) => ipcRenderer.invoke("job:start", input),
    retry: () => ipcRenderer.invoke("job:retry"),
    cancel: () => ipcRenderer.invoke("job:cancel"),
    onEvent: (cb) => {
      const listener = (_e: IpcRendererEvent, ev: JobEvent) => cb(ev);
      ipcRenderer.on("job:event", listener);
      return () => ipcRenderer.removeListener("job:event", listener);
    },
  },
  library: {
    list: () => ipcRenderer.invoke("library:list"),
    delete: (item) => ipcRenderer.invoke("library:delete", item),
  },
  copy: (text) => ipcRenderer.invoke("clipboard:write", text),
  open: (url) => ipcRenderer.invoke("shell:open", url),
};

contextBridge.exposeInMainWorld("watchparty", api);
