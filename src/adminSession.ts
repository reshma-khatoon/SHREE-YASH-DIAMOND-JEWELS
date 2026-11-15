import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { adminRequest } from './adminApi'

let client: SupabaseClient | undefined
export const adminSessionStorageKey = 'shreeYashAdminAuth'
export const adminSessionClearedEvent = 'shreeYashAdminSessionCleared'

export function adminClient(): SupabaseClient {
  if (client) return client
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error('Admin login requires VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  }
  try {
    const storage = window.localStorage
    const probe = 'shreeYashAdminStorageCheck'
    storage.setItem(probe, '1')
    storage.removeItem(probe)
    client = createClient(url, key, {
      auth: {
        storage,
        storageKey: adminSessionStorageKey,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  } catch {
    throw new Error('Could not initialize admin session storage. Check your browser settings and Supabase configuration.')
  }
  return client
}

export async function signInAdmin(email: string, password: string): Promise<void> {
  const auth = adminClient().auth
  const result = await adminRequest<{ token: string; refreshToken: string }>('/login', undefined, 'POST', { email, password })
  try {
    const { data, error } = await auth.setSession({ access_token: result.token, refresh_token: result.refreshToken })
    if (error || !data.session) throw new Error('Supabase did not establish the session.')
  } catch {
    try {
      await adminRequest('/logout', result.token, 'POST')
    } catch (logoutError) {
      console.error('Could not revoke the admin session after setup failed:', logoutError)
    }
    try {
      await clearAdminSession()
    } catch (logoutError) {
      console.error('Could not clear the admin session after setup failed:', logoutError)
    }
    throw new Error('Could not save your admin session. Please try signing in again.')
  }
}

export async function clearAdminSession(): Promise<void> {
  try {
    const { error } = await adminClient().auth.signOut({ scope: 'local' })
    if (error) throw error
  } catch {
    try {
      window.localStorage.removeItem(adminSessionStorageKey)
      window.dispatchEvent(new Event(adminSessionClearedEvent))
    } catch {
      throw new Error('Could not clear the admin session on this device. Check your browser settings.')
    }
    throw new Error('The local session was cleared, but the server could not revoke it. Please check your connection.')
  }
}
