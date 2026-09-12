import { createMatchObject } from '@ayosage/match-core'
import { catanAdapter } from './catan/adapter'

export class CatanMatch extends createMatchObject(catanAdapter) {}
