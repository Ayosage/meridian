import { lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

// dev-only beauty-slice review route (art direction sign-off happens here)
const SliceReview = lazy(() =>
  import('./dev/slice/SliceScene').then((m) => ({ default: m.SliceReview })),
)

const root = document.getElementById('root')
if (!root) throw new Error('missing #root element')
const isSlice = import.meta.env.DEV && window.location.pathname === '/slice'
createRoot(root).render(
  isSlice ? (
    <Suspense fallback={null}>
      <SliceReview />
    </Suspense>
  ) : (
    <App />
  ),
)
