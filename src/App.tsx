import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { categories, diamondsFeatures, faqs, festiveGifts, navItems, products, socialImages, testimonials, trustFeatures, type GoldPurity, type Product } from './data'

type CartItem = Product & { quantity: number; selectedPurity: GoldPurity }
type AddToCart = (product: Product, purity: GoldPurity, quantity?: number) => void

const fallbackJewelleryImage = 'https://images.unsplash.com/photo-1611652022419-a9419f74343d?auto=format&fit=crop&w=1200&q=80'
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? ''

async function postApi<T>(path: string, payload: unknown, requestKey?: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(requestKey ? { 'Idempotency-Key': requestKey } : {}),
    },
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new Error('request_failed')
  return response.json() as Promise<T>
}

function getIdempotencyKey(storageKey: string) {
  const keyName = `shreeYashIdempotency:${storageKey}`
  const existing = window.sessionStorage.getItem(keyName)
  if (existing) return existing
  const key = crypto.randomUUID()
  window.sessionStorage.setItem(keyName, key)
  return key
}

function clearIdempotencyKey(storageKey: string) {
  window.sessionStorage.removeItem(`shreeYashIdempotency:${storageKey}`)
}

function ScrollToTop() {
  const { pathname } = useLocation()

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })
  }, [pathname])

  return null
}

function SafeImage({ src, alt, className, ...props }: { src?: string; alt: string; className?: string; [key: string]: any }) {
  return (
    <img
      {...props}
      src={src || fallbackJewelleryImage}
      alt={alt}
      className={className}
      onError={(event) => {
        const target = event.currentTarget
        const failedSrc = target.currentSrc || target.src
        console.warn('[SafeImage] Missing image path:', failedSrc)
        if (target.src !== fallbackJewelleryImage) {
          target.onerror = null
          target.src = fallbackJewelleryImage
        }
      }}
    />
  )
}

const readStorage = <T,>(key: string, fallback: T): T => {
  if (typeof window === 'undefined') return fallback

  try {
    const saved = window.localStorage.getItem(key)
    return saved ? JSON.parse(saved) as T : fallback
  } catch {
    return fallback
  }
}

const writeStorage = (key: string, value: unknown) => {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Ignore storage quota/privacy errors so the shopping experience still works.
  }
}

const getInitialCart = (): CartItem[] => readStorage<Array<CartItem & { selectedPurity?: GoldPurity }>>('shreeYashCart', [])
  .flatMap((savedItem) => {
    const product = products.find((item) => item.id === savedItem.id)
    if (!product || savedItem.quantity < 1) return []
    const selectedPurity = product.availablePurities?.includes(savedItem.selectedPurity as GoldPurity)
      ? savedItem.selectedPurity as GoldPurity
      : product.defaultPurity ?? product.availablePurities?.[0]
    return selectedPurity ? [{ ...product, selectedPurity, quantity: savedItem.quantity }] : []
  })

const getInitialWishlist = (): string[] => readStorage<string[]>('shreeYashWishlist', [])
const getInitialWishlistPurities = (): Record<string, GoldPurity> => readStorage<Record<string, GoldPurity>>('shreeYashWishlistPurities', {})

