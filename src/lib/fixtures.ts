import type { Address, Hex } from 'viem'

/**
 * Demo cast for the "stage directions". These are throwaway TESTNET keys, published on purpose:
 * they hold only faucet money. NEVER send real funds to them and never reuse them anywhere else.
 *
 * `impostor` was mined (see tools/mine-lookalike.ts) to share the first and last three hex
 * characters with `acme`, exactly like a real address-poisoning attacker would.
 */
export const FIXTURES = {
  acme: { address: '0xd1b7E89C298B6Dfe54F3fe937A57CEa1327086EE' as Address, key: '0x23c0359864200a72f2a08fcdf0aad8c335390c0b5f90538a4f30f8a95462317e' as Hex },
  impostor: { address: '0xd1bdf001039967455c1eff92230404423ce326ee' as Address, key: '0x4e78a5b8e94ca2dcf08bd57cfb02fe398659f696c45ce6cc0dd5451633d05cf0' as Hex },
  newcomer: { address: '0x540e77867a96394Eb9DF149936617B64E017A295' as Address, key: '0x2b6603bbb480bbba7a948e33de0f5a029deadc7beb305a9a73c1cae0d50da6e3' as Hex },
} as const
