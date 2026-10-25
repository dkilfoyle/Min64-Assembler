import type { Expression } from "../../ls/generated/ast";
import type { IExpressionType } from "./variables";

class Cache {
  z_A: { id: string; type: IExpressionType } | null = null;
  z_PTR: { id: string; type: IExpressionType } | null = null;
  reset() {
    this.z_A = null;
    this.z_PTR = null;
  }
  isZA(e: Expression): boolean {
    return this.z_A !== null && this.z_A.id === e.$cstNode!.text;
  }
  isZPTR(name: string): boolean {
    return this.z_PTR !== null && this.z_PTR.id === name;
  }
  setZA(e: Expression | string, type: IExpressionType): void {
    this.z_A = { id: typeof e === "string" ? e : e.$cstNode!.text, type };
  }
  unsetZA() {
    this.z_A = null;
  }
  setZPTR(name: string, type: IExpressionType): void {
    this.z_PTR = { id: name, type };
  }
  unsetZPTR() {
    this.z_PTR = null;
  }
}

export const cached = new Cache();
