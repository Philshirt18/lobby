import { hexToString, type Hex } from 'viem'

/** Decode a bytes32 memo to printable text ("" if it is not printable). Tolerates left- and right-padding. */
export function memoToText(memo: Hex): string {
  try {
    const text = hexToString(memo).replace(/^\0+|\0+$/g, '')
    return /^[\x20-\x7e]*$/.test(text) ? text : ''
  } catch {
    return ''
  }
}
