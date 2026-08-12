import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { devtools } from "zustand/middleware";
import type { AsmCompileResult } from "../minasm/worker/api";

interface State {
  compiledAsm: Record<string, AsmCompileResult>;
}

type Actions = {
  addCompiledAsm: (result: AsmCompileResult) => void;
};

export const useDocStore = create<State & Actions>()(
  devtools(
    immer((set) => ({
      compiledAsm: {},

      addCompiledAsm: (result: AsmCompileResult) =>
        set((state) => {
          state.compiledAsm[result.uri] = result;
        }),
    })),
  ),
);
