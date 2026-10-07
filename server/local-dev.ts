import 'dotenv/config'
import { createApp } from './app'

const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3001)
const app = createApp()

app.listen(port, '0.0.0.0', () => {
  process.stdout.write(`Jewellery contact/order API listening on port ${port}\n`)
})
