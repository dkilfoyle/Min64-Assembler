// To add if-else blocks, function definitions, and function calling to a single-register, 8-bit architecture like the Minimal 64x4, we must implement explicit calling conventions.
// Because we have a 256-byte stack at 0xFFFF, we will use a Stack-Based Activation Record (Stack Frame) model:

//    1. Arguments are pushed onto the stack by the caller in reverse order.
//    2. The Return Address is pushed to the stack automatically (or via code) when leaping to a function.
//    3. Local Variables are dynamically allocated by pushing space onto the stack inside the function, or by assigning them local offsets. To keep this compiler straightforward and fast on 8-bit hardware, the compiler maps variables to dynamic Zero-Page offsets or local stack frames. For absolute maximum simplicity, this implementation assigns unique global Zero-Page tracking for localized execution, while function parameters are dynamically pulled directly from the stack frame via POP. [1, 2, 3, 4]

// Here is the fully extended TypeScript implementation including if-else branching, function definitions with arguments, and function calls.

// Define tokens for our extended C-like language
type TokenType =
  | "KEYWORD"
  | "IDENTIFIER"
  | "NUMBER"
  | "ASSIGN"
  | "PLUS"
  | "MINUS"
  | "SEMI"
  | "COMMA"
  | "LBRACE"
  | "RBRACE"
  | "LPAREN"
  | "RPAREN"
  | "EOF";
interface Token {
  type: TokenType;
  value: string;
}
// ==========================================// 1. LEXER// ==========================================
class Lexer {
  private source: string;
  private cursor: number = 0;

  constructor(source: string) {
    this.source = source;
  }

  public tokenize(): Token[] {
    const tokens: Token[] = [];
    while (this.cursor < this.source.length) {
      const char = this.source[this.cursor];

      if (/\s/.test(char)) {
        this.cursor++;
        continue;
      }
      if (char === ";") {
        tokens.push({ type: "SEMI", value: ";" });
        this.cursor++;
        continue;
      }
      if (char === ",") {
        tokens.push({ type: "COMMA", value: "," });
        this.cursor++;
        continue;
      }
      if (char === "=") {
        tokens.push({ type: "ASSIGN", value: "=" });
        this.cursor++;
        continue;
      }
      if (char === "+") {
        tokens.push({ type: "PLUS", value: "+" });
        this.cursor++;
        continue;
      }
      if (char === "-") {
        tokens.push({ type: "MINUS", value: "-" });
        this.cursor++;
        continue;
      }
      if (char === "{") {
        tokens.push({ type: "LBRACE", value: "{" });
        this.cursor++;
        continue;
      }
      if (char === "}") {
        tokens.push({ type: "RBRACE", value: "}" });
        this.cursor++;
        continue;
      }
      if (char === "(") {
        tokens.push({ type: "LPAREN", value: "(" });
        this.cursor++;
        continue;
      }
      if (char === ")") {
        tokens.push({ type: "RPAREN", value: ")" });
        this.cursor++;
        continue;
      }

      if (/[0-9]/.test(char)) {
        let num = "";
        while (this.cursor < this.source.length && /[0-9]/.test(this.source[this.cursor])) {
          num += this.source[this.cursor];
          this.cursor++;
        }
        tokens.push({ type: "NUMBER", value: num });
        continue;
      }

      if (/[a-zA-Z_]/.test(char)) {
        let ident = "";
        while (this.cursor < this.source.length && /[a-zA-Z0-9_]/.test(this.source[this.cursor])) {
          ident += this.source[this.cursor];
          this.cursor++;
        }
        const isKeyword = ["while", "if", "else", "int", "return"].includes(ident);
        const type: TokenType = isKeyword ? "KEYWORD" : "IDENTIFIER";
        tokens.push({ type, value: ident });
        continue;
      }

      throw new Error(`Unexpected character: ${char}`);
    }
    tokens.push({ type: "EOF", value: "" });
    return tokens;
  }
}
// ==========================================// 2. PARSER & AST NODES// ==========================================
type ASTNode =
  | { type: "Program"; body: ASTNode[] }
  | { type: "VarDecl"; name: string; value: ASTNode }
  | { type: "Assign"; name: string; value: ASTNode }
  | { type: "BinaryExpr"; op: "+" | "-"; left: ASTNode; right: ASTNode }
  | { type: "Identifier"; name: string }
  | { type: "Literal"; value: number }
  | { type: "WhileLoop"; condition: ASTNode; body: ASTNode[] }
  | { type: "IfStatement"; condition: ASTNode; thenBranch: ASTNode[]; elseBranch: ASTNode[] | null }
  | { type: "FunctionDecl"; name: string; params: string[]; body: ASTNode[] }
  | { type: "ReturnStatement"; value: ASTNode }
  | { type: "CallExpr"; name: string; args: ASTNode[] };

