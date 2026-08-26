import { lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

// dev-only beauty-slice review route (art direction sign-off happens here)
const SliceReview = lazy(() =>
  import('./dev/slice/SliceScene').then((m) => ({ default: m.SliceReview })),
)
// dev-only full-board preview route (local beginner board, no server)
const BoardPreview = lazy(() =>
  import('./dev/board/BoardPreview').then((m) => ({ default: m.BoardPreview })),
)
// dev-only dice review route (every face + tumble, no server)
const DicePreview = lazy(() =>
  import('./dev/dice/DicePreview').then((m) => ({ default: m.DicePreview })),
)

const root = document.getElementById('root')
if (!root) throw new Error('missing #root element')
const isSlice = import.meta.env.DEV && window.location.pathname === '/slice'
const isBoard = import.meta.env.DEV && window.location.pathname === '/board'
const isDice = import.meta.env.DEV && window.location.pathname === '/dice'
createRoot(root).render(
  isSlice ? (
    <Suspense fallback={null}>
      <SliceReview />
    </Suspense>
  ) : isBoard ? (
    <Suspense fallback={null}>
      <BoardPreview />
    </Suspense>
  ) : isDice ? (
    <Suspense fallback={null}>
      <DicePreview />
    </Suspense>
  ) : (
    <App />
  ),
)
