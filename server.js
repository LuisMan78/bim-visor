import express from 'express'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { readFileSync } from 'fs'

const app = express()
const __dirname = dirname(fileURLToPath(import.meta.url))

const CONFIG = {
  SUPABASE_URL:     process.env.SUPABASE_URL     || '',
  SUPABASE_ANON:    process.env.SUPABASE_ANON    || '',
  SUPABASE_SERVICE: process.env.SUPABASE_SERVICE || '',
  ADMIN_USER:       process.env.ADMIN_USER        || 'lfbim',
  ADMIN_PASS:       process.env.ADMIN_PASS        || '',
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

app.get('/', (req, res) => res.sendFile(join(__dirname, 'dist', 'suite.html')))
app.get('/visor', (req, res) => res.sendFile(join(__dirname, 'dist', 'index.html')))
app.get('/vaciados', (req, res) => res.sendFile(join(__dirname, 'dist', 'vaciados.html')))
app.get('/admin', servirConConfig(join(__dirname, 'dist', 'admin.html')))
app.get('/p/:slug', servirConConfig(join(__dirname, 'dist', 'portal.html')))

app.use(express.static(join(__dirname, 'dist')))
app.get('/{*path}', (req, res) => res.sendFile(join(__dirname, 'dist', 'suite.html')))

const PORT = process.env.PORT || 10000
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`))