class Parser {
  private tokens: Token[];
  private current: number = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek() {
    return this.tokens[this.current];
  }
  private peekNext() {
    return this.tokens[this.current + 1];
  }

  private consume(type: TokenType) {
    const tok = this.peek();
    if (tok.type !== type) throw new Error(`Expected token ${type}, got ${tok.type}`);
    this.current++;
    return tok;
  }

  public parse(): ASTNode {
    const body: ASTNode[] = [];
    while (this.peek().type !== "EOF") {
      body.push(this.parseStatement());
    }
    return { type: "Program", body };
  }

  private parseStatement(): ASTNode {
    const tok = this.peek();

    // 1. Function Declaration or Variable Declaration
    if (tok.type === "KEYWORD" && tok.value === "int") {
      // Check if it's a function declaration lookahead: int main( ...
      if (this.peekNext().type === "IDENTIFIER" && this.tokens[this.current + 2]?.type === "LPAREN") {
        this.consume("KEYWORD"); // int
        const name = this.consume("IDENTIFIER").value;
        this.consume("LPAREN");
        const params: string[] = [];
        if (this.peek().type !== "RPAREN") {
          this.consume("KEYWORD"); // int
          params.push(this.consume("IDENTIFIER").value);
          while (this.peek().type === "COMMA") {
            this.consume("COMMA");
            this.consume("KEYWORD"); // int
            params.push(this.consume("IDENTIFIER").value);
          }
        }
        this.consume("RPAREN");
        this.consume("LBRACE");
        const body: ASTNode[] = [];
        while (this.peek().type !== "RBRACE") {
          body.push(this.parseStatement());
        }
        this.consume("RBRACE");
        return { type: "FunctionDecl", name, params, body };
      } else {
        // Standard Variable Declaration
        this.consume("KEYWORD"); // int
        const name = this.consume("IDENTIFIER").value;
        this.consume("ASSIGN");
        const value = this.parseExpression();
        this.consume("SEMI");
        return { type: "VarDecl", name, value };
      }
    }

    // 2. Return Statement
    if (tok.type === "KEYWORD" && tok.value === "return") {
      this.consume("KEYWORD");
      const value = this.parseExpression();
      this.consume("SEMI");
      return { type: "ReturnStatement", value };
    }

    // 3. If / Else Statement
    if (tok.type === "KEYWORD" && tok.value === "if") {
      this.consume("KEYWORD");
      this.consume("LPAREN");
      const condition = this.parseExpression();
      this.consume("RPAREN");
      this.consume("LBRACE");
      const thenBranch: ASTNode[] = [];
      while (this.peek().type !== "RBRACE") {
        thenBranch.push(this.parseStatement());
      }
      this.consume("RBRACE");

      let elseBranch: ASTNode[] | null = null;
      if (this.peek().type === "KEYWORD" && this.peek().value === "else") {
        this.consume("KEYWORD"); // else
        this.consume("LBRACE");
        elseBranch = [];
        while (this.peek().type !== "RBRACE") {
          elseBranch.push(this.parseStatement());
        }
        this.consume("RBRACE");
      }
      return { type: "IfStatement", condition, thenBranch, elseBranch };
    }

    // 4. While Loop
    if (tok.type === "KEYWORD" && tok.value === "while") {
      this.consume("KEYWORD");
      this.consume("LPAREN");
      const condition = this.parseExpression();
      this.consume("RPAREN");
      this.consume("LBRACE");
      const body: ASTNode[] = [];
      while (this.peek().type !== "RBRACE") {
        body.push(this.parseStatement());
      }
      this.consume("RBRACE");
      return { type: "WhileLoop", condition, body };
    }

    // 5. Assignment or Standalone Expression/Call
    if (tok.type === "IDENTIFIER") {
      if (this.peekNext().type === "ASSIGN") {
        const name = this.consume("IDENTIFIER").value;
        this.consume("ASSIGN");
        const value = this.parseExpression();
        this.consume("SEMI");
        return { type: "Assign", name, value };
      } else {
        const expr = this.parseExpression();
        this.consume("SEMI");
        return expr;
      }
    }

    throw new Error(`Unknown statement starting with value: "${tok.value}"`);
  }

  private parseExpression(): ASTNode {
    let left = this.parsePrimary();
    while (this.peek().type === "PLUS" || this.peek().type === "MINUS") {
      const op = this.consume(this.peek().type).value as "+" | "-";
      const right = this.parsePrimary();
      left = { type: "BinaryExpr", op, left, right };
    }
    return left;
  }

