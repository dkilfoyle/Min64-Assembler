/**
 * I/O registers of the Minimal 64x4.
 *
 * Per the manual ("I/O Registers", "I/O Operations"):
 *   - The UART receiver register and the PS/2 keyboard register each hold a single byte.
 *   - Reading either register (INT / INK) returns its current value and clears it to 0xff
 *     ("upon read-out, the corresponding register is cleared to 0xff. Subsequent polling
 *     ... without new data arriving will yield 0xff").
 *   - OUT transmits the accumulator over UART (on the Redux, this instruction's 160-cycle
 *     duration already accounts for the transmission, so no software wait is required).
 *   - WIN halts the CPU until either register holds a non-0xff value.
 *
 * This emulator models the UART/PS2 registers as simple single-byte-deep "mailboxes" fed by
 * a host queue (e.g. keystrokes typed by the user, or bytes arriving over a virtual serial
 * connection). Call `pushUartByte`/`pushKeyByte` to deliver new input from the host
 * environment; `onUartTransmit` is invoked whenever the CPU executes OUT.
 */

const EMPTY = 0xff;

export class IoDevices {
  private uartRx: number = EMPTY;
  private keyRx: number = EMPTY;

  /** Called whenever the CPU executes OUT (byte sent from A to the terminal). */
  onUartTransmit: ((byte: number) => void) | null = null;

  reset(): void {
    this.uartRx = EMPTY;
    this.keyRx = EMPTY;
  }

  // ---- Host-facing API: feed input into the machine -----------------------------------

  /** Deliver a byte as if it arrived over the UART (e.g. from a host terminal/file transfer). */
  pushUartByte(byte: number): void {
    this.uartRx = byte & 0xff;
  }

  /** Deliver a byte as if it arrived from the PS/2 keyboard (scan code, per MinOS's table). */
  pushKeyByte(byte: number): void {
    this.keyRx = byte & 0xff;
  }

  hasUartByte(): boolean {
    return this.uartRx !== EMPTY;
  }

  hasKeyByte(): boolean {
    return this.keyRx !== EMPTY;
  }

  // ---- CPU-facing API: the four I/O instructions ---------------------------------------

  /** INT: A = UART receiver register, then register is cleared to 0xff. */
  readUart(): number {
    const v = this.uartRx;
    this.uartRx = EMPTY;
    return v;
  }

  /** INK: A = PS/2 keyboard register, then register is cleared to 0xff. */
  readKeyboard(): number {
    const v = this.keyRx;
    this.keyRx = EMPTY;
    return v;
  }

  /** OUT: transmit A over UART. */
  writeUart(byte: number): void {
    this.onUartTransmit?.(byte & 0xff);
  }

  /** WIN: true while both registers are empty (0xff), i.e. the CPU should keep halting. */
  shouldWaitForInput(): boolean {
    return this.uartRx === EMPTY && this.keyRx === EMPTY;
  }
}
