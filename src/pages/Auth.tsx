import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { CarFront, ArrowRight } from 'lucide-react'
import { authService } from '../services/auth'
import { authenticationErrorMessage } from '../services/authErrors'
import { useAuth } from '../components/AuthProvider'
import { ErrorState } from '../components/States'
export function Auth() {
  const { session, error: restorationError } = useAuth()
  const [register, setRegister] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  if (session) return <Navigate to="/" replace />
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    const form = new FormData(event.currentTarget)
    try {
      const credentials = {
        email: String(form.get('email')).trim(),
        password: String(form.get('password')),
      }
      if (register) {
        const { confirmationRequired } = await authService.register(
          credentials,
          window.location.origin + '/login',
        )
        if (confirmationRequired)
          setMessage('Check your email to confirm your account, then sign in.')
      } else {
        await authService.signIn(credentials)
      }
    } catch (error) {
      setError(
        authenticationErrorMessage(
          error,
          register
            ? 'Firebase registration failed. Check your details and try again.'
            : 'Firebase sign-in failed. Check your details and try again.',
        ),
      )
    } finally {
      setBusy(false)
    }
  }
  async function clearSession() {
    setBusy(true)
    try {
      await authService.signOut()
      setError('')
      setMessage('Signed out. You can try again or use another account.')
    } catch {
      setError('Unable to sign out. Retry before using another account.')
    } finally {
      setBusy(false)
    }
  }
  async function google() {
    setBusy(true)
    setError('')
    try {
      await authService.signInWithGoogle(window.location.origin + '/login')
    } catch (error) {
      setError(
        authenticationErrorMessage(
          error,
          'Google authentication failed. Check provider setup and retry.',
        ),
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="auth-screen">
      <div className="auth-story">
        <Link className="brand" to="/">
          <span className="brand-icon">
            <CarFront />
          </span>
          <span>
            Smart Car<span className="brand-sub">SERVICE BOOK</span>
          </span>
        </Link>
        <div>
          <p className="eyebrow">A HOME FOR YOUR VEHICLES</p>
          <h1>
            Every journey.
            <br />
            One garage.
          </h1>
          <p>
            Keep your vehicle essentials together,
            <br />
            wherever the road takes you.
          </p>
          <CarFront size={160} strokeWidth={0.75} />
        </div>
        <small>Made for every mile.</small>
      </div>
      <section className="auth-form">
        <p className="eyebrow">SMART CAR SERVICE BOOK</p>
        <h1>{register ? 'Start your garage' : 'Welcome back'}</h1>
        <p>
          {register
            ? 'Create an account for your personal vehicles.'
            : 'Sign in to your personal garage.'}
        </p>
        {!authService.available && (
          <div className="notice">
            Firebase Authentication is not configured. Follow the README to
            enable authentication.
          </div>
        )}
        {error && <ErrorState message={error} />}
        {restorationError && <ErrorState message={restorationError} />}
        {(error || restorationError) && (
          <button
            className="button secondary full"
            disabled={busy}
            onClick={() => void clearSession()}
          >
            Sign out and try again
          </button>
        )}
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
        <button
          className="button secondary full"
          disabled={busy || !authService.available}
          onClick={() => void google()}
        >
          Continue with Google
          <ArrowRight size={18} />
        </button>
        <div className="divider">or continue with email</div>
        <form onSubmit={submit}>
          <label>
            Email address
            <input
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              required
              maxLength={254}
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              minLength={8}
              maxLength={128}
              autoComplete={register ? 'new-password' : 'current-password'}
              placeholder="At least 8 characters"
              required
            />
          </label>
          <button
            className="button full"
            disabled={busy || !authService.available}
          >
            {busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}
            <ArrowRight size={18} />
          </button>
        </form>
        <p className="auth-switch">
          {register ? 'Already have an account?' : 'New here?'}{' '}
          <button
            className="text-link"
            disabled={busy}
            onClick={() => {
              setRegister(!register)
              setError('')
              setMessage('')
            }}
          >
            {register ? 'Sign in' : 'Create an account'}
          </button>
        </p>
        {!authService.available && (
          <Link className="text-link" to="/">
            Explore the foundation
          </Link>
        )}
      </section>
    </div>
  )
}