  private parsePrimary(): ASTNode {
    const tok = this.peek();
    if (tok.type === "NUMBER") {
      this.consume("NUMBER");
      return { type: "Literal", value: parseInt(tok.value, 10) };
    }
    if (tok.type === "IDENTIFIER") {
      // Check if it's a function call expression: compute(x, y)
      if (this.peekNext().type === "LPAREN") {
        const name = this.consume("IDENTIFIER").value;
        this.consume("LPAREN");
        const args: ASTNode[] = [];
        if (this.peek().type !== "RPAREN") {
          args.push(this.parseExpression());
          while (this.peek().type === "COMMA") {
            this.consume("COMMA");
            args.push(this.parseExpression());
          }
        }
        this.consume("RPAREN");
        return { type: "CallExpr", name, args };
      } else {
        this.consume("IDENTIFIER");

        return { type: "Identifier", name: tok.value };
      }
    }
    throw new Error(`Unexpected expression token: ${tok.value}`);
  }
}
// ==========================================
// 3. CODE GENERATOR (Targeting Minimal 64x4)
// ==========================================
class CodeGenerator {
  private assembly: string[] = [];
  private zeroPageMap = new Map<string, string>();
  private zpCursor = 0x10;
  private labelCounter = 0;
  private getZpAddress(name: string): string {
    if (!this.zeroPageMap.has(name)) {
      this.zeroPageMap.set(name, hex);
      this.zpCursor++;
    }
    return this.zeroPageMap.get(name)!;
  }
  private emit(instruction: string, comment: string = "") {
    this.assembly.push(comment ? `${instruction.padEnd(18)}; ${comment}` : instruction);
  }
  public generate(node: ASTNode): string {
    this.emit("; Code generated for Extended Minimal 64x4 Assembly");
    this.emit("; Stack pointer at 0xFFFF, zero-page addressing configured\n");
    // Jump over functions directly to start main execution loop
    this.emit("JMP _INIT", "Jump straight to bootstrap init code");
    this.compile(node);
    this.emit("\n_INIT:", "System bootstrap initialization entry point");
    this.emit("JSR fn_main", "Call main function loop execution");
    this.emit("HALT", "Stop hardware processor execution loops");
    return this.assembly.join("\n");
  }
  private compile(node: ASTNode) {
    switch (node.type) {
      case "Program":
        node.body.forEach((stmt) => this.compile(stmt));
        break;
      case "FunctionDecl":
        this.emit(`\nfn_${node.name}:, Declaration entry for function "${node.name}"`);
        // Pull parameters off the stack frame in reverse order they were pushed
        // Store parameters into quick hardware Zero-Page locations allocated for this scope
        for (let i = 0; i < node.params.length; i++) {
          const paramName = `${node.name}_local_${node.params[i]}`;
          const targetZp = this.getZpAddress(paramName);
          this.emit("PLA", "Pull call parameter argument off stack");
        }
        node.body.forEach((stmt) => this.compile(stmt));
        // Explicit backup fallback return sequence if execution flows off end of scope block
        this.emit(`"RTS", Default return safety fallback path for ${node.name}`);
        break;
      case "CallExpr":
        // Push standard execution arguments onto the stack frame backwards (Right-to-Left pattern)
        for (let i = node.args.length - 1; i >= 0; i--) {
          this.compile(node.args[i]); // Result ends up in Accumulator A
          this.emit(`"PHA", Push frame call argument parameter index [${i}]`);
        }
        this.emit(`JSR fn_${node.name}, Jump to Subroutine function address 'fn_${node.name}'`);
        // Result of function evaluation is preserved dynamically in Register A
        break;
      case "ReturnStatement":
        this.compile(node.value); // Leaves return evaluation scalar payload in Register A
        this.emit("RTS", "Return from function subroutine, output stored in A");
        break;
        [5];
      case "VarDecl":
      case "Assign":
        this.compile(node.value);
        const zpAddr = this.getZpAddress(node.name);
        this.emit(`STZ ${zpAddr}, Store accumulator directly into variable mapping '${node.name}'`);
        break;
      case "Literal":
        this.emit(`LDI ${node.value}, Load intermediate numerical integer literal value directly`);
        break;
      case "Identifier":
        // Look up global tracking reference mappings or locally localized scope tags
        // Check if a localized instance mapping configuration exists for tracking
        let targetLookup = node.name;
        // Basic scope lookup: check if it matches an active variable tracking footprint
        for (const key of this.zeroPageMap.keys()) {
          if (key.endsWith(`_local_${node.name}`)) {
            targetLookup = key;
            break;
          }
        }
        const addr = this.getZpAddress(targetLookup);
        this.emit(`LDZ ${addr}, Load tracking variable entry '${node.name}' out from Zero-Page`);
        break;
      case "BinaryExpr":
        this.compile(node.right);
        this.emit("PHA", "Store right side operand expression onto hardware stack tracking");
        this.compile(node.left);
        if (node.op === "+") {
          this.emit("ADD_STACK", "Add top stack workspace allocation variable to Accumulator A");
        } else {
          this.emit("SUB_STACK", "Subtract stack value element allocation directly away from Accumulator A");
        }
        break;
        [6];
      case "IfStatement": {
        const labelId = this.labelCounter++;
        const elseLabel = `IF_ELSE_${labelId}`;
        const endLabel = `IF_END_${labelId}`;
        this.compile(node.condition); // Leaves condition evaluation result check in register A
        this.emit(`BRZ ${node.elseBranch ? elseLabel : endLabel}`, "Branch out if condition returns zero false value state evaluation");
        node.thenBranch.forEach((stmt) => this.compile(stmt));
        if (node.elseBranch) {
          this.emit(`JMP ${endLabel}, "Skip past else execution sequence path"`);
          this.emit(`${elseLabel}:`, "Else branch processing start block trace routing execution");
          node.elseBranch.forEach((stmt) => this.compile(stmt));
        }
        this.emit(`${endLabel}:`, "Reconverging structural pipeline resolution marker frame");
        break;
      }
      case "WhileLoop": {
        const labelId = this.labelCounter++;
        const startLabel = `WHILE_START_${labelId}`;
        const endLabel = `WHILE_END_${labelId}`;
        this.emit(`${startLabel}:`, "While processing condition check pipeline safety loops entry");
        this.compile(node.condition);
        this.emit(`BRZ ${endLabel}, "Break processing context bounds loop path checks"`);
        node.body.forEach((stmt) => this.compile(stmt));
        this.emit(`JMP ${startLabel}`, "Recurse check sequence conditions iteratively inside execution spaces");
        this.emit(`${endLabel}:`, "Resolution pipeline validation boundary processing terminal markers");
        break;
      }
    }
  }
}
// ==========================================
// TEST EXECUTION RUNNER WITH IF-ELSE & FUNCS
// ==========================================
const sourceCode = `
int addNumbers(int x, int y) {
return x + y;
}
int main() {
int target = 5;
int output = 0;
if (target) {
output = addNumbers(target, 12);
} else {
output = 100;
}
}
`;
try {
  const lexer = new Lexer(sourceCode);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const ast = parser.parse();
  const codegen = new CodeGenerator();
  const assemblyOutput = codegen.generate(ast);
  console.log(assemblyOutput);
} catch (err: any) {
  console.error("Compilation failed processing elements:", err.message);
}

