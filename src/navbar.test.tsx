import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('admin navigation', () => {
  it('renders the admin dashboard link immediately after Contact', () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={['/admin']}><App /></MemoryRouter>)
    const group = html.match(/<span class="nav-contact-admin">([\s\S]*?)<\/span>/)?.[1]
    expect(group).toBeDefined()
    const links = group?.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) ?? []
    expect(links).toHaveLength(2)
    expect(links[0]).toContain('href="/contact"')
    expect(links[1]).toContain('href="/admin"')
    expect(links[1]).toContain('aria-label="Admin panel"')
    expect(links[1]).toContain('<svg')
  })
})
