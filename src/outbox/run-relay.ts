import { Pool } from 'pg'
import { relayOnce } from './relay.js'

const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? process.env.DB_URL })
relayOnce(pool, process.env.BROKER_URL ?? 'http://127.0.0.1:18765')
  .then(n => console.log(`published=${n}`))
  .catch(error => { console.error(error); process.exitCode = 1 })
  .finally(async () => pool.end())
