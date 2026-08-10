import { Memory } from "./memory";

/**
 * Video Graphics Adapter helper.
 *
 * Per the manual:
 *   - VRAM occupies 0x4000-0x7fff: 64 bytes/row x 256 rows (16KB), 1 bit per pixel.
 *   - The visible viewport is 400x240 pixels (50 bytes wide) starting at address 0x430c.
 *   - Writes to this region are indistinguishable from ordinary RAM writes as far as the
 *     CPU is concerned ("VRAM is not directly accessible to the CPU for readout but
 *     through the mirror image in the system RAM area 0x4000-0x7fff"), so rendering is a
 *     pure function of RAM contents - no separate device state to track.
 *
 * Bit order: OS_SetPixel computes a bit pattern via a `SetTable` lookup indexed by
 * `x & 7` and ORs it into the target byte; this emulator assumes the conventional
 * MSB-first convention (bit 7 = leftmost of the 8 pixels in a byte), matching the
 * bit-serial shift-register VGA output described in the manual's "Video Graphics
 * Adapter" section. If your build's character set/graphics look mirrored horizontally
 * within each 8-pixel group, flip `MSB_FIRST` below.
 */

// const MSB_FIRST = false;

// export const VIEWPORT_WIDTH = 400;
// export const VIEWPORT_HEIGHT = 240;
// export const VIEWPORT_START_OFFSET = 0x430c - VRAM_START; // 0x030c
// export const ROW_STRIDE = 64; // bytes per VRAM row (16KB / 256 rows)

const VRAM_VISIBLE_START = 0x430c; // the first non blanking byte;

const colors = [
  {
    off: [0x28, 0x24, 0x20], // off
    on: [0xe8, 0xe4, 0xe0], // on
  },
  {
    on: [51, 255, 51],
    off: [0, 0, 0],
  },
];

export class Vga {
  mem: Memory;
  public pixelData = new Uint8ClampedArray(400 * 240 * 4);
  palette = 0;

  constructor(mem: Memory) {
    this.mem = mem;
  }

  getScreenPixelData() {
    let pixelIndex = 0;
    let addr = VRAM_VISIBLE_START;
    for (let y = 0; y < 240; y++) {
      for (let xByte = 0; xByte < 50; xByte++) {
        let b = this.mem.readVram(addr++);
        for (let pixel = 0; pixel < 8; pixel++) {
          if ((b & 1) == 1) {
            this.pixelData[pixelIndex++] = colors[this.palette].on[0];
            this.pixelData[pixelIndex++] = colors[this.palette].on[1];
            this.pixelData[pixelIndex++] = colors[this.palette].on[2];
          } else {
            this.pixelData[pixelIndex++] = colors[0].off[0];
            this.pixelData[pixelIndex++] = colors[0].off[1];
            this.pixelData[pixelIndex++] = colors[0].off[2];
          }
          this.pixelData[pixelIndex++] = 0xff; // alpha
          b >>= 1;
        }
      }
      addr += 14; // skip the blanking bytes at the end of the row
    }
    return this.pixelData;
  }

  /** Returns 0 or 1 for the pixel at (x, y) within the 400x240 viewport. */
  // getPixel(x: number, y: number): number {
  //   if (x < 0 || x >= VIEWPORT_WIDTH || y < 0 || y >= VIEWPORT_HEIGHT) return 0;
  //   const byteOffset = VIEWPORT_START_OFFSET + y * ROW_STRIDE + (x >> 3);
  //   const byte = this.mem.readVram(byteOffset);
  //   const bitIndex = x & 7;
  //   const mask = MSB_FIRST ? 0x80 >> bitIndex : 1 << bitIndex;
  //   return (byte & mask) !== 0 ? 1 : 0;
  // } 144=

  // /** Renders the full viewport into a flat Uint8Array of 0/1 values, row-major. */
  // renderFrame(): Uint8Array {
  //   const out = new Uint8Array(VIEWPORT_WIDTH * VIEWPORT_HEIGHT);  102
  //   for (let y = 0; y < VIEWPORT_HEIGHT; y++) {
  //     for (let x = 0; x < VIEWPORT_WIDTH; x++) {
  //       out[y * VIEWPORT_WIDTH + x] = this.getPixel(x, y);
  //     }
  //   }
  //   return out;
  // }

  // /**
  //  * Renders the viewport into an RGBA byte buffer (for direct use with a Canvas
  //  * ImageData-like object): 4 bytes per pixel, `on`/`off` are [r,g,b] triples.
  //  */
  // renderRgba(on: [number, number, number] = [51, 255, 51], off: [number, number, number] = [0, 0, 0]) {
  //   const out = new Uint8ClampedArray(VIEWPORT_WIDTH * VIEWPORT_HEIGHT * 4);
  //   const bits = this.renderFrame();
  //   for (let i = 0; i < bits.length; i++) {
  //     const [r, g, b] = bits[i] ? on : off;
  //     out[i * 4] = r;
  //     out[i * 4 + 1] = g;
  //     out[i * 4 + 2] = b;
  //     out[i * 4 + 3] = 255;
  //   }
  //   return out;
  // }
}
