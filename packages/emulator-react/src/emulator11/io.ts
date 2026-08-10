export class IODevice {
  private inputBuffer: number[] = [];
  private waitClocks: number = 0;
  private minWait: number = 0;

  constructor(minWait: number) {
    this.minWait = minWait;
    this.reset();
  }

  receive(data: number) {
    this.inputBuffer.push(data);
  }

  toString() {
    return this.inputBuffer.toString();
  }

  read() {
    if (this.waitClocks <= 0 && this.inputBuffer.length > 0) {
      this.waitClocks = this.minWait;
      return this.inputBuffer.shift()!;
    } else {
      return 0xff; // No data available, return 0xff
    }
  }

  write() {
    throw Error("Not implemented");
  }

  waited(clocks: number) {
    this.waitClocks -= clocks;
  }

  reset() {
    this.inputBuffer = [];
    this.waitClocks = 0;
  }

  hasData() {
    return this.inputBuffer.length > 0;
  }
}

export const scancodes: Record<number, number> = {
  65: 0x1c, // A (GERMAN KEYBOARD LAYOUT)
  66: 0x32, // B
  67: 0x21, // C
  68: 0x23, // D
  69: 0x24, // E
  70: 0x2b, // F
  71: 0x34, // G
  72: 0x33, // H
  73: 0x43, // I
  74: 0x3b, // J
  75: 0x42, // K
  76: 0x4b, // L
  77: 0x3a, // M
  78: 0x31, // N
  79: 0x44, // O
  80: 0x4d, // P
  81: 0x15, // Q
  82: 0x2d, // R
  83: 0x1b, // S
  84: 0x2c, // T
  85: 0x3c, // U
  86: 0x2a, // V
  87: 0x1d, // W
  88: 0x22, // X
  89: 0x35, // Y
  90: 0x1a, // Z
  48: 0x45, // 0
  49: 0x16, // 1
  50: 0x1e, // 2
  51: 0x26, // 3
  52: 0x25, // 4
  53: 0x2e, // 5
  54: 0x36, // 6
  55: 0x3d, // 7
  56: 0x3e, // 8
  57: 0x46, // 9
  32: 0x29, // SPACE
  188: 0x41, // ,
  190: 0x49, // .
  13: 0x5a, // ENTER
  27: 0x76, // ESC
  9: 0x0d, // TAB
  8: 0x66, // BACKSPACE
  46: 0x71, // DEL
  38: 0x75, // UP
  40: 0x72, // DOWN
  37: 0x6b, // LEFT
  39: 0x74, // RIGHT
  16: 0x12, // SHIFT
  20: 0x14, // CAPS->CTRL
  18: 0x11, // ALT/ALTGR
  36: 0x6c, // HOME
  35: 0x69, // END
  33: 0x7d, // PAGE UP
  34: 0x7a, // PAGE DOWN
  173: 0x4a, // MINUS
  163: 0x5d, // #
  171: 0x5b, // +
  60: 0x61, // <
  63: 0x4e, // ?
  160: 0x0e, // ^
};

export const keycodes: Record<string, number> = {
  KeyA: 0x1c, // A (GERMAN KEYBOARD LAYOUT)
  KeyB: 0x32, // B
  KeyC: 0x21, // C
  KeyD: 0x23, // D
  KeyE: 0x24, // E
  KeyF: 0x2b, // F
  KeyG: 0x34, // G
  KeyH: 0x33, // H
  KeyI: 0x43, // I
  KeyJ: 0x3b, // J
  KeyK: 0x42, // K
  KeyL: 0x4b, // L
  KeyM: 0x3a, // M
  KeyN: 0x31, // N
  KeyO: 0x44, // O
  KeyP: 0x4d, // P
  KeyQ: 0x15, // Q
  KeyR: 0x2d, // R
  KeyS: 0x1b, // S
  KeyT: 0x2c, // T
  KeyU: 0x3c, // U
  KeyV: 0x2a, // V
  KeyW: 0x1d, // W
  KeyX: 0x22, // X
  KeyY: 0x35, // Y
  KeyZ: 0x1a, // Z
  Digit0: 0x45, // 0
  Digit1: 0x16, // 1
  Digit2: 0x1e, // 2
  Digit3: 0x26, // 3
  Digit4: 0x25, // 4
  Digit5: 0x2e, // 5
  Digit6: 0x36, // 6
  Digit7: 0x3d, // 7
  Digit8: 0x3e, // 8
  Digit9: 0x46, // 9
  Space: 0x29, // SPACE
  Comma: 0x41, // ,
  Period: 0x49, // .
  Enter: 0x5a, // ENTER
  Escape: 0x76, // ESC
  Tab: 0x0d, // TAB
  Backspace: 0x66, // BACKSPACE
  Delete: 0x71, // DEL
  ArrowUp: 0x75, // UP
  ArrowDown: 0x72, // DOWN
  ArrowLeft: 0x6b, // LEFT
  ArrowRight: 0x74, // RIGHT
  ShiftLeft: 0x12, // SHIFT
  CapsLock: 0x14, // CAPS->CTRL
  AltLeft: 0x11, // ALT/ALTGR
  Home: 0x6c, // HOME
  End: 0x69, // END
  PageUp: 0x7d, // PAGE UP
  PageDown: 0x7a, // PAGE DOWN
  Minus: 0x4a, // MINUS
  Hash: 0x5d, // #
  Equal: 0x5b, // +
  IntlBackslash: 0x61, // <
  Slash: 0x4e, // ?
  Caret: 0x0e, // ^
};
