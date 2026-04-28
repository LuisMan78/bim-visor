import express from 'express'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { readFileSync } from 'fs'

const app = express()
const __dirname = dirname(fileURLToPath(import.meta.url))

// Credenciales admin — variables de entorno con fallback
const ADMIN_USER = process.env.ADMIN_USER || 'lfbim'
const ADMIN_PASS = process.env.ADMIN_PASS || 'LFBim2026!'

const CONFIG = {
  SUPABASE_URL:     process.env.SUPABASE_URL     || '',
  SUPABASE_ANON:    process.env.SUPABASE_ANON    || '',
  SUPABASE_SERVICE: process.env.SUPABASE_SERVICE || '',
  ADMIN_USER:       ADMIN_USER,
  ADMIN_PASS:       ADMIN_PASS,
}

const configScript = `<script>window.LF_CONFIG=${JSON.stringify(CONFIG)};</script>`

function servirConConfig(filePath) {
  return (req, res) => {
    try {
      const html = readFileSync(filePath, 'utf-8')
      res.setHeader('Content-Type', 'text/html')
      res.send(html.replace('</head>', configScript + '</head>'))
    } catch(e) {
      res.status(500).send('Error: ' + e.message)
    }
  }
}

// Middleware de autenticación básica para /admin
app.use('/admin', (req, res, next) => {
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="LF BIM Studio Admin"')
    return res.status(401).send('Acceso restringido')
  }
  const [user, pass] = Buffer.from(auth.slice(6), 'base64').toString().split(':')
  if (user === ADMIN_USER && pass === ADMIN_PASS) {
    next()
  } else {
    res.setHeader('WWW-Authenticate', 'Basic realm="LF BIM Studio Admin"')
    return res.status(401).send('Usuario o contraseña incorrectos')
  }
})

app.get('/', (req, res) => res.sendFile(join(__dirname, 'dist', 'suite.html')))
app.get('/visor', (req, res) => res.sendFile(join(__dirname, 'dist', 'index.html')))
app.get('/vaciados', (req, res) => res.sendFile(join(__dirname, 'dist', 'vaciados.html')))
app.get('/admin', servirConConfig(join(__dirname, 'dist', 'admin.html')))
app.get('/p/:slug', servirConConfig(join(__dirname, 'dist', 'portal.html')))

app.use(express.static(join(__dirname, 'dist')))
app.get('/{*path}', (req, res) => res.sendFile(join(__dirname, 'dist', 'suite.html')))

const PORT = process.env.PORT || 10000
app.listen(PORT, '0.0.0.0', () => console.log(`LF BIM Studio running on port ${PORT}`))
