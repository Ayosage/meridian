// Hand-maintained declarations for driver.mjs (plain JS). Keep in sync
// with driver.mjs.
import type { Locator, Page } from '@playwright/test'

export declare const RESOURCES: readonly ['wood', 'brick', 'sheep', 'wheat', 'ore']

export interface Target {
  kind: 'vertex' | 'edge' | 'hex'
  id: string
  x: number
  y: number
}

export declare function isEnabled(locator: Locator): Promise<boolean>
export declare function isVisible(locator: Locator): Promise<boolean>
export declare function tryClick(locator: Locator): Promise<boolean>
export declare function driveDiscard(page: Page): Promise<void>
export declare function readLegalTargets(page: Page): Promise<{ mode: string; targets: Target[] }>
export declare function clearPointIndex(page: Page, points: { x: number; y: number }[]): Promise<number>
export declare function clickFirstClearTarget(page: Page): Promise<{ mode: string; targets: Target[] }>