function App() {
  const location = useLocation()
  const [cart, setCart] = useState<CartItem[]>(getInitialCart)
  const [wishlist, setWishlist] = useState<string[]>(getInitialWishlist)
  const [wishlistPurities, setWishlistPurities] = useState<Record<string, GoldPurity>>(getInitialWishlistPurities)
  const [cartOpen, setCartOpen] = useState(false)

  useEffect(() => {
    writeStorage('shreeYashCart', cart)
  }, [cart])

  useEffect(() => {
    writeStorage('shreeYashWishlist', wishlist)
  }, [wishlist])

  useEffect(() => {
    writeStorage('shreeYashWishlistPurities', wishlistPurities)
  }, [wishlistPurities])

  useEffect(() => {
    try {
      const storageKey = 'shreeYashVisitorSessionId'
      let sessionId = window.sessionStorage.getItem(storageKey)
      if (!sessionId) {
        sessionId = crypto.randomUUID()
        window.sessionStorage.setItem(storageKey, sessionId)
      }
      void postApi('/api/visitors', {
        sessionId,
        page: location.pathname,
        device: navigator.userAgent.slice(0, 300),
        referrer: document.referrer,
      }).catch(() => undefined)
    } catch {
      // Visitor tracking must never block site navigation.
    }
  }, [location.pathname])

  const addToCart: AddToCart = (product, selectedPurity, quantity = 1) => {
    setCart((current: CartItem[]) => {
      const existing = current.find((item: CartItem) => item.id === product.id && item.selectedPurity === selectedPurity)
      if (existing) {
        return current.map((item: CartItem) =>
          item.id === product.id && item.selectedPurity === selectedPurity ? { ...item, quantity: item.quantity + quantity } : item,
        )
      }
      return [...current, { ...product, selectedPurity, quantity }]
    })
    setCartOpen(true)
  }

  const updateCartItem = (id: string, purity: GoldPurity, change: number) => {
    setCart((current: CartItem[]) =>
      current
        .map((item: CartItem) =>
          item.id === id && item.selectedPurity === purity ? { ...item, quantity: Math.max(0, item.quantity + change) } : item,
        )
        .filter((item: CartItem) => item.quantity > 0),
    )
  }

  const removeFromCart = (id: string, purity: GoldPurity) => {
    setCart((current: CartItem[]) => current.filter((item: CartItem) => item.id !== id || item.selectedPurity !== purity))
  }

  const toggleWishlist = (id: string, purity?: GoldPurity) => {
    const isSaved = wishlist.includes(id)
    setWishlist((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
    setWishlistPurities((current) => {
      if (isSaved) {
        const next = { ...current }
        delete next[id]
        return next
      }
      return purity ? { ...current, [id]: purity } : current
    })
  }

  const updateWishlistPurity = (id: string, purity: GoldPurity) => {
    setWishlistPurities((current) => ({ ...current, [id]: purity }))
  }

  const rootPath = location.pathname

  return (
    <>
      <ScrollToTop />
      <Header
        cartCount={cart.reduce((sum: number, item: CartItem) => sum + item.quantity, 0)}
        wishlistCount={wishlist.length}
        onCartClick={() => setCartOpen(true)}
      />
      <main className="app-shell">
        <Routes>
          <Route path="/" element={<HomePage toggleWishlist={toggleWishlist} wishlist={wishlist} />} />
          <Route path="/shop/:categoryName" element={<ShopPage toggleWishlist={toggleWishlist} wishlist={wishlist} />} />
          <Route path="/shop" element={<ShopPage toggleWishlist={toggleWishlist} wishlist={wishlist} />} />
          <Route path="/category/:categoryName" element={<ShopPage toggleWishlist={toggleWishlist} wishlist={wishlist} />} />
          <Route path="/category" element={<ShopPage toggleWishlist={toggleWishlist} wishlist={wishlist} />} />
          <Route path="/wishlist" element={<WishlistPage toggleWishlist={toggleWishlist} wishlist={wishlist} />} />
          <Route path="/journey" element={<JourneyPage />} />
          <Route path="/product/:productId" element={<ProductDetailPage addToCart={addToCart} toggleWishlist={toggleWishlist} wishlist={wishlist} wishlistPurities={wishlistPurities} updateWishlistPurity={updateWishlistPurity} />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/checkout" element={<CheckoutPage cart={cart} updateCartItem={updateCartItem} onOrderPlaced={() => { setCart([]); setCartOpen(false) }} />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
      <Footer />
      <CartDrawer
        open={cartOpen}
        cart={cart}
        onClose={() => setCartOpen(false)}
        removeFromCart={removeFromCart}
        updateCartItem={updateCartItem}
      />
      {rootPath !== '/checkout' && (
        <a
          className="whatsapp-button"
          href="https://wa.me/919711781963"
          target="_blank"
          rel="noreferrer"
          aria-label="Chat on WhatsApp"
        >
          WhatsApp
        </a>
      )}
    </>
  )
}

function Header({ cartCount, onCartClick, wishlistCount }: { cartCount: number; onCartClick: () => void; wishlistCount: number }) {
  const [scrolled, setScrolled] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header className={`site-header ${scrolled ? 'scrolled' : ''}`}>
      <div className="announcement-bar">
        <span>Complimentary Shipping Across India • Personalised Jewellery Consultation Available</span>
      </div>
      <div className="header-inner container">
        <button className="nav-toggle" type="button" aria-label="Open menu">☰</button>
        <div className="brand-block">
          <Link
            to="/"
            className="brand-mark"
            aria-label="Shree Yash home"
            onClick={() => window.scrollTo({ top: 0, left: 0, behavior: 'smooth' })}
          >
            <span>SHREE YASH</span>
            <small>DIAMOND &amp; JEWELS</small>
          </Link>
        </div>
        <nav className="main-nav" aria-label="Main navigation">
          {navItems.map((item) => {
            const to = item === 'Home' ? '/' : item === 'Shop' ? '/shop' : item === 'About Us' ? '/journey' : '/contact'
            return (
              <NavLink key={item} to={to} className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
                {item}
              </NavLink>
            )
          })}
        </nav>
        <div className="header-actions">
          <button
            type="button"
            aria-label="Search"
            className="icon-link search-link"
            title="Search"
            onClick={() => navigate('/shop?search=')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <path d="M16.2 16.2L20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
          <a
            href="https://www.instagram.com/shreeyashdiamond/"
            target="_blank"
            rel="noreferrer"
            aria-label="Instagram account"
            className="icon-link account-link"
            title="Instagram"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="none" stroke="currentColor" strokeWidth="1.7" />
              <circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
              <circle cx="17.2" cy="6.8" r="1.2" fill="currentColor" />
            </svg>
          </a>
          <button type="button" aria-label="Wishlist" className="header-icon-button" onClick={() => navigate('/wishlist')}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 20.6l-1.7-1.5C5.3 14.7 2 11.8 2 8.2A4.3 4.3 0 0 1 6.3 4a4.7 4.7 0 0 1 3.6 1.6L12 7.2l2.1-1.6A4.7 4.7 0 0 1 17.7 4 4.3 4.3 0 0 1 22 8.2c0 3.6-3.3 6.5-8.3 10.9L12 20.6z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            </svg>
            <span>{wishlistCount}</span>
          </button>
          <button type="button" aria-label="Cart" className="header-icon-button cart-pill" onClick={onCartClick}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="9" cy="18.5" r="1.5" fill="currentColor" />
              <circle cx="17" cy="18.5" r="1.5" fill="currentColor" />
              <path d="M3.5 5.5h2l2.1 8.2a1 1 0 0 0 1 .8h8.8a1 1 0 0 0 1-.8L20 7.5H7.1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>{cartCount}</span>
          </button>
        </div>
      </div>
    </header>
  )
}

function Hero() {
  return (
    <section className="hero-section">
      <div className="hero-visual">
        <div className="hero-content">
          <p className="eyebrow">Fine Jewellery</p>
          <h1>Timeless Elegance,<br />Crafted to Cherish</h1>
          <p className="hero-copy">
            Discover exquisite diamond and fine jewellery designed to celebrate your most beautiful moments.
          </p>
          <div className="cta-row">
            <Link to="/shop" className="primary-button">SHOP COLLECTION</Link>
            <Link to="/shop" className="secondary-button">EXPLORE BRIDAL</Link>
          </div>
        </div>
      </div>
    </section>
  )
}

function CategorySection() {
  return (
    <section className="section-block container">
      <div className="section-heading">
        <p className="eyebrow">Collection</p>
        <h2>Shop By Category</h2>
        <p className="section-subtitle">Discover pieces designed for every celebration, every occasion, and every version of you.</p>
      </div>
      <div className="category-grid">
        {categories.map((category) => (
          <Link
            key={category.name}
            to={`/shop/${encodeURIComponent(category.name)}`}
            className="category-card"
            aria-label={category.alt}
            title={`Browse ${category.name}`}
          >
            <SafeImage src={category.image} alt={category.alt} loading="lazy" />
            <div className="category-label">
              <span>{category.name}</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}

function ProductCarousel({ wishlist, toggleWishlist }: { wishlist: string[]; toggleWishlist: (id: string, purity?: GoldPurity) => void }) {
  const newArrivals = products.filter((product) => product.newArrival)

  return (
    <section className="section-block container">
      <div className="section-heading split">
        <div>
          <p className="eyebrow">Latest</p>
          <h2>New Arrivals</h2>
        </div>
        <p className="section-subtitle">Meet the newest expressions of timeless elegance.</p>
      </div>
      <div className="product-carousel" aria-label="New arrivals products">
        {newArrivals.map((product) => (
          <ProductCard key={product.id} product={product} wishlist={wishlist} toggleWishlist={toggleWishlist} />
        ))}
      </div>
    </section>
  )
}

function GoldPuritySelector({ product, value, onChange, compact = false }: { product: Product; value: GoldPurity | ''; onChange: (purity: GoldPurity) => void; compact?: boolean }) {
  const purities: GoldPurity[] = ['14K', '18K', '22K']
  const availablePurities = product.availablePurities ?? []

  return (
    <div className={`purity-selector ${compact ? 'compact' : ''}`}>
      {!compact && <span className="purity-label">Select Gold Purity</span>}
      <div className="purity-options" role="group" aria-label={`Gold purity for ${product.name}`}>
        {purities.map((purity) => {
          const available = availablePurities.includes(purity)
          return (
            <button
              key={purity}
              type="button"
              className={value === purity ? 'selected' : ''}
              aria-pressed={value === purity}
              disabled={!available}
              title={!available ? `${purity} is not available for ${product.name}` : `${purity} Gold`}
              onClick={() => onChange(purity)}
            >
              {purity}{value === purity ? ' ✓' : ''}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ProductCard({ product, wishlist, toggleWishlist }: { product: Product; wishlist: string[]; toggleWishlist: (id: string, purity?: GoldPurity) => void }) {
  return (
    <article className="product-card">
      <div className="product-image-wrap">
        <Link to={`/product/${product.id}`}>
          <SafeImage src={product.image} alt={product.alt} loading="lazy" />
        </Link>
        <button type="button" className="wishlist-button" onClick={() => toggleWishlist(product.id)} aria-label={`Add ${product.name} to wishlist`}>
          {wishlist.includes(product.id) ? '♥' : '♡'}
        </button>
        <Link
          to={`/product/${product.id}`}
          className="quick-view"
          aria-label={`Quick view ${product.name}`}
          onClick={(event) => event.stopPropagation()}
        >
          Quick View
        </Link>
      </div>
      <div className="product-body">
        <div className="product-meta">
          <span>{product.category}</span>
        </div>
        <h3><Link to={`/product/${product.id}`}>{product.name}</Link></h3>
        <div className="price-row">
          <strong>Price on Request</strong>
        </div>
        <div className="product-card-actions">
          <Link to={`/product/${product.id}`} className="secondary-button small-btn">View Details</Link>
          <Link to={`/product/${product.id}`} className="primary-button small-btn">Add to Cart</Link>
        </div>
      </div>
    </article>
  )
}

function JourneyPage() {
  return (
    <section className="about-section section-block container">
      <div className="about-image-wrap">
        <SafeImage src="/j.jpg" alt="Jewellery craftsmanship and premium styling for Shree Yash Diamond and Jewels" />
      </div>
      <div className="about-copy">
        <p className="eyebrow">Our story</p>
        <h2>The Journey Behind Shree Yash</h2>
        <p>
          Shree Yash Diamond and Jewels brings together contemporary elegance and jewellery crafted for meaningful milestones. Every piece is shaped with a thoughtful design philosophy rooted in refined artistry, warm personal service, and a desire to create heirlooms that feel intimate and enduring.
        </p>
        <p>
          Our focus is on creating jewellery that feels personal, luxurious, and beautifully considered — whether for weddings, gifting, or everyday joy.
        </p>
        <p>
          From bridal moments to everyday expressions of love, our journey is defined by craftsmanship, trust, and a celebration of the stories our customers carry with them.
        </p>
      </div>
    </section>
  )
}

function HomePage({ wishlist, toggleWishlist }: { wishlist: string[]; toggleWishlist: (id: string, purity?: GoldPurity) => void }) {
  const bestsellers = products.filter((product) => product.bestseller)

  return (
    <>
      <Hero />
      <CategorySection />
      <ProductCarousel wishlist={wishlist} toggleWishlist={toggleWishlist} />
      <section className="feature-banner container">
        <div className="feature-banner-copy">
          <p className="eyebrow">The Shree Yash Collection</p>
          <h2>Where timeless craftsmanship meets contemporary elegance.</h2>
          <Link to="/shop" className="primary-button">EXPLORE COLLECTION</Link>
        </div>
      </section>
      <section className="section-block container">
        <div className="section-heading split">
          <div>
            <p className="eyebrow">Most loved</p>
            <h2>Most Loved</h2>
          </div>
          <p className="section-subtitle">Designed to keep their sparkle close.</p>
        </div>
        <div className="product-grid compact-grid">
          {bestsellers.map((product) => (
            <ProductCard key={product.id} product={product} wishlist={wishlist} toggleWishlist={toggleWishlist} />
          ))}
        </div>
      </section>
      <section className="bridal-section">
        <div className="container bridal-inner">
          <div className="bridal-copy">
            <p className="eyebrow">Bridal curation</p>
            <h2>For Your Forever</h2>
            <p>From the first celebration to the forever after, discover jewellery created for unforgettable moments.</p>
            <Link to="/shop" className="primary-button">EXPLORE BRIDAL</Link>
          </div>
          <div className="bridal-tiles">
            <div className="bridal-tile large" style={{ backgroundImage: "linear-gradient(180deg, rgba(27, 20, 18, 0.15), rgba(27, 20, 18, 0.6)), url('/bn.jpg')" }}><span>Necklaces</span></div>
            <div className="bridal-tile" style={{ backgroundImage: "linear-gradient(180deg, rgba(27, 20, 18, 0.15), rgba(27, 20, 18, 0.6)), url('/be.jpg')" }}><span>Earrings</span></div>
            <div className="bridal-tile" style={{ backgroundImage: "linear-gradient(180deg, rgba(27, 20, 18, 0.15), rgba(27, 20, 18, 0.6)), url('/bb.webp')" }}><span>Bangles</span></div>
            <div className="bridal-tile ring-tile" style={{ backgroundImage: "linear-gradient(180deg, rgba(27, 20, 18, 0.15), rgba(27, 20, 18, 0.6)), url('/br.webp')" }}><span>Rings</span></div>
          </div>
        </div>
      </section>
      <section className="section-block container">
        <div className="section-heading center">
          <p className="eyebrow">Our promise</p>
          <h2>Diamonds, Made to Last Beyond Moments</h2>
        </div>
        <div className="feature-grid">
          {diamondsFeatures.map((item) => (
            <article key={item.title} className="feature-card">
              <div className="feature-icon">{item.icon}</div>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="section-block container">
        <div className="section-heading split">
          <div>
            <p className="eyebrow">Gift ideas</p>
            <h2>Gift Something Unforgettable</h2>
          </div>
          <p className="section-subtitle">Celebrate the people and moments that deserve a little more sparkle.</p>
        </div>
        <div className="gift-grid">
          {festiveGifts.map((gift) => (
            <article key={gift.title} className="gift-card">
              <SafeImage src={gift.image} alt={`${gift.title} jewellery gift showing Shree Yash Diamond and Jewels`} loading="lazy" />
              <div className="gift-card-copy">
                <h3>{gift.title}</h3>
                <Link to="/shop">SHOP GIFTS</Link>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="consultation-banner">
        <div className="container consultation-inner">
          <div>
            <p className="eyebrow">Made especially for you</p>
            <h2>Made Especially For You</h2>
            <p>Have something special in mind? Work with our team to create a piece that reflects your story.</p>
          </div>
          <div className="consultation-actions">
            <Link to="/contact" className="primary-button">START A CONSULTATION</Link>
            <Link to="/contact" className="secondary-button light">DESIGN YOUR JEWELLERY</Link>
          </div>
        </div>
      </section>
      <section className="section-block container">
        <div className="section-heading center">
          <p className="eyebrow">Experience</p>
          <h2>Crafted With Care</h2>
        </div>
        <div className="trust-grid">
          {trustFeatures.map((item) => (
            <article key={item.title} className="trust-card">
              <h3>{item.title}</h3>
              <p>{item.description}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="section-block container">
        <div className="section-heading center">
          <p className="eyebrow">Reflections</p>
          <h2>Stories That Sparkle</h2>
        </div>
        <div className="testimonial-grid">
          {testimonials.map((item) => (
            <article key={item.id} className="testimonial-card">
              <div className="stars">{'★'.repeat(item.rating)}</div>
              <p>“{item.review}”</p>
              <div className="testimonial-footer">
                <strong>{item.customerName}</strong>
                <span>{item.location}</span>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="section-block container">
        <div className="section-heading split">
          <div>
            <p className="eyebrow">Inspiration</p>
            <h2>Follow The Sparkle</h2>
          </div>
          <Link to="/contact" className="secondary-button">FOLLOW US</Link>
        </div>
        <div className="social-grid">
          {socialImages.map((image, index) => (
            <SafeImage key={image + index} src={image} alt="Luxury jewellery styling from Shree Yash Diamond and Jewels" loading="lazy" />
          ))}
        </div>
      </section>
      <section className="about-section section-block container">
        <div className="about-image-wrap">
          <SafeImage src="/j.jpg" alt="Jewellery craftsmanship and premium styling for Shree Yash Diamond and Jewels" />
        </div>
        <div className="about-copy">
          <p className="eyebrow">Our story</p>
          <h2>The Story Behind Shree Yash</h2>
          <p>
            Shree Yash Diamond and Jewels brings together contemporary elegance and jewellery crafted for meaningful milestones. Every piece is shaped with a thoughtful design philosophy rooted in refined artistry, warm personal service, and a desire to create heirlooms that feel intimate and enduring.
          </p>
          <p>
            Our focus is on creating jewellery that feels personal, luxurious, and beautifully considered — whether for weddings, gifting, or everyday joy.
          </p>
        </div>
      </section>
      <section className="faq-section section-block container">
        <div className="section-heading center">
          <p className="eyebrow">FAQ</p>
          <h2>Common Questions</h2>
        </div>
        <FaqList />
      </section>
    </>
  )
}

function FaqList() {
  const [openIndex, setOpenIndex] = useState<number | null>(0)

  return (
    <div className="faq-list">
      {faqs.map((faq, index) => (
        <div key={faq.question} className={`faq-item ${openIndex === index ? 'open' : ''}`}>
          <button type="button" onClick={() => setOpenIndex(openIndex === index ? null : index)}>
            <span>{faq.question}</span>
            <span>{openIndex === index ? '−' : '+'}</span>
          </button>
          {openIndex === index && <p>{faq.answer}</p>}
        </div>
      ))}
    </div>
  )
}

function ShopPage({ wishlist, toggleWishlist }: { wishlist: string[]; toggleWishlist: (id: string, purity?: GoldPurity) => void }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { categoryName } = useParams()
  const [query, setQuery] = useState(() => new URLSearchParams(location.search).get('search') ?? '')
  const [category, setCategory] = useState(() => (categoryName ? decodeURIComponent(categoryName) : 'All'))
  const [sort, setSort] = useState('featured')

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const activeCategory = categoryName ? decodeURIComponent(categoryName) : params.get('category') ?? 'All'
    setQuery(params.get('search') ?? '')
    setCategory(activeCategory)
  }, [categoryName, location.search])

  const handleCategoryChange = (nextCategory: string) => {
    const trimmedSearch = query.trim()
    const searchSuffix = trimmedSearch ? `?search=${encodeURIComponent(trimmedSearch)}` : ''
    const nextPath = nextCategory === 'All' ? `/shop${searchSuffix}` : `/shop/${encodeURIComponent(nextCategory)}${searchSuffix}`
    setCategory(nextCategory)
    navigate(nextPath)
  }

  const filteredProducts = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    let results = products.filter((product) => {
      const matchesQuery =
        !normalized ||
        product.name.toLowerCase().includes(normalized) ||
        product.category.toLowerCase().includes(normalized) ||
        product.collection.toLowerCase().includes(normalized) ||
        product.description.toLowerCase().includes(normalized) ||
        product.tag.toLowerCase().includes(normalized)

      const matchesCategory = category === 'All' || product.category === category
      return matchesQuery && matchesCategory
    })

    if (sort === 'name') results = [...results].sort((a, b) => a.name.localeCompare(b.name))

    return results
  }, [query, category, sort])

  const suggestions = useMemo(() => {
    const searchTerm = query.trim().toLowerCase()
    if (!searchTerm) return []
    return products
      .filter(
        (product) =>
          product.name.toLowerCase().includes(searchTerm) ||
          product.category.toLowerCase().includes(searchTerm) ||
          product.collection.toLowerCase().includes(searchTerm),
      )
      .slice(0, 5)
      .map((product) => product.name)
  }, [query])

  const selectedCategoryLabel = category === 'All' ? 'All Jewellery' : category

  return (
    <section className="container section-block">
      <div className="shop-header-row">
        <div className="page-heading">
          <p className="eyebrow">Collection</p>
          <h1>{selectedCategoryLabel}</h1>
        </div>
        <div className="page-actions">
          <Link className="secondary-button" to="/shop">View All Jewellery</Link>
          {category !== 'All' && <Link className="secondary-button" to="/shop">Back to Categories</Link>}
        </div>
      </div>

      <div className="category-selector" aria-label="Browse categories">
        {['All', ...categories.map((item) => item.name)].map((item) => (
          <button
            key={item}
            type="button"
            className={item === category ? 'active' : ''}
            onClick={() => handleCategoryChange(item)}
            aria-pressed={item === category}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="shop-toolbar">
        <div className="search-wrap">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search products, categories, collections..."
            aria-label="Search products"
          />
          {suggestions.length > 0 && (
            <div className="search-suggestions" role="listbox">
              {suggestions.map((suggestion) => (
                <button type="button" key={suggestion} onClick={() => setQuery(suggestion)}>
                  {suggestion}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="filter-row">
          <select value={category} onChange={(event) => handleCategoryChange(event.target.value)} aria-label="Filter by category">
            <option value="All">All categories</option>
            {categories.map((item) => (
              <option key={item.name} value={item.name}>{item.name}</option>
            ))}
          </select>
          <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort products">
            <option value="featured">Featured</option>
            <option value="name">Name</option>
          </select>
        </div>
      </div>

      {filteredProducts.length === 0 ? (
        <div className="empty-state">
          <h3>No products found in {selectedCategoryLabel}</h3>
          <p>Try a different search or browse another jewellery category to discover more pieces.</p>
        </div>
      ) : (
        <div className="product-grid shop-grid">
          {filteredProducts.map((product) => (
            <ProductCard key={product.id} product={product} wishlist={wishlist} toggleWishlist={toggleWishlist} />
          ))}
        </div>
      )}
    </section>
  )
}

function WishlistPage({ wishlist, toggleWishlist }: { wishlist: string[]; toggleWishlist: (id: string, purity?: GoldPurity) => void }) {
  const savedProducts = products.filter((product) => wishlist.includes(product.id))

  return (
    <section className="container section-block">
      <div className="page-heading">
        <p className="eyebrow">Saved items</p>
        <h1>Wishlist</h1>
      </div>

      {savedProducts.length === 0 ? (
        <div className="empty-state">
          <h3>Your wishlist is empty</h3>
          <p>Tap the heart icon on any product to save it here.</p>
        </div>
      ) : (
        <div className="product-grid shop-grid">
          {savedProducts.map((product) => (
            <ProductCard key={product.id} product={product} wishlist={wishlist} toggleWishlist={toggleWishlist} />
          ))}
        </div>
      )}
    </section>
  )
}

function ProductDetailPage({ addToCart, wishlist, toggleWishlist, wishlistPurities, updateWishlistPurity }: { addToCart: AddToCart; wishlist: string[]; toggleWishlist: (id: string, purity?: GoldPurity) => void; wishlistPurities: Record<string, GoldPurity>; updateWishlistPurity: (id: string, purity: GoldPurity) => void }) {
  const { productId } = useParams()
  const product = products.find((item) => item.id === productId) ?? products[0]
  const [quantity, setQuantity] = useState(1)
  const [selectedSize, setSelectedSize] = useState(product.sizes?.[0] ?? '')
  const [selectedPurity, setSelectedPurity] = useState<GoldPurity | ''>(wishlistPurities[product.id] ?? product.defaultPurity ?? '')
  const [priceInquiryOpen, setPriceInquiryOpen] = useState(false)

  useEffect(() => {
    setQuantity(1)
    setSelectedSize(product.sizes?.[0] ?? '')
    setSelectedPurity(wishlistPurities[product.id] ?? product.defaultPurity ?? '')
  }, [product.id, product.sizes, product.defaultPurity, wishlistPurities])

  const whatsappMessage = `Hello Shree Yash Diamond & Jewels,\n\nI am interested in:\nProduct: ${product.name}\nGold Purity: ${selectedPurity ? `${selectedPurity} Gold` : 'Not selected'}\n\nPlease share the latest price and available customization options.\n\nThank you.`
  const whatsappHref = `https://wa.me/919711781963?text=${encodeURIComponent(whatsappMessage)}`

  return (
    <section className="container section-block product-detail-page">
      <div className="detail-gallery">
        <div className="detail-top-actions">
          <Link className="secondary-button" to={`/shop/${encodeURIComponent(product.category)}`}>Back to {product.category}</Link>
          <Link className="secondary-button" to="/shop">View All Jewellery</Link>
        </div>
        <SafeImage src={product.image} alt={product.alt} className="main-image" />
        <div className="thumbnail-row">
          <SafeImage src={product.image} alt={product.alt} />
          <SafeImage src={product.image} alt={product.alt} />
          <SafeImage src={product.image} alt={product.alt} />
        </div>
      </div>
      <div className="detail-copy">
        <p className="eyebrow">{product.category}</p>
        <h1>{product.name}</h1>
        <div className="rating-row">
          <span>★★★★★</span>
          <small>4.9 / 5</small>
        </div>
        <div className="price-row detail-price">
          <strong>Price on Request</strong>
        </div>
        <p className="detail-description">{product.description}</p>
        <GoldPuritySelector product={product} value={selectedPurity} onChange={(purity) => { setSelectedPurity(purity); if (wishlist.includes(product.id)) updateWishlistPurity(product.id, purity) }} />
        {product.sizes && product.sizes.length > 0 && (
          <div className="variant-block">
            <span>Available sizes</span>
            <div className="variant-options" aria-label="Available sizes">
              {product.sizes.map((size) => (
                <button
                  key={size}
                  type="button"
                  className={selectedSize === size ? 'selected' : ''}
                  onClick={() => setSelectedSize(size)}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="spec-list">
          <div><span>Material</span><strong>{product.material}</strong></div>
          <div><span>Diamond details</span><strong>{product.diamondDetails}</strong></div>
        </div>
        <div className="detail-actions">
          <div className="quantity-picker">
            <button type="button" onClick={() => setQuantity((q) => Math.max(1, q - 1))}>−</button>
            <span>{quantity}</span>
            <button type="button" onClick={() => setQuantity((q) => q + 1)}>+</button>
          </div>
          <button type="button" className="primary-button" disabled={!selectedPurity} onClick={() => selectedPurity && addToCart(product, selectedPurity, quantity)}>Add to Cart</button>
          <button type="button" className="secondary-button" onClick={() => toggleWishlist(product.id, selectedPurity || undefined)}>{wishlist.includes(product.id) ? 'Remove from Wishlist' : 'Add to Wishlist'}</button>
        </div>
        <div className="detail-secondary-actions">
          <button type="button" disabled={!selectedPurity} onClick={() => setPriceInquiryOpen(true)}>Get Latest Price</button>
          <a href={whatsappHref} target="_blank" rel="noreferrer" aria-disabled={!selectedPurity} onClick={(event) => { if (!selectedPurity) event.preventDefault() }}>Enquire on WhatsApp</a>
        </div>
      </div>
      <div className="detail-meta-block">
        <div className="meta-card">
          <h3>Product Details</h3>
          <p>{product.description}</p>
        </div>
        <div className="meta-card">
          <h3>Specifications</h3>
          <ul>
            <li>Material: {product.material}</li>
            <li>Collection: {product.collection}</li>
            <li>Diamond Work: {product.diamondDetails}</li>
            {selectedSize && <li>Selected size: {selectedSize}</li>}
          </ul>
        </div>
        <div className="meta-card">
          <h3>Shipping Information</h3>
          <p>Complimentary shipping across India for qualifying orders.</p>
        </div>
        <div className="meta-card">
          <h3>Care Instructions</h3>
          <p>Store separately, avoid harsh chemicals, and wipe gently with a soft cloth.</p>
        </div>
      </div>
      {priceInquiryOpen && selectedPurity && (
        <PriceInquiryForm
          product={product}
          purity={selectedPurity}
          onClose={() => setPriceInquiryOpen(false)}
          whatsappHref={whatsappHref}
        />
      )}
    </section>
  )
}

function PriceInquiryForm({ product, purity, onClose, whatsappHref }: { product: Product; purity: GoldPurity; onClose: () => void; whatsappHref: string }) {
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatus('sending')
    const formData = new FormData(event.currentTarget)
    try {
      await postApi('/api/price-inquiries', {
        name: String(formData.get('name') ?? '').trim(),
        phone: String(formData.get('phone') ?? '').trim(),
        email: String(formData.get('email') ?? '').trim(),
        productId: product.id,
        goldPurity: purity,
        message: String(formData.get('message') ?? '').trim(),
      }, getIdempotencyKey(`price-${product.id}`))
      clearIdempotencyKey(`price-${product.id}`)
      setStatus('sent')
    } catch {
      setStatus('error')
    }
  }

  return (
    <div className="inquiry-overlay" role="presentation">
      <section className="price-inquiry-modal" role="dialog" aria-modal="true" aria-labelledby="price-inquiry-title">
        <button type="button" className="inquiry-close" onClick={onClose} aria-label="Close price inquiry">×</button>
        <p className="eyebrow">Personalised assistance</p>
        <h2 id="price-inquiry-title">Get Latest Price</h2>
        {status === 'sent' ? (
          <p className="success-copy" role="status">Thank you for contacting Shree Yash Diamond &amp; Jewels. Our team will get back to you shortly.</p>
        ) : (
          <>
            <div className="inquiry-product-summary">
              <span>Product</span><strong>{product.name}</strong>
              <span>Gold Purity</span><strong>{purity} Gold</strong>
              <span>Price</span><strong>Price on Request</strong>
            </div>
            <form className="price-inquiry-form" onSubmit={handleSubmit}>
              <label>Name<input name="name" autoComplete="name" required /></label>
              <label>Phone Number<input name="phone" type="tel" autoComplete="tel" required /></label>
              <label>Email (optional)<input name="email" type="email" autoComplete="email" /></label>
              <label>Message (optional)<textarea name="message" rows={3} /></label>
              <button type="submit" className="primary-button" disabled={status === 'sending'}>
                {status === 'sending' ? 'Sending…' : 'Submit Inquiry'}
              </button>
              {status === 'error' && (
                <p className="inquiry-error" role="alert">
                  We could not submit your request. Please try again or contact us via <a href={whatsappHref} target="_blank" rel="noreferrer">WhatsApp</a>.
                </p>
              )}
            </form>
          </>
        )}
      </section>
    </div>
  )
}

function ContactPage() {
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatus('sending')
    const formData = new FormData(event.currentTarget)
    try {
      await postApi('/api/inquiries', {
        name: String(formData.get('name') ?? '').trim(),
        phone: String(formData.get('phone') ?? '').trim(),
        email: String(formData.get('email') ?? '').trim(),
        message: String(formData.get('message') ?? '').trim(),
      }, getIdempotencyKey('contact'))
      clearIdempotencyKey('contact')
      setStatus('sent')
    } catch {
      setStatus('error')
    }
  }

  return (
    <section className="container section-block contact-page">
      <div className="page-heading">
        <p className="eyebrow">Get in touch</p>
        <h1>Contact Us</h1>
      </div>
      <div className="contact-grid">
        <div className="contact-card">
          <h3>Visit</h3>
          <p>B-111, Ground Floor Arya Samaj road, Uttam Nagar, New Delhi-110059, India</p>
          <p><a href="mailto:shreeyashdiamondandjewelss@gmail.com">shreeyashdiamondandjewelss@gmail.com</a></p>
          <p><a href="tel:+919711781963">+91 97117 81963</a></p>
          <p>All days : 11am - 8pm (OPEN) <br></br>
            EXCEPT WEDNESDAY (CLOSED)</p>
        </div>
        <form className="contact-form" onSubmit={handleSubmit}>
          <label>
            Name
            <input name="name" type="text" placeholder="Your name" autoComplete="name" required />
          </label>
          <label>
            Phone
            <input name="phone" type="tel" placeholder="Your phone number" autoComplete="tel" required />
          </label>
          <label>
            Email
            <input name="email" type="email" placeholder="Your email" autoComplete="email" required />
          </label>
          <label>
            Message
            <textarea name="message" rows={5} placeholder="Tell us about your enquiry" required />
          </label>
          <button type="submit" className="primary-button" disabled={status === 'sending'}>{status === 'sending' ? 'Sending…' : 'Send Message'}</button>
          {status === 'sent' && <p className="success-copy" role="status">Thank you for contacting Shree Yash Diamond &amp; Jewels. Our team will get back to you shortly.</p>}
          {status === 'error' && <p className="inquiry-error" role="alert">We could not submit your inquiry. Please try again shortly.</p>}
        </form>
      </div>
    </section>
  )
}

function CheckoutPage({ cart, updateCartItem, onOrderPlaced }: { cart: CartItem[]; updateCartItem: (id: string, purity: GoldPurity, change: number) => void; onOrderPlaced: () => void }) {
  const [orderPlaced, setOrderPlaced] = useState(false)
  const [orderId, setOrderId] = useState('')
  const [orderStatus, setOrderStatus] = useState<'idle' | 'sending' | 'error'>('idle')

  const handleOrderSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setOrderStatus('sending')
    const formData = new FormData(event.currentTarget)
    const order = {
      customer: {
        name: String(formData.get('name') ?? '').trim(),
        phone: String(formData.get('phone') ?? '').trim(),
        email: String(formData.get('email') ?? '').trim(),
        address: String(formData.get('address') ?? '').trim(),
        city: String(formData.get('city') ?? '').trim(),
        state: String(formData.get('state') ?? '').trim(),
        pincode: String(formData.get('pincode') ?? '').trim(),
      },
      items: cart.map((item) => ({
        productId: item.id,
        goldPurity: item.selectedPurity,
        quantity: item.quantity,
      })),
    }
    try {
      const result = await postApi<{ orderId: string }>('/api/orders', order, getIdempotencyKey('order'))
      setOrderId(result.orderId)
      clearIdempotencyKey('order')
      onOrderPlaced()
      setOrderPlaced(true)
    } catch {
      setOrderStatus('error')
    }
  }

  if (orderPlaced) {
    return (
      <section className="container section-block thank-you-page">
        <p className="eyebrow">Order placed</p>
        <h1>Thank you for your order.</h1>
        <p>Thank you for your order! Your order has been received successfully. Our team will contact you shortly.</p>
        {orderId && <p>Order ID: <strong>{orderId}</strong></p>}
        <Link to="/shop" className="primary-button">Continue shopping</Link>
      </section>
    )
  }

  return (
    <section className="container section-block checkout-page">
      <div className="page-heading">
        <p className="eyebrow">Checkout</p>
        <h1>Review Your Order</h1>
      </div>
      <form className="checkout-layout" onSubmit={handleOrderSubmit}>
        <div className="checkout-card">
          <h3>Customer Details</h3>
          <div className="checkout-form-grid">
            <label>Full Name<input name="name" type="text" autoComplete="name" required /></label>
            <label>Email (optional)<input name="email" type="email" autoComplete="email" /></label>
            <label>Phone<input name="phone" type="tel" autoComplete="tel" required /></label>
            <label>Address<textarea name="address" rows={3} autoComplete="street-address" required /></label>
            <label>City<input name="city" autoComplete="address-level2" required /></label>
            <label>State<input name="state" autoComplete="address-level1" required /></label>
            <label>Pincode<input name="pincode" autoComplete="postal-code" required /></label>
          </div>
        </div>

        <aside className="checkout-summary">
          <h3>Order Summary</h3>
          {cart.length === 0 ? (
            <p>Your cart is empty.</p>
          ) : (
            cart.map((item) => (
              <div key={`${item.id}-${item.selectedPurity}`} className="summary-item">
                <div>
                  <strong>{item.name}</strong>
                  <small>{item.selectedPurity} Gold · Price on Request</small>
                </div>
                <div className="summary-controls">
                  <button type="button" onClick={() => updateCartItem(item.id, item.selectedPurity, -1)}>−</button>
                  <span>{item.quantity}</span>
                  <button type="button" onClick={() => updateCartItem(item.id, item.selectedPurity, 1)}>+</button>
                </div>
              </div>
            ))
          )}
          <div className="totals">
            <div className="grand-total"><span>Price</span><strong>To be confirmed</strong></div>
          </div>
          <button type="submit" className="primary-button" disabled={cart.length === 0 || orderStatus === 'sending'}>
            {orderStatus === 'sending' ? 'Submitting…' : 'Place Order'}
          </button>
          {orderStatus === 'error' && <p className="inquiry-error" role="alert">We could not submit your order. Please try again shortly.</p>}
        </aside>
      </form>
    </section>
  )
}

function NotFoundPage() {
  return (
    <section className="container section-block not-found">
      <h1>404</h1>
      <p>The page you are looking for does not exist.</p>
      <Link to="/" className="primary-button">Back home</Link>
    </section>
  )
}

function CartDrawer({ open, cart, onClose, removeFromCart, updateCartItem }: { open: boolean; cart: CartItem[]; onClose: () => void; removeFromCart: (id: string, purity: GoldPurity) => void; updateCartItem: (id: string, purity: GoldPurity, change: number) => void }) {
  return (
    <div className={`cart-drawer ${open ? 'show' : ''}`}>
      <div className="drawer-header">
        <h3>Your cart</h3>
        <button type="button" onClick={onClose} aria-label="Close cart">×</button>
      </div>
      <div className="drawer-body">
        {cart.length === 0 ? (
          <p className="empty-cart">Your cart is empty. Add a timeless piece to begin.</p>
        ) : (
          cart.map((item) => (
            <div key={`${item.id}-${item.selectedPurity}`} className="cart-item">
              <SafeImage src={item.image} alt={item.alt} />
              <div>
                <strong>{item.name}</strong>
                <small>{item.category}</small>
                <small>{item.selectedPurity} Gold · Price on Request</small>
                <div className="cart-controls">
                  <button type="button" onClick={() => updateCartItem(item.id, item.selectedPurity, -1)}>-</button>
                  <span>{item.quantity}</span>
                  <button type="button" onClick={() => updateCartItem(item.id, item.selectedPurity, 1)}>+</button>
                </div>
              </div>
              <div className="cart-price">
                <strong>On Request</strong>
                <button type="button" onClick={() => removeFromCart(item.id, item.selectedPurity)}>Remove</button>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="drawer-footer">
        <div className="grand-total"><span>Price</span><strong>To be confirmed</strong></div>
        <Link to="/checkout" className="primary-button" onClick={onClose}>Checkout</Link>
      </div>
    </div>
  )
}

function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div>
          <div className="brand-mark footer-brand">
            <span>SHREE YASH</span>
            <small>DIAMOND &amp; JEWELS</small>
          </div>
        </div>
        <div>
          <h3>SHOP</h3>
          <ul>
            <li>Rings</li>
            <li>Earrings</li>
            <li>Necklaces</li>
            <li>Bracelets</li>
            <li>Pendants</li>
            <li>Bridal</li>
          </ul>
        </div>
        <div>
          <h3>CUSTOMER CARE</h3>
          <ul>
            <li>Contact</li>
            <li>Shipping</li>
            <li>Returns</li>
            <li>Exchange</li>
            <li>FAQ</li>
            <li>Order Tracking</li>
          </ul>
        </div>
        <div>
          <h3>ABOUT</h3>
          <ul>
            <li>Our Story</li>
            <li>Craftsmanship</li>
            <li>Privacy Policy</li>
            <li>Terms &amp; Conditions</li>
          </ul>
        </div>
        <div>
          <h3>CONTACT</h3>
          <ul>
            <li><a href="tel:+919711781963">+91 97117 81963</a></li>
            <li><a href="mailto:shreeyashdiamondandjewelss@gmail.com">shreeyashdiamondandjewelss@gmail.com</a></li>
            <li>B-111, Ground Floor Arya Samaj road, Uttam Nagar, New Delhi-110059, India</li>
            <li><a href="https://wa.me/919711781963" target="_blank" rel="noreferrer">WhatsApp</a></li>
            <li><a href="https://www.instagram.com/shreeyashdiamond/" target="_blank" rel="noreferrer">Instagram</a></li>
          </ul>
        </div>
      </div>
      <div className="container footer-bottom">
        <span>Join the world of timeless sparkle.</span>
        <div className="newsletter-box">
          <input type="email" placeholder="Email address" aria-label="Email for newsletter" />
          <button type="button" className="primary-button small-btn">Subscribe</button>
        </div>
      </div>
      <div className="container copyright">
        © 2026 Shree Yash Diamond and Jewels. All rights reserved.
      </div>
    </footer>
  )
}

export default App
