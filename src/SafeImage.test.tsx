import { isValidElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { SafeImage } from './App'

describe('SafeImage', () => {
  it('keeps the original source and reports a load failure instead of displaying another product', () => {
    const image = SafeImage({ src: '/nsr.webp', alt: 'Noor Solitaire Ring' })
    type ImageProps = { src: string; onError: (event: { currentTarget: { src: string; currentSrc: string } }) => void }
    if (!isValidElement<ImageProps>(image)) throw new Error('Expected an image element')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const target = { src: 'http://localhost/nsr.webp', currentSrc: 'http://localhost/nsr.webp' }
      image.props.onError({ currentTarget: target })
      expect(image.props.src).toBe('/nsr.webp')
      expect(target.src).toBe('http://localhost/nsr.webp')
      expect(warn).toHaveBeenCalledWith('[SafeImage] Failed to load image:', target.currentSrc)
    } finally {
      warn.mockRestore()
    }
  })
})
