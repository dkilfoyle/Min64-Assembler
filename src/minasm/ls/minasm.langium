grammar MinasmModel

/** A textual representation of a state machine */
entry Program:
  lines+=Line*;

Line:
  comment=COMMENT |
  label=Label |
  instruction=Instruction |
  directive=Directive |
  bytes=Bytes;

Bytes:
  data+=NumberLit ("," data+=NumberLit)*;

Label:
  name=ID ":";

Instruction:
  op=OPERATOR (operands+=Operand ("," operands+=Operand)*)?;

Directive:
  dir=("#emit"|"#mute"|"#page") |
    dir="#org" address=HEX;

OPERATOR returns string:
  "INT"|"INK"|"WIN"|"SEC"|"CLC"|"LL0"|"LL1"|"LL2"|"LL3"|"LL4"|"LL5"|"LL6"|"LL7"|"RL0"|"RL1"|"RL2"|"RL3"|"RL4"|"RL5"|"RL6"|"RL7"|"RR1"|"LR0"|"LR1"|"LR2"|"LR3"|"LR4"|"LR5"|"LR6"|
  "LR7"|"LLZ"|"LLB"|"LLV"|"LLW"|"LLQ"|"LLL"|"LRZ"|"LRB"|"RLZ"|"RLB"|"RLV"|"RLW"|"RLQ"|"RLL"|"RRZ"|"RRB"|"NOT"|"NOZ"|"NOB"|"NOV"|"NOW"|"NOQ"|"NOL"|"NEG"|"NEZ"|"NEB"|"NEV"|"NEW"|"NEQ"|"NEL"|"ANI"|"ANZ"|"ANB"|"ANT"|
  "ANR"|"AN.Z"|"AN.B"|"ORI"|"ORZ"|"ORB"|"ORT"|"ORR"|"OR.Z"|"OR.B"|"XRI"|"XRZ"|"XRB"|"XRT"|"XRR"|"XR.Z"|"XR.B"|"FNE"|"FEQ"|"FCC"|"FCS"|"FPL"|"FMI"|"FGT"|"FLE"|"FPA"|"BNE"|"BEQ"|"BCC"|"BCS"|"BPL"|"BMI"|"BGT"|"BLE"|"JPA"|"JPR"|"JAR"|"JPS"|"JAS"|"RTS"|"PHS"|"PLS"|"LDS"|"STS"|"RDB"|"RDR"|"RAP"|"RZP"|"WDB"|"WDR"|"LDI"|"LDZ"|"LDB"|"LDT"|"LDR"|"LAP"|"LAB"|"LZP"|
  "LZB"|"STZ"|"STB"|"STT"|"STR"|"SZP"|"MIZ"|"MIB"|"MIT"|"MIR"|"MIV"|"MIW"|"MZZ"|"MZB"|"MBZ"|"MBB"|"MVV"|"MWV"|"CLZ"|"CLB"|"CLV"|"CLW"|"CLQ"|"CLL"|"INC"|"INZ"|"INB"|"INV"|"INW"|"INQ"|"INL"|"DEC"|"DEZ"|"DEB"|"DEV"|"DEW"|"DEQ"|"DEL"|"ADI"|"ADZ"|"ADB"|"ADT"|"ADR"|
  "AD.Z"|"AD.B"|"AD.T"|"AD.R"|"ADV"|"ADW"|"ADQ"|"ADL"|"AIZ"|"AIB"|"AIT"|"AIR"|"AIV"|"AIW"|"AIQ"|"AIL"|"AZZ"|"AZB"|"AZV"|"AZW"|"AZQ"|"AZL"|"ABZ"|"ABB"|"ABV"|"ABW"|"ABQ"|"AVV"|"SUI"|"SUZ"|"SUB"|"SUT"|"SUR"|"SU.Z"|"SU.B"|"SU.T"|"SU.R"|"SUV"|"SUW"|"SUQ"|"SUL"|"SIZ"|"SIB"|"SIT"|
  "SIR"|"SIV"|"SIW"|"SIQ"|"SIL"|"SZZ"|"SZB"|"SZV"|"SZW"|"SZQ"|"SZL"|"SBZ"|"SBB"|"SBV"|"SBW"|"SBQ"|"SVV"|"CPI"|"CPZ"|"CPB"|"CPT"|"CPR"|"CIZ"|"CIB"|"CIT"|"CIR"|"CZZ"|"CZB"|"CBZ"|"CBB"|"ACI"|"ACZ"|"ACB"|"AC.Z"|
  "AC.B"|"ACV"|"ACW"|"SCI"|"SCZ"|"SCB"|"SC.Z"|"SC.B"|"SCV"|"SCW";

Operand:
  Expression | string=STRING;

Expression:
  Addition;

Addition infers Expression:
  Primary ({infer BinaryExpression.left=current} operator=("+"|"-") right=Primary)*;

Primary infers Expression:
  NumberLit | label=[Label:ID];

NumberLit:
  value=(HEX | DECI);

terminal HEX: /0x[0-9A-Fa-f]+/;
terminal DECI: /[0-9]+/;
terminal COMMENT: /;[^\n]*/;
terminal STRING: /"(\\.|[^"\\])*"|'(\\.|[^'\\])*'/;
terminal ID: /[a-zA-Z_][a-zA-Z0-9_]*/;
hidden terminal WS: /\s+/;
