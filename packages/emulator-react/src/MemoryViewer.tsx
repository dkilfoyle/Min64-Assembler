import type { IEmulationState } from "./emulator14/machine";

interface IMemoryRowProps {
  rowAddress: number;
  memory: Uint8Array;
  addrTarget: number;
  addrTargetEnd: number;
  addrHover: number | null;
  setAddrHover: (addr: number | null) => void;
}

const MemoryRow = ({ rowAddress, memory }: { rowAddress: number; memory: Uint8Array }) => {
  return (
    <div className="memory-row">
      <div className="memory-row-address">{rowAddress.toString(16).padStart(4, "0").toUpperCase()}</div>
      <div className="memory-row-bytes">
        {Array.from(memory.slice(rowAddress, rowAddress + 16)).map((byte, index) => (
          <div
            key={index}
            onMouseEnter={() => {
              setAddrHover(rowAddress + index);
            }}
            onMouseLeave={() => {
              setAddrHover(null);
            }}
            className={clsx("memory-cell", {
              "memory-cell-target": rowAddress + index >= addrTarget && rowAddress + index <= addrTargetEnd,
              "memory-cell-hover": addrHover !== null && rowAddress + index === addrHover,
            })}>
            {byte.toString(16).padStart(2, "0").toUpperCase()}
          </div>
        ))}
      </div>
      <div className="memory-row-chars">
        {Array.from(memory.slice(rowAddress, rowAddress + 16)).map((byte, index) => (
          <div key={index} className="memory-cell">
            {String.fromCharCode(byte || 46)}
          </div>
        ))}
      </div>
    </div>
  );
};

export function EmulationStateViewer({ es }: { es: IEmulationState }) {
  es.memory;
}
