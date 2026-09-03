import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: new URL('../.env.migrate', import.meta.url) })

// Insert order matters: parents before children (foreign keys).
const TABLES = [
  'admins',
  'quizzes',
  'questions',
  'answer_options',
  'game_sessions',
  'players',
  'player_answers',
]

const PAGE_SIZE = 1000

function requireEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing env var: ${name} (set it in server/.env.migrate)`)
  return value
}

const source = createClient(
  requireEnv('SOURCE_SUPABASE_URL'),
  requireEnv('SOURCE_SUPABASE_SECRET_KEY')
)
const target = createClient(
  requireEnv('TARGET_SUPABASE_URL'),
  requireEnv('TARGET_SUPABASE_SECRET_KEY')
)

async function migrateTable(table) {
  let from = 0
  let total = 0

  while (true) {
    const { data, error } = await source
      .from(table)
      .select('*')
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) throw new Error(`[${table}] read failed: ${error.message}`)
    if (!data || data.length === 0) break

    const { error: insertError } = await target.from(table).insert(data)
    if (insertError) throw new Error(`[${table}] insert failed: ${insertError.message}`)

    total += data.length
    from += PAGE_SIZE
    if (data.length < PAGE_SIZE) break
  }

  console.log(`${table}: migrated ${total} rows`)
}

for (const table of TABLES) {
  await migrateTable(table)
}

console.log('Migration complete.')
