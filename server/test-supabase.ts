import 'dotenv/config'
import { supabase } from './supabase'

async function testSupabase() {
  const { error } = await supabase
    .from('orders')
    .select('id')
    .limit(1)

  if (error) {
    console.error('Supabase connection test failed:', error.message)
    process.exitCode = 1
    return
  }

  console.log('Supabase connection successful!')
}

testSupabase()