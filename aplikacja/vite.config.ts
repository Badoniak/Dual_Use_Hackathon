import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import type { Connect, Plugin } from 'vite'
import path from 'path'
import fs from 'fs'

import tailwindcss from '@tailwindcss/vite'

// Katalog z danymi z symulacji (ROS 2 / Gazebo). Można nadpisać zmienną SIM_DATA_DIR.
const SIM_DATA_DIR = path.resolve(import.meta.dirname, process.env.SIM_DATA_DIR ?? 'dane_z_symulacji')

const MIME: Record<string, string> = {
  '.json': 'application/json',
  '.csv': 'text/csv; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.wav': 'audio/wav',
  '.gpx': 'application/gpx+xml',
}

// Serwuje dane z symulacji pod /sim-data/ bez kopiowania ich do public/ (to ~130 MB).
function simDataMiddleware(): Connect.NextHandleFunction {
  return (req, res, next) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0])
    const file = path.resolve(SIM_DATA_DIR, '.' + url)
    if (!file.startsWith(SIM_DATA_DIR + path.sep)) return next()
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        res.statusCode = 404
        res.end('not found')
        return
      }
      res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream')
      res.setHeader('Content-Length', String(st.size))
      res.setHeader('Cache-Control', 'no-cache')
      fs.createReadStream(file).pipe(res)
    })
  }
}

function simDataPlugin(): Plugin {
  return {
    name: 'sim-data',
    configureServer(server) {
      server.middlewares.use('/sim-data', simDataMiddleware())
    },
    configurePreviewServer(server) {
      server.middlewares.use('/sim-data', simDataMiddleware())
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [tailwindcss(), react(), simDataPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  optimizeDeps: {
    exclude: ['maplibre-gl']
  },
  worker: {
    format: 'es',
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
  },
})
