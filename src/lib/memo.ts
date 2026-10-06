import { hexToString, stringToHex, type Hex } from 'viem'

/** Decode a bytes32 memo to printable text ("" if it is not printable). Tolerates left- and right-padding. */
export function memoToText(memo: Hex | null | undefined): string {
  if (!memo) return ''
  try {
    const text = hexToString(memo).replace(/^\0+|\0+$/g, '')
    return /^[\x20-\x7e]*$/.test(text) ? text : ''
  } catch {
    return ''
  }
}

/** Right-padded bytes32, the layout Tempo's docs and `cast` use. */
export function textToMemo(text: string): Hex {
  return stringToHex(text, { size: 32 })
}
