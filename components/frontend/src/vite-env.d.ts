interface ImportMetaEnv {
  readonly VITE_WS_URL: string
  readonly VITE_REST_URL: string
  readonly VITE_CLERK_PUBLISHABLE_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
