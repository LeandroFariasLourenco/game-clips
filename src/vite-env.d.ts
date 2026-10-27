/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MEDIA_BUCKET_URL?: string;
  readonly VITE_MEDIA_WORKER_URL?: string;
  readonly VITE_OWNER_EMAIL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
