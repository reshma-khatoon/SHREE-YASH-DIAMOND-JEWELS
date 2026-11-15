import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { useAdminSession } from './AdminPage'
import { useAdminCounts } from './useAdminCounts'

vi.mock('./AdminPage', async (importOriginal) => ({
  ...await importOriginal<typeof import('./AdminPage')>(),
  useAdminSession: vi.fn(),
}))
vi.mock('./useAdminCounts', () => ({ useAdminCounts: vi.fn() }))

function renderNavbar() {
  return renderToStaticMarkup(<MemoryRouter initialEntries={['/admin']}><App /></MemoryRouter>)
}

describe('admin navigation', () => {
  beforeEach(() => {
    vi.mocked(useAdminSession).mockReturnValue({ token: '', loading: false, error: '' })
    vi.mocked(useAdminCounts).mockReturnValue({ counts: null, error: '', refresh: vi.fn() })
  })

  it('renders the admin dashboard link immediately after Contact', () => {
    const html = renderNavbar()
    const group = html.match(/<span class="nav-contact-admin">([\s\S]*?)<\/span>/)?.[1]
    expect(group).toBeDefined()
    const links = group?.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) ?? []
    expect(links).toHaveLength(2)
    expect(links[0]).toContain('href="/contact"')
    expect(links[1]).toContain('href="/admin"')
    expect(links[1]).toContain('aria-label="Admin panel"')
    expect(links[1]).toContain('<svg')
  })

  it('shows the combined unread count for a signed-in admin', () => {
    vi.mocked(useAdminSession).mockReturnValue({ token: 'test-token', loading: false, error: '' })
    vi.mocked(useAdminCounts).mockReturnValue({
      counts: { inquiries: { total: 3, new: 3 }, orders: { total: 2, new: 2 }, cartLeads: { total: 4, new: 4 } },
      error: '', refresh: vi.fn(),
    })
    const html = renderNavbar()
    expect(html).toContain('aria-label="Admin panel, 9 new records"')
    expect(html).toContain('class="admin-notification-badge" aria-hidden="true">9</span>')
  })

  it('hides the badge for visitors, zero counts, and count errors', () => {
    const counts = { inquiries: { total: 3, new: 3 }, orders: { total: 2, new: 2 }, cartLeads: { total: 1, new: 1 } }
    vi.mocked(useAdminCounts).mockReturnValue({ counts, error: '', refresh: vi.fn() })
    expect(renderNavbar()).not.toContain('admin-notification-badge')
    vi.mocked(useAdminSession).mockReturnValue({ token: 'test-token', loading: false, error: '' })
    vi.mocked(useAdminCounts).mockReturnValue({ counts, error: 'API unavailable', refresh: vi.fn() })
    const errorHtml = renderNavbar()
    expect(errorHtml).not.toContain('admin-notification-badge')
    expect(errorHtml).toContain('aria-label="Admin panel, notification count unavailable"')
    vi.mocked(useAdminCounts).mockReturnValue({
      counts: { inquiries: { total: 3, new: 0 }, orders: { total: 2, new: 0 }, cartLeads: { total: 1, new: 0 } },
      error: '', refresh: vi.fn(),
    })
    expect(renderNavbar()).not.toContain('admin-notification-badge')
  })
})
