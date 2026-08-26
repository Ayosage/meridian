import { useState } from 'react'
import { DiceCanvas } from '../../ui/DiceCanvas'
import '../../ui/hud.css'

const ROLLS: (readonly [number, number] | null)[] = [
  null,
  [1, 2],
  [3, 4],
  [5, 6],
  [6, 6],
  [2, 2],
]

/**
 * Dev-only dice review route (/dice) — cycles every face of the KayKit D6 so
 * the face→value mapping and the roll tumble can be eyeballed without
 * standing up a match.
 */
export function DicePreview() {
  const [i, setI] = useState(0)
  const dice = ROLLS[i % ROLLS.length] ?? null
  return (
    <div style={{ minHeight: '100vh', background: '#0d1017', display: 'grid', placeItems: 'center' }}>
      <div className="catan-hud" style={{ position: 'relative', width: 400, height: 200 }}>
        <div className="dice-display">
          <DiceCanvas dice={dice} />
          <span className="dice-total">
            {dice ? `${dice[0]} + ${dice[1]} = ${dice[0] + dice[1]}` : '—'}
          </span>
        </div>
        <button
          style={{ position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)' }}
          onClick={() => setI((n) => n + 1)}
        >
          next roll
        </button>
      </div>
    </div>
  )
}
