import { OPCODE_TABLE } from './opcodeTable';
import { Memory } from './memory';

export interface DisassembledInstruction {
  address: number;
  opcode: number;
  mnemonic: string;
  operandBytes: number[];
  text: string; // e.g. "LDI 0x40" or "JPA 0x1000"
  length: number; // 1 + operandBytes.length
}

/**
 * Disassembles a single instruction starting at `address`, reading through the given
 * memory's CPU-visible bus (i.e. respecting the current BANK window, so disassembling
 * FLASH-resident code works the same way the CPU would fetch it).
 */
export function disassembleOne(mem: Memory, address: number): DisassembledInstruction {
  const opcode = mem.read(address) & 0xff;
  const info = OPCODE_TABLE[opcode];
  const operandBytes: number[] = [];
  for (let i = 0; i < info.operandBytes; i++) {
    operandBytes.push(mem.read((address + 1 + i) & 0xffff));
  }
  const operandText = operandBytes.map((b) => '0x' + b.toString(16).padStart(2, '0')).join(',');
  const text = operandText ? `${info.mnemonic} ${operandText}` : info.mnemonic;
  return {
    address,
    opcode,
    mnemonic: info.mnemonic,
    operandBytes,
    text,
    length: 1 + info.operandBytes,
  };
}

/** Disassembles `count` consecutive instructions starting at `address`. */
export function disassembleRange(mem: Memory, address: number, count: number): DisassembledInstruction[] {
  const out: DisassembledInstruction[] = [];
  let addr = address;
  for (let i = 0; i < count; i++) {
    const instr = disassembleOne(mem, addr);
    out.push(instr);
    addr = (addr + instr.length) & 0xffff;
  }
  return out;
}

export { OPCODE_TABLE } from './opcodeTable';
export type { OpcodeInfo } from './opcodeTable';
