import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const envDir = path.dirname(fileURLToPath(import.meta.url))

function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }
    const eq = trimmed.indexOf('=')
    if (eq <= 0) {
      continue
    }
    const key = trimmed.slice(0, eq)
    let value = trimmed.slice(eq + 1)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

function applyEnvFile(fileName: string) {
  const filePath = path.join(envDir, fileName)
  if (!fs.existsSync(filePath)) {
    return
  }
  const parsed = parseEnvFile(fs.readFileSync(filePath, 'utf8'))
  for (const [key, value] of Object.entries(parsed)) {
    if (!key.startsWith('VITE_')) {
      continue
    }
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = value
    }
  }
}

export default defineConfig(() => {
  applyEnvFile('.env')
  applyEnvFile('.env.local')
  applyEnvFile('.env.development')
  applyEnvFile('.env.development.local')

  return {
    envDir,
    envPrefix: 'VITE_',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(envDir, './src'),
      },
    },
    server: {
      host: true,
    },
  }
})
