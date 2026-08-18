import { expect, it } from 'vitest'
import { App } from '../src/App'

it('App component is exported and renderable as an element', () => {
  expect(typeof App).toBe('function')
  expect(<App />).toBeTruthy()
})
