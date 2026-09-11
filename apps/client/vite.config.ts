import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Port overrides so an E2E run (or a second checkout) can coexist with a
// human's `pnpm dev` on the same machine — see README "Ports":
//   CLIENT_PORT  dev-server port (default 5173; Vite's own `--port` also works).
//                When set, the port is strict: a busy port fails instead of
//                silently drifting to the next one, which would break the
//                URL the caller (Playwright, a teammate) was told to use.
//   PORT         the game server's port; when set (and VITE_SERVER_URL is
//                not), the dev client is pointed at http://localhost:$PORT so
//                one env var moves both halves. Only applies to `vite`
//                serve, never to a production build.
const clientPort = process.env.CLIENT_PORT ? Number(process.env.CLIENT_PORT) : undefined
const serverPort = process.env.PORT ? Number(process.env.PORT) : undefined

export default defineConfig(({ command }) => ({
  plugins: [react()],
  ...(clientPort !== undefined ? { server: { port: clientPort, strictPort: true } } : {}),
  ...(command === 'serve' && serverPort !== undefined && !process.env.VITE_SERVER_URL
    ? { define: { 'import.meta.env.VITE_SERVER_URL': JSON.stringify(`http://localhost:${serverPort}`) } }
    : {}),
  build: { outDir: 'dist' },
}))