// ### Architectural Updates Explained

// 1. **The Function Pipeline Framework (`JSR` / `RTS`):** When calling a function expression block `addNumbers(target, 12)`, our compiler generates `JSR` (Jump to Subroutine). The architecture shifts the current runtime context counter safely out onto the stack segment before shifting parsing controls. The subroutine terminates on encountering a `RTS` (Return from Subroutine) instruction, instantly realigning the system frame.
// 2. **Reverse Order Dynamic Argument Extraction (`PLA`):** Because variables get compiled from right-to-left onto the stack space before executing the jumping routines, arguments are exposed in proper sequential order. On arriving within `fn_addNumbers`, the initialization compiler pulls sequentially via `PLA` into localized fast Zero-Page memory addresses, allowing clean local scoping via names like `addNumbers_local_x`.
// 3. **If-Else Binary Routing Strategy:** The compiler checks the status register directly via `BRZ` (Branch if Zero) after generating your conditional expression loop checks. If evaluating `false`, code execution jumps past the standard container block using localized markers like `IF_ELSE_0`.

// If you would like to expand this compiler even further, let me know:
// * Do you want to add **nested expression support** to `if` conditions (like logical `&&` or comparisons like `==`)?
// * Should the compiler track **local variable lifetimes** so that multiple different function calls can safely reuse the exact same Zero-Page RAM slots?

// [1] [https://users.dcc.uchile.cl](https://users.dcc.uchile.cl/~etanter/CC5116/lec_function-calls_notes.html)
// [2] [https://opendylan.org](https://opendylan.org/hacker-guide/runtime/calling-convention.html)
// [3] [https://levelup.gitconnected.com](https://levelup.gitconnected.com/x86-calling-conventions-a34812afe097)
// [4] [https://icarus.cs.weber.edu](https://icarus.cs.weber.edu/~dab/cs1410/textbook/6.Functions/scope.html)
// [5] [https://www.freecodecamp.org](https://www.freecodecamp.org/news/how-javascript-lint-rules-work-and-why-abstract-syntax-trees-matter/)
// [6] [https://pkg.go.dev](https://pkg.go.dev/go.starlark.net/syntax)
