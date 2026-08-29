export interface VariableSymbol {
  kind: "variable";
  address: number;
  type: "int" | "char";
  count: number;
}

export interface FunctionSymbol {
  kind: "function";
  addr: number;
}

export type ScopeSymbol = VariableSymbol | FunctionSymbol;
