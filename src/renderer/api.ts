import type { Api } from '../preload';

declare global {
  interface Window {
    api: Api;
  }
}

export const api = (typeof window !== 'undefined' ? window.api : (undefined as unknown)) as Api;
