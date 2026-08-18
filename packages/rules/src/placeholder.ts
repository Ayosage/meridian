import placeholderJson from './rulesets/placeholder.json'
import { loadRuleset, type Ruleset } from './ruleset'

export const placeholderRuleset: Ruleset = loadRuleset(placeholderJson)
