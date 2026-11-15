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

function renderPage(path: string) {
  return renderToStaticMarkup(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
}

describe('About page', () => {
  beforeEach(() => {
    vi.mocked(useAdminSession).mockReturnValue({ token: '', loading: false, error: '' })
    vi.mocked(useAdminCounts).mockReturnValue({ counts: null, error: '', refresh: vi.fn() })
  })

  it('keeps the existing Home preview separate and links About Us to the journey page', () => {
    const html = renderPage('/')
    expect(html).toContain('href="/journey"')
    expect(html).toContain('The Story Behind Shree Yash')
    expect(html).not.toContain('The Certificate of Gold Appraisal')
    expect(html).not.toContain('Government-Approved Gold &amp; Jewellery Valuers in Delhi')
  })

  it('preserves the journey introduction and presents the requested sections in order', () => {
    const html = renderPage('/journey')
    const original = html.indexOf('The Journey Behind Shree Yash')
    const approval = html.indexOf('Govt. Approved Gold jewellery , Valuer, Assayer &amp; Hallmark')
    const disclosure = html.indexOf('Searching for Gold Valuer In Delhi NCR ???')
    const description = html.indexOf('Government-Approved Gold &amp; Jewellery Valuers in Delhi')
    expect(original).toBeGreaterThan(-1)
    expect(approval).toBeGreaterThan(original)
    expect(disclosure).toBeGreaterThan(approval)
    expect(description).toBeGreaterThan(disclosure)
    expect(html).not.toContain('Gold is not just a precious asset')
    expect(html).toContain('From bridal moments to everyday expressions of love, our journey is defined by craftsmanship')
    expect(html).toContain('(Add IBBI / Income Tax Sec. 34AB Reg. No. here, if applicable)')
    expect(html).toContain('[Insert Email &amp; Website/Maps Link]')
    expect(html).toContain('265631205')
    expect(html).toContain('265631116')
    expect(html).toContain('9818NWNKDKO3BHTU')
    expect(html).toContain('07GDWPK7624H1ZV')
  })

  it('omits the certificate section while retaining the approval image', () => {
    const html = renderPage('/journey')
    expect(html).not.toContain('The Certificate of Gold Appraisal')
    expect(html).not.toContain('View Certificate')
    expect(html).not.toContain('/about/documents/')
    expect(html).not.toContain('about-document-card')
    expect(html).toContain('class="about-photo-gallery about-photo-gallery-single"')
    expect(html).toContain('/about/photos/first/photo-01.jpg')
    expect(html).not.toContain('/about/photos/first/photo-02.jpg')
    expect(html).not.toContain('/about/photos/first/photo-03.jpg')
    expect(html).not.toContain('More Photographs')
    expect(html).not.toContain('/about/photos/second/')
  })

  it('places the complete description in a closed accordion with the requested text', () => {
    const html = renderPage('/journey')
    expect(html).toContain('aria-expanded="false" aria-controls="about-valuation-description"')
    expect(html).toContain('id="about-valuation-description" class="about-valuation-panel" aria-hidden="true"')
    expect(html).toContain('Click to Explore')
    expect(html).toContain('Searching for Gold Valuer In Delhi NCR ???<br/>We Have Shree Yash Diamonds and Jewels')
    expect(html.match(/<article class="about-description">/g)).toHaveLength(1)
    expect(html).toContain('Government-Approved Gold &amp; Jewellery Valuers in Delhi')
    expect(html).toContain('[Insert Email &amp; Website/Maps Link]')
  })
})
