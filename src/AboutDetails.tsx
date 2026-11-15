import { useState } from 'react'

type Photo = { src: string; alt: string }

const firstPhotos: Photo[] = [
  { src: '/about/photos/first/photo-01.jpg', alt: 'Shree Yash Diamond and Jewels company details' },
]

function PhotoSlot({ photo }: { photo: Photo }) {
  const [status, setStatus] = useState<'loading' | 'available' | 'missing'>('loading')
  return (
    <div className="about-photo-slot">
      <img src={photo.src} alt={photo.alt} style={{ display: status === 'available' ? 'block' : 'none' }}
        onLoad={() => setStatus('available')} onError={() => setStatus('missing')} />
      {status !== 'available' && <span className="about-photo-placeholder">
        {status === 'loading' ? 'Loading photograph…' : 'Photograph coming soon.'}
      </span>}
    </div>
  )
}

function PhotoGallery({ photos }: { photos: Photo[] }) {
  return (
    <div className={`about-photo-gallery${photos.length === 1 ? ' about-photo-gallery-single' : ''}`}>
      {photos.map((photo) => <PhotoSlot key={photo.src} photo={photo} />)}
    </div>
  )
}

export default function AboutDetails() {
  const [expanded, setExpanded] = useState(false)

  return (
    <>
      <section className="container about-extra-section" aria-labelledby="about-approval-heading">
        <div className="about-extra-heading">
          <h2 id="about-approval-heading">Govt. Approved Gold jewellery , Valuer, Assayer &amp; Hallmark</h2>
        </div>
        <PhotoGallery photos={firstPhotos} />
      </section>

      <section className="container about-extra-section" aria-label="Additional gold and jewellery valuation information">
        <div className={`about-valuation-disclosure${expanded ? ' is-open' : ''}`}>
          <button type="button" className="about-valuation-summary" aria-expanded={expanded}
            aria-controls="about-valuation-description" onClick={() => setExpanded(!expanded)}>
            <span className="about-valuation-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="m3 9 4-5h10l4 5-9 11L3 9Zm0 0h18M7 4l5 16L17 4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="about-valuation-copy">
              <span className="about-valuation-label">Gold &amp; Jewellery Valuation</span>
              <span className="about-valuation-title">Searching for Gold Valuer In Delhi NCR ???<br />We Have Shree Yash Diamonds and Jewels</span>
            </span>
            <span className="about-valuation-action" aria-hidden="true">
              <span>{expanded ? 'Close details' : 'Click to Explore'}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </button>
          <div id="about-valuation-description" className="about-valuation-panel" aria-hidden={!expanded}>
            <div className="about-valuation-panel-inner">
        <article className="about-description">
          <h2>Government-Approved Gold &amp; Jewellery Valuers in Delhi – Shree Yash Diamond and Jewels</h2>
          <p>If you are searching for trusted and government-approved Gold Valuers in Delhi, Shree Yash Diamond and Jewels—led by certified experts Mr. Subhash Kulkarni and Dr. Vaibhav Kulkarni—stands out as a premier choice for accurate, certified, and legally valid valuation reports. Gold and precious jewellery are not merely luxury assets; they represent vital financial security and generational wealth. Whether you require a valuation certificate for a gold loan, income tax filing, visa documentation, insurance coverage, or legal settlement, working with experienced, government-registered professionals ensures complete transparency and institutional acceptance.</p>

          <h2>About Shree Yash Diamond and Jewels</h2>
          <p>Shree Yash Diamond and Jewels is a Government Approved Gold Jewellery Valuer, Assayer &amp; Hallmarker, as well as a trusted wholesaler of fine gold, diamond, and silver ornaments. Recognized as a Government of India Registered Valuer for Jewellery, Gold &amp; Silver Ornaments, the firm is also appointed by Bureau of Indian Standards (BIS) Approved Hallmarking Centers as an Assaying Master.</p>
          <p>Led by seasoned appraisers Mr. Subhash Kulkarni (MSME Govt. Registered Gold Appraisal Reg. No.: 265631205) and Dr. Vaibhav Kulkarni (MSME Govt. Registered Gold Appraisal Reg. No.: 265631116; Gems &amp; Jewellery Skill Council of India Reg. No.: 9818NWNKDKO3BHTU), the firm combines deep technical proficiency with strict regulatory compliance on every assignment. (Add IBBI / Income Tax Sec. 34AB Reg. No. here, if applicable)</p>

          <h2>Standardized, Non-Destructive &amp; Transparent Valuation Process</h2>
          <p>Every assessment at Shree Yash Diamond and Jewels follows a scientific, standardized protocol to determine the exact fair market value of gold ornaments, diamond jewellery, coins, and bullion:</p>
          <ul>
            <li><strong>100% Non-Destructive Testing:</strong> Using advanced XRF (Karatmeter) and precision assaying techniques, your heirloom and antique jewellery is evaluated without any scratching, melting, or physical damage.</li>
            <li><strong>Precision Weight &amp; Purity Verification:</strong> Accurate net weight confirmation, BIS hallmark inspection, and separate grading of studded diamonds and precious gemstones (evaluating carat weight, cut, clarity, and color).</li>
            <li><strong>Live Market Rate Application:</strong> Applying the prevailing bullion and gemstone market rates at the exact time of assessment so your report reflects the true, current worth of your assets.</li>
          </ul>

          <h2>Comprehensive Valuation Services</h2>
          <ul>
            <li><strong>Visa, Immigration &amp; Foreign Travel Valuation:</strong> Embassies and consulates require certified net-worth statements for student, tourist, and permanent residency (PR) visa applications. We issue globally formatted, embassy-compliant jewellery valuation certificates.</li>
            <li><strong>Gold Loan Approvals:</strong> Banks and NBFCs require verified valuation certificates before sanctioning loans against gold. An officially recognized certificate from Shree Yash Diamond and Jewels accelerates verification and ensures smooth loan processing.</li>
            <li><strong>Income Tax, Capital Gains &amp; Wealth Reporting:</strong> During tax filings, assessments, audits, or financial scrutiny, a valuation report from a Government of India Registered Valuer serves as legally valid proof of asset value, ensuring full statutory compliance.</li>
            <li><strong>Insurance Coverage &amp; Claims:</strong> Underinsured gold and diamond jewellery can lead to significant financial loss during claim settlements. A certified valuation ensures your assets are insured at their true replacement market value.</li>
            <li><strong>Legal, Probate &amp; Family Asset Division:</strong> For inheritance cases, probate proceedings, or family settlements, Mr. Subhash Kulkarni and Dr. Vaibhav Kulkarni provide unbiased, court-accepted valuation certificates that streamline legal procedures and support fair distribution.</li>
          </ul>

          <h2>Why Choose Shree Yash Diamond and Jewels?</h2>
          <ul>
            <li><strong>Certified &amp; Government-Recognized Credentials:</strong> Backed by Government of India Registered Valuer status, BIS-approved assaying mastery, MSME registration, and Gems &amp; Jewellery Skill Council certification.</li>
            <li><strong>Same-Day Reports &amp; On-Site Visits:</strong> Fast, same-day certificate issuance at our office, along with confidential on-site valuation visits at bank lockers, residences, or legal offices across Delhi NCR for high-value consignments.</li>
            <li><strong>Detailed, Universally Accepted Documentation:</strong> Comprehensive reports featuring itemized descriptions, net/gross weights, purity verification, stone details, applied market rates, and photographs—widely accepted by banks, embassies, insurers, CAs, and courts.</li>
            <li><strong>Strict Confidentiality &amp; Integrity:</strong> Complete privacy, ethical conduct, and transparent fee structures.</li>
          </ul>

          <h2>Client Checklist: What to Bring for Valuation</h2>
          <p>To ensure a smooth and quick evaluation, please carry:</p>
          <ul>
            <li>Valid Government Photo ID (Aadhaar Card, PAN Card, or Passport) for mandatory KYC documentation.</li>
            <li>Original Purchase Invoices (helpful if available, though not mandatory for valuation).</li>
            <li>Specific Format Requirements (let us know if your bank, CA, lawyer, or visa consultant requires a specific certificate format).</li>
          </ul>

          <h2>Contact &amp; Office Details</h2>
          <p>For dependable, transparent, and government-recognized gold and jewellery valuation services in Delhi NCR, connect with Shree Yash Diamond and Jewels:</p>
          <ul>
            <li>Lead Valuers: Mr. Subhash Kulkarni &amp; Dr. Vaibhav Kulkarni</li>
            <li>Office Address: B-111, Ground Floor, Arya Samaj Road, Uttam Nagar, New Delhi – 110059</li>
            <li>Contact Numbers: +91-9810430972, +91-9711781963</li>
            <li>Email / Website: [Insert Email &amp; Website/Maps Link]</li>
            <li>Operating Hours: Every Day on Appointment</li>
            <li>GSTIN: 07GDWPK7624H1ZV</li>
          </ul>
        </article>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
