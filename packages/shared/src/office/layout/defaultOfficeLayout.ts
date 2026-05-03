import seed from './defaultOfficeLayout.json' with { type: 'json' }
import type { OfficeLayout } from '../types.js'

export const DEFAULT_OFFICE_LAYOUT: OfficeLayout = seed as OfficeLayout
