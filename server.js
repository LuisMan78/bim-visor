import express from 'express'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const app = express()
const __dirname = dirname(fileURLToPath(import.meta.url))

app.use(express.static(join(__dirname, 'dist')))

// Ruta específica para el visor
app.get('/visor', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'))
})

app.get('/{*path}', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'))
})

const PORT = process.env.PORT || 10000
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`)
})