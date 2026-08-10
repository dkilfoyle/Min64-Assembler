/**
 * Minimal Intel HEX (.hex) parser.
 *
 * The Minimal 64x4's cross-assembler and native assembler both emit machine code as
 * Intel HEX text (see manual: "an Intel HEX file that can be uploaded to the Minimal
 * 64x4 via UART" / "'receive' ... pasting the HEX file into a terminal"). This parser
 * supports the record types actually needed for a 16-bit-address flat memory image:
 * 0x00 (data) and 0x01 (end of file). Extended address records (0x02/0x04) are not
 * required since the Minimal's address space is 16 bits.
 */

export interface HexRecord {
  address: number;
  data: Uint8Array;
}

export function parseIntelHex(text: string): HexRecord[] {
  const records: HexRecord[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || !line.startsWith(":")) continue;
    const bytes = hexToBytes(line.slice(1));
    const byteCount = bytes[0];
    const address = (bytes[1] << 8) | bytes[2];
    const recordType = bytes[3];
    const data = Uint8Array.from(bytes.slice(4, 4 + byteCount));
    // (checksum at bytes[4 + byteCount] is not verified; malformed lines are skipped)
    if (recordType === 0x00) {
      records.push({ address, data });
    } else if (recordType === 0x01) {
      break; // end-of-file record
    }
    // other record types (extended address, start address, etc.) are ignored
  }
  return records;
}

/** Applies parsed Intel HEX records into a flat byte array at their given addresses. */
export function applyHexRecords(target: Uint8Array, records: HexRecord[], baseOffset = 0): number {
  let totalBytes = 0;
  for (const rec of records) {
    const start = baseOffset + rec.address;
    if (start < 0 || start + rec.data.length > target.length) continue;
    target.set(rec.data, start);
    totalBytes += rec.data.length;
  }
  return totalBytes;
}

function hexToBytes(hex: string): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < hex.length; i += 2) {
    out.push(parseInt(hex.substr(i, 2), 16));
  }
  return out;
}
