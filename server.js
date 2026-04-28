import express from 'express'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { readFileSync } from 'fs'

const app = express()
const __dirname = dirname(fileURLToPath(import.meta.url))

app.use(express.json({ limit: '100mb' }))
app.use(express.raw({ limit: '200mb', type: '*/*' }))

const ADMIN_USER = process.env.ADMIN_USER || 'lfbim'
const ADMIN_PASS = process.env.ADMIN_PASS || 'LFBim2026!'
const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SUPABASE_ANON = process.env.SUPABASE_ANON || ''
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE || ''

// Config pública para el frontend (sin service key)
const CONFIG_PUBLIC = {
  SUPABASE_URL,
  SUPABASE_ANON,
  ADMIN_USER,
  ADMIN_PASS,
}
const configScript = `<script>window.LF_CONFIG=${JSON.stringify(CONFIG_PUBLIC)};</script>`

function servirConConfig(filePath) {
  return (req, res) => {
    try {
      const html = readFileSync(filePath, 'utf-8')
      res.setHeader('Content-Type', 'text/html')
      res.send(html.replace('</head>', configScript + '</head>'))
    } catch (e) { res.status(500).send('Error: ' + e.message) }
  }
}

// Middleware auth para rutas admin API
function authAdmin(req, res, next) {
  const token = req.headers['x-admin-token']
  if (token === ADMIN_USER + ':' + ADMIN_PASS) return next()
  return res.status(401).json({ error: 'No autorizado' })
}

// ── API ADMIN (usa service key en el servidor) ──────────
async function sbAdmin(path, options = {}) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    ...options,
    headers: {
      'apikey': SUPABASE_SERVICE,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      ...options.headers,
    },
  })
  const text = await res.text()
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : {} }
}

// GET proyectos
app.get('/api/proyectos', authAdmin, async (req, res) => {
  const r = await sbAdmin('proyectos?order=created_at.desc')
  res.status(r.status).json(r.data)
})

// POST proyecto
app.post('/api/proyectos', authAdmin, async (req, res) => {
  const r = await sbAdmin('proyectos', { method: 'POST', body: JSON.stringify(req.body) })
  res.status(r.status).json(r.data)
})

// PATCH proyecto
app.patch('/api/proyectos/:id', authAdmin, async (req, res) => {
  const r = await sbAdmin('proyectos?id=eq.' + req.params.id, { method: 'PATCH', body: JSON.stringify(req.body) })
  res.status(r.status).json(r.data)
})

// Upload archivo a Supabase Storage
app.post(/^\/api\/upload\/([^/]+)\/(.+)$/, authAdmin, async (req, res) => {
  const bucket = req.params[0]
  const filePath = req.params[1]
  try {
    // El body ya viene parseado por express.raw
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body))
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${filePath}`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE,
        'Authorization': 'Bearer ' + SUPABASE_SERVICE,
        'Content-Type': req.headers['content-type'] || 'application/octet-stream',
        'x-upsert': 'true',
      },
      body: buffer,
    })
    const data = await r.text()
    res.status(r.status).json(data ? JSON.parse(data) : {})
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── RUTAS PÁGINAS ───────────────────────────────────────
app.get('/', (req, res) => res.sendFile(join(__dirname, 'dist', 'suite.html')))
app.get('/visor', (req, res) => res.sendFile(join(__dirname, 'dist', 'index.html')))
app.get('/vaciados', (req, res) => res.sendFile(join(__dirname, 'dist', 'vaciados.html')))
app.get('/admin', servirConConfig(join(__dirname, 'dist', 'admin.html')))
app.get('/p/:slug', servirConConfig(join(__dirname, 'dist', 'portal.html')))

// Listar proyectos para selector
app.get('/api/proyectos-publicos', async (req, res) => {
  const r = await sbAdmin('proyectos?activo=eq.true&select=id,nombre&order=nombre.asc')
  res.status(r.status).json(r.data)
})

app.use(express.static(join(__dirname, 'dist')))
app.get('/{*path}', (req, res) => res.sendFile(join(__dirname, 'dist', 'suite.html')))

const PORT = process.env.PORT || 10000
app.listen(PORT, '0.0.0.0', () => console.log(`LF BIM Studio running on port ${PORT}`))
