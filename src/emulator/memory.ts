import { cpu } from "./cpu";
import { Register8 } from "./register";
import { labelToAddress } from "./symbols";

export class Memory {
  // Memory implementation
  private flash: Uint8Array = new Uint8Array(0x80000); // 512KB of flash memory
  private ram: Uint8Array = new Uint8Array(0x10000); // 64KB of RAM
  public bank = new Register8(); // Bank register for memory banking
  private flashState: number = 0;
  public pixelData = new Uint8ClampedArray(512 * 256 * 4);

  // Lowest 4k can be flash or ram
  // bank selects pages 0..127 4k pages from flash, >= 128 disables flash and maps 64k ram
  // 0x1000 to 0xffff/64k is always ram

  constructor() {}

  async reset() {
    // Initialize memory if needed
    const fileUrl = new URL("../assets/flash.bin", import.meta.url);
    await fetch(fileUrl)
      .then((response) => response.arrayBuffer())
      .then((buffer) => {
        this.flash.set(new Uint8Array(buffer));
      })
      .catch((error) => {
        console.error("Failed to load flash:", error);
      });
    this.bank.reset();
    this.flashState = 0;
    this.ram.fill(0xaa);
  }

  readByte(address: number): number {
    // ram: bank >= 128/0x80 or address >= 4k/0x1000
    if (this.bank.read() & 0x80 || address & 0x1000)
      return this.ram[address & 0xffff]; // RAM access if bank bit is set or address is in RAM range
    else return this.flash[((this.bank.read() & 0x7f) << 12) | (address & 0xfff)]; // Flash access based on bank and address
  }

  readWord(address: number) {
    const low = this.readByte(address & 0xffff);
    const high = this.readByte((address + 1) & 0xffff);
    return (high << 8) | low;
  }

  readLong(address: number) {
    const loword = this.readWord(address);
    const hiword = this.readWord(address + 2);
    return (hiword << 16) | loword;
  }

  writeArray = (address: number, bytes: Uint8Array) => {
    let curaddr = address;
    bytes.forEach((b) => this.writeByte(curaddr++, b));
  };

  writeWord = (address: number, value: number) => {
    this.writeByte(address, value & 0xff);
    this.writeByte(address + 1, (value >> 8) & 0xff);
  };

  writeLong = (address: number, value: number) => {
    this.writeWord(address, value & 0xffff);
    this.writeWord(address + 2, (value >> 16) & 0xffff);
  };

  writeByte = (address: number, value: number) => {
    if (value > 255) debugger;

    if ((this.bank.read() & 0x80) != 0 || (address & 0x1000) != 0)
      this.ram[address & 0xffff] = value & 0xff; // RAM WRITE ACCESS
    else // FLASH WRITE ACCESS
    {
      const adr15 = ((this.bank.read() << 12) | (address & 0x0fff)) & 0x7fff; // FLASH only needs 15 bits
      switch (this.flashState) {
        case 0:
          if (adr15 == 0x5555 && value == 0xaa) this.flashState = 1;
          else this.flashState = 0;
          break;
        case 1:
          if (adr15 == 0x2aaa && value == 0x55) this.flashState = 2;
          else this.flashState = 0;
          break;
        case 2:
          if (adr15 == 0x5555 && value == 0xa0) {
            this.flashState = 3;
            break;
          }
          if (adr15 == 0x5555 && value == 0x80) {
            this.flashState = 4;
            break;
          }
          this.flashState = 0;
          break;
        case 3:
          this.flash[(this.bank.read() << 12) | (address & 0x0fff)] &= value & 0xff;
          this.flashState = 0;
          break; // write operation only writes 1->0, not 0->1
        case 4:
          if (adr15 == 0x5555 && value == 0xaa) this.flashState = 5;
          else this.flashState = 0;
          break;
        case 5:
          if (adr15 == 0x2aaa && value == 0x55) this.flashState = 6;
          else this.flashState = 0;
          break;
        case 6:
          for (let i = 0; i < 0x1000; i++) this.flash[(this.bank.read() << 12) | i] = 0xff; // sector erase operation
          this.flashState = 0;
          break;
        default:
          this.flashState = 0;
          break;
      }
    }
  };

  debugVar(size: 1 | 2, name: string) {
    if (size == 1) {
      const val = this.readByte(labelToAddress[name]);
      console.log(name, val.toString(16), val);
    }
    if (size == 2) {
      const val = this.readWord(labelToAddress[name]);
      console.log(name, val.toString(16), val);
    }
  }

  getVRAMImage() {
    let pixelIndex = 0;
    for (let addr = 0x4000; addr < 0x8000; addr++) {
      let b = this.readByte(addr);
      for (let pixel = 0; pixel < 8; pixel++) {
        if ((b & 1) == 1) {
          this.pixelData[pixelIndex++] = 0xe8;
          this.pixelData[pixelIndex++] = 0xe4;
          this.pixelData[pixelIndex++] = 0xe0;
        } else {
          this.pixelData[pixelIndex++] = 0x28;
          this.pixelData[pixelIndex++] = 0x24;
          this.pixelData[pixelIndex++] = 0x20;
        }
        this.pixelData[pixelIndex++] = 0xff; // alpha
        b >>= 1;
      }
    }
    return this.pixelData;
  }

  loadIntelHex(hexString: string) {
    const lines = hexString.split(/\r?\n/);
    let upperAddressOffset = 0; // Tracks 32-bit linear address shifts

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      if (!line.startsWith(":")) throw new Error(`Line ${i + 1} does not start with a colon.`);

      // Extract structural metadata
      const byteCount = parseInt(line.substring(1, 3), 16);
      const lowerAddress = parseInt(line.substring(3, 7), 16);
      const recordType = parseInt(line.substring(7, 9), 16);

      // Extract raw data segment
      const dataBytes = [];
      for (let b = 0; b < byteCount; b++) {
        const startIdx = 9 + b * 2;
        dataBytes.push(parseInt(line.substring(startIdx, startIdx + 2), 16));
      }

      // Validate Checksum (Two's complement of the sum of preceding bytes)
      const suppliedChecksum = parseInt(line.substring(9 + byteCount * 2, 11 + byteCount * 2), 16);
      let calculatedSum = byteCount + (lowerAddress >> 8) + (lowerAddress & 0xff) + recordType;
      dataBytes.forEach((byte) => (calculatedSum += byte));

      if (((calculatedSum + suppliedChecksum) & 0xff) !== 0) {
        throw new Error(`Checksum validation failed on line ${i + 1}`);
      }

      // Handle structural records vs data records
      if (recordType === 0) {
        // Data Record: Map target absolute memory location
        const absoluteAddress = upperAddressOffset + lowerAddress;
        // console.log("Writing to", absoluteAddress.toString(16), dataBytes);
        this.writeArray(absoluteAddress, new Uint8Array(dataBytes));
      } else if (recordType === 1) {
        // End of File Record
        break;
      } else if (recordType === 4) {
        // Extended Linear Address Record: shift base address for upper 16 bits
        upperAddressOffset = ((dataBytes[0] << 8) | dataBytes[1]) << 16;
      }
      // Types 02, 03, and 05 can be added here if your hardware environment utilizes them
    }
  }
}
