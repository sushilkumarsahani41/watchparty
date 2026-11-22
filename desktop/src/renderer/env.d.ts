/// <reference types="vite/client" />
import type { WatchPartyApi } from "../shared/api";

declare global {
  interface Window {
    watchparty: WatchPartyApi;
  }
}
