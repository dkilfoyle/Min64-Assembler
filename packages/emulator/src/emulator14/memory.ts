/**
 * Memory subsystem of the Minimal 64x4 (Revision 1.4 "Redux").
 *
 * Address space (see manual, "Memory Layout"):
 *
 *   0x0000..0x0fff  4KB window: FLASH bank <BANK> (if BANK < 128) or RAM (if BANK >= 128)
 *                     0x0000..0x00ff is the zero page (always addressed within this window)
 *   0x1000..0xffff  always RAM (only the low 4K page is ever swapped out for FLASH)
 *
 * FLASH is organized as 128 banks of 4KB each (512KB total), reflecting the physical
 * 4x 39SF0x0 FLASH ICs. Banks 0..2 hold the OS image (bank 1 additionally holds OS data
 * tables and the character set), banks 3..127 are the SSD file system's user area.
 *
 * BANK register:
 *   - Cleared to 0x00 on reset (FLASH bank 0 exposed at 0x0000-0x0fff; this is how the
 *     boot loader at address 0 is fetched from FLASH on power-up).
 *   - bit7 set (BANK >= 128, conventionally 0xff) disables FLASH entirely: the full 64KB
 *     address space becomes plain RAM. This is the normal state once MinOS has booted.
 *
 * VRAM: writes to 0x4000-0x7fff are mirrored into a dedicated video shift-register set for
 * display purposes, but as far as the CPU is concerned this area is indistinguishable from
 * ordinary RAM ("VRAM is not directly accessible to the CPU for readout but through the
 * mirror image in the system RAM area 0x4000-0x7fff" - manual). We keep it as part of the
 * flat RAM array and expose a helper to read out video memory for rendering.
 *
 * FLASH programming: the 39SF0x0 ICs use the standard JEDEC-style software unlock/command
 * protocol (0xAA -> 0x55 -> command byte, then either a data write for byte programming or
 * a further 0xAA/0x55/0x30(sector)|0x10(chip) sequence for erase). This emulator recognizes
 * command sequences by their *values* only (ignoring the specific unlock addresses, which
 * real parts are often tolerant of and which MinOS always issues the same way), which is
 * sufficient to run MinOS's file system (save/delete/format) faithfully.
 */

export const RAM_SIZE = 0x10000; // 64KB
export const BANK_SIZE = 0x1000; // 4KB per FLASH bank / low memory window
export const FLASH_BANKS = 128;
export const FLASH_SIZE = BANK_SIZE * FLASH_BANKS; // 512KB

export const VRAM_START = 0x4000;
export const VRAM_END = 0x7fff; // inclusive
export const STACK_PAGE = 0xff00;
export const SP_ADDRESS = 0xffff; // holds the stack pointer LSB; MSB is always 0xff
export const ZERO_PAGE_END = 0x00ff;

type FlashState =
  | "idle"
  | "unlocked1" // saw 0xAA
  | "unlocked2" // saw 0xAA, 0x55
  | "program-armed" // saw 0xAA,0x55,0xA0 -> next write commits program data
  | "erase-primed" // saw 0xAA,0x55,0x80 -> expects the second unlock sequence next
  | "erase-unlocked1" // saw 0xAA,0x55,0x80,0xAA
  | "erase-unlocked2"; // saw 0xAA,0x55,0x80,0xAA,0x55 -> next write is 0x30 (sector) or 0x10 (chip)

export class Memory {
  readonly ram = new Uint8Array(RAM_SIZE);
  readonly flash = new Uint8Array(FLASH_SIZE).fill(0xff);

  /** BANK register: 0..127 selects a FLASH bank for the 0x0000-0x0fff window, >=128 = RAM. */
  bank = 0x00;

  private flashState: FlashState = "idle";

  async reset(): Promise<void> {
    this.bank = 0x00;
    this.flashState = "idle";
    const fileUrl = new URL("../assets/flash14.bin", import.meta.url);
    await fetch(fileUrl)
      .then((response) => response.arrayBuffer())
      .then((buffer) => {
        this.flash.set(new Uint8Array(buffer));
      })
      .catch((error) => {
        console.error("Failed to load flash:", error);
      });
    this.ram.fill(0xcd);
  }

  /** Load a raw flash image (e.g. the 512KB SSD image) starting at a given bank/offset. */
  loadFlashImage(bytes: Uint8Array, startBank = 0, offset = 0): void {
    const base = startBank * BANK_SIZE + offset;
    this.flash.set(bytes.subarray(0, Math.min(bytes.length, FLASH_SIZE - base)), base);
  }

