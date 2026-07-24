import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { devtools } from "zustand/middleware";

interface IDoc {
  path: string;
  hex: string;
}

interface State {
  docs: Record<string, IDoc>;
}

type Actions = {
  addDoc: (path: string) => void;
  setHex: (path: string, hex: string) => void;
};

export const useDocStore = create<State & Actions>()(
  devtools(
    immer((set) => ({
      docs: {
        demo: {
          path: "demo.asm",
          hex: "blank",
        },
      },

      addDoc: (path: string) =>
        set((state) => {
          state.docs[path] = { path, hex: "bla" };
        }),

      setHex: (path: string, hex: string) =>
        set((state) => {
          state.docs[path].hex = hex;
          console.log("setting hex", hex, state.docs["demo"].hex);
        }),
    })),
  ),
);
