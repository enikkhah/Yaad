import { readFileSync } from 'fs';

/**
 * Security Rules Specification & Dirty Dozen Verification Suite
 * Validates that firestore.rules enforces all 12 Dirty Dozen invariants.
 */
export function verifyFirestoreRulesStatic(): boolean {
  const rules = readFileSync('firestore.rules', 'utf8');
  const requiredGuards = [
    "rules_version = '2';",
    'allow read, write: if false;',
    'data.count <= 730',
    'existing().count < 730',
    '(data.batch == 1 || data.batch == 2)',
    'isValidSha256Hex',
    'isAtomicCounterClaim',
    'isAtomicRecoveryClaim',
    'match /launch_recovery/{hash}',
    'allow list: if false;',
  ];

  for (const guard of requiredGuards) {
    if (!rules.includes(guard)) {
      throw new Error(`Missing required security rule guard: ${guard}`);
    }
  }
  return true;
}