  /** True if the low 4K window currently exposes FLASH rather than RAM. */
  private flashWindowActive(): boolean {
    return (this.bank & 0x80) === 0;
  }

  /** CPU-visible memory read (RO): used by every regular instruction operand fetch. */
  read(addr: number): number {
    addr &= 0xffff;
    if (addr < BANK_SIZE && this.flashWindowActive()) {
      return this.flash[this.bank * BANK_SIZE + addr];
    }
    return this.ram[addr];
  }

  /** CPU-visible memory write (RI): used by every regular instruction store. */
  write(addr: number, value: number): void {
    addr &= 0xffff;
    value &= 0xff;
    if (addr < BANK_SIZE && this.flashWindowActive()) {
      this.handleFlashWrite(this.bank * BANK_SIZE + addr, value);
      return;
    }
    this.ram[addr] = value;
  }

  read16(addr: number): number {
    return this.read(addr) | (this.read((addr + 1) & 0xffff) << 8);
  }

  write16(addr: number, value: number): void {
    this.write(addr, value & 0xff);
    this.write((addr + 1) & 0xffff, (value >> 8) & 0xff);
  }

  read32(addr: number): number {
    return (
      (this.read(addr) |
        (this.read((addr + 1) & 0xffff) << 8) |
        (this.read((addr + 2) & 0xffff) << 16) |
        (this.read((addr + 3) & 0xffff) << 24)) >>>
      0
    );
  }

  write32(addr: number, value: number): void {
    this.write(addr, value & 0xff);
    this.write((addr + 1) & 0xffff, (value >> 8) & 0xff);
    this.write((addr + 2) & 0xffff, (value >> 16) & 0xff);
    this.write((addr + 3) & 0xffff, (value >> 24) & 0xff);
  }

  /**
   * Direct FLASH access used by RDB/RDR/RAP/RZP/WDB/WDR: these instructions momentarily
   * engage a specific bank, perform exactly one byte transfer through the normal windowed
   * bus, and then restore BANK to 0xff (full RAM), matching MinOS's documented behavior
   * ("RDB 0x0000,0x00 ; dummy read switches off FLASH after boot-up").
   *
   * `windowAddr` is the address as seen through the low-4K window; only the low 12 bits
   * are significant, matching the physical 4KB bank size.
   */
  flashTransferRead(bank: number, windowAddr: number): number {
    this.bank = bank & 0xff;
    const value = this.read(windowAddr & 0x0fff);
    this.bank = 0xff;
    return value;
  }

  flashTransferWrite(bank: number, windowAddr: number, value: number): void {
    this.bank = bank & 0xff;
    this.write(windowAddr & 0x0fff, value);
    this.bank = 0xff;
  }

  /** Read a byte from VRAM for rendering purposes (0x4000-0x7fff mirrors RAM). */
  readVram(offset: number): number {
    return this.ram[(VRAM_START + (offset & 0x3fff)) & 0xffff];
  }

  private eraseSector(flatAddr: number): void {
    const bank = Math.floor(flatAddr / BANK_SIZE);
    this.flash.fill(0xff, bank * BANK_SIZE, (bank + 1) * BANK_SIZE);
  }

  private eraseChip(): void {
    this.flash.fill(0xff);
  }

  private handleFlashWrite(flatAddr: number, value: number): void {
    switch (this.flashState) {
      case "idle":
        this.flashState = value === 0xaa ? "unlocked1" : "idle";
        return;
      case "unlocked1":
        this.flashState = value === 0x55 ? "unlocked2" : "idle";
        return;
      case "unlocked2":
        if (value === 0xa0) {
          this.flashState = "program-armed";
        } else if (value === 0x80) {
          this.flashState = "erase-primed";
        } else {
          this.flashState = "idle";
        }
        return;
      case "program-armed": {
        // Commit: flash bits can only be cleared (1->0) by programming and set (0->1) by
        // erase; AND-merging models that physical constraint faithfully.
        const bank = Math.floor(flatAddr / BANK_SIZE);
        const off = flatAddr % BANK_SIZE;
        this.flash[bank * BANK_SIZE + off] &= value;
        this.flashState = "idle";
        return;
      }
      case "erase-primed":
        this.flashState = value === 0xaa ? "erase-unlocked1" : "idle";
        return;
      case "erase-unlocked1":
        this.flashState = value === 0x55 ? "erase-unlocked2" : "idle";
        return;
      case "erase-unlocked2":
        if (value === 0x30) {
          this.eraseSector(flatAddr);
        } else if (value === 0x10) {
          this.eraseChip();
        }
        this.flashState = "idle";
        return;
    }
  }
}
