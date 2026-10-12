import { LoaderCircle, AlertCircle } from 'lucide-react'
export function Loading() {
  return (
    <div className="state" role="status">
      <LoaderCircle className="animate-spin" />
      <p>Loading your garage…</p>
    </div>
  )
}
export function ErrorState({
  message,
  retry,
}: {
  message: string
  retry?: () => void
}) {
  return (
    <div className="notice" role="alert">
      <AlertCircle size={20} />
      <div>
        <p>{message}</p>
        {retry && (
          <button className="text-link" onClick={retry}>
            Try again
          </button>
        )}
      </div>
    </div>
  )
}
