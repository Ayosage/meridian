import { createMatchObject } from '@meridian/match-core'
import { catanAdapter } from './catan/adapter'

export class CatanMatch extends createMatchObject(catanAdapter) {}
