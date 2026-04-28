import express from 'express'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const app = express()
const __dirname = dirname(fileURLToPath(import.meta.url))

// Config desde variables de entorno (nunca en el código)
const CONFIG = {
  SUPABASE_URL:     process.env.SUPABASE_URL     || '',
  SUPABASE_ANON:    process.env.SUPABASE_ANON    || '',
  SUPABASE_SERVICE: process.env.SUPABASE_SERVICE || '',
  ADMIN_USER:       process.env.ADMIN_USER        || 'lfbim',
  ADMIN_PASS:       process.env.ADMIN_PASS        || '',
}

// Middleware que inyecta LF_CONFIG en el HTML
function injectConfig(filePath) {
  return (req, res) => {
    const fs = (await import('fs')).readFileSync(filePath, 'utf-8')
    const configScript = `<script>window.LF_CONFIG=${JSON.stringify(CONFIG)};</script>`
    const html = fs.replace('</head>', configScript + '</head>')
    res.setHeader('Content-Type', 'text/html')
    res.send(html)
  }
}

// Rutas específicas
app.get('/', (req, res) => res.sendFile(join(__dirname, 'dist', 'suite.html')))
app.get('/visor', (req, res) => res.sendFile(join(__dirname, 'dist', 'index.html')))
app.get('/vaciados', (req, res) => res.sendFile(join(__dirname, 'dist', 'vaciados.html')))

// Admin — inyecta config
app.get('/admin', async (req, res) => {
  try {
    const { readFileSync } = await import('fs')
    const html = readFileSync(join(__dirname, 'dist', 'admin.html'), 'utf-8')
    const configScript = `<script>window.LF_CONFIG=${JSON.stringify(CONFIG)};</script>`
    res.setHeader('Content-Type', 'text/html')
    res.send(html.replace('</head>', configScript + '</head>'))
  } catch(e) { res.status(500).send('Error: ' + e.message) }
})

// Portal cliente — inyecta config
app.get('/p/:slug', async (req, res) => {
  try {
    const { readFileSync } = await import('fs')
    const html = readFileSync(join(__dirname, 'dist', 'portal.html'), 'utf-8')
    const configScript = `<script>window.LF_CONFIG=${JSON.stringify(CONFIG)};</script>`
    res.setHeader('Content-Type', 'text/html')
    res.send(html.replace('</head>', configScript + '</head>'))
  } catch(e) { res.status(500).send('Error: ' + e.message) }
})

// Static
app.use(express.static(join(__dirname, 'dist')))
app.get('/{*path}', (req, res) => res.sendFile(join(__dirname, 'dist', 'suite.html')))

const PORT = process.env.PORT || 10000
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`))
