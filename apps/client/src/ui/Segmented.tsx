/** Table sizes the rules engine supports, and the bot counts that can fill them. */
export const PLAYER_COUNTS = [3, 4, 5, 6, 7, 8] as const
export const BOT_COUNTS = [0, 1, 2, 3, 4, 5, 6, 7] as const

interface SegmentedProps<T extends number> {
  label: string
  options: readonly T[]
  value: number
  /** data-testid prefix: `${prefix}-${option}` */
  prefix: string
  disabled?: boolean
  /** Per-option disable, on top of `disabled`. */
  isDisabled?: (option: T) => boolean
  onChange: (option: T) => void
}

/** One-row radiogroup of numbers, the lobby's `seg` style. */
export function Segmented<T extends number>({ label, options, value, prefix, disabled, isDisabled, onChange }: SegmentedProps<T>) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          data-testid={`${prefix}-${n}`}
          className={value === n ? 'seg-btn selected' : 'seg-btn'}
          disabled={disabled || isDisabled?.(n)}
          onClick={() => onChange(n)}
        >
          {n}
        </button>
      ))}
    </div>
  )
}
