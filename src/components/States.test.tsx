import { render, screen, fireEvent } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ErrorState, Loading } from './States'
it('announces loading to assistive technology', () => {
  render(<Loading />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading your garage')
})
it('provides an actionable error state', () => {
  const retry = vi.fn()
  render(<ErrorState message="Connection failed" retry={retry} />)
  expect(screen.getByRole('alert')).toHaveTextContent('Connection failed')
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(retry).toHaveBeenCalledOnce()
})
