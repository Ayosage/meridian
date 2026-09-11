const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
/** Four-letter join code. `random` in [0,1). */
export function randomCode(random: () => number = Math.random): string {
  let code = ''
  for (let i = 0; i < 4; i++) code += ALPHABET[Math.min(25, Math.floor(random() * 26))]
  return code
}
