grammar MinasmModel

/** A textual representation of a state machine */
entry Program:
  entries+=Entry*;

Entry:
  comment=COMMENT |
  label=Label |
  instruction=Instruction |
  directive=Directive |
  data=Data;

Directive:
  dir=("#emit"|"#mute"|"#page") |
    dir="#org" address=HEX16;

Data:
  items+=DataItem ("," items+=DataItem)*;

DataItem:
  ByteLiteral | WordLiteral | CharLiteral | StringLiteral;

Label:
  name=ID ":";

Instruction:
  op=OPERATOR0 |
  op=OPERATOR1 operands+=Operand |
  op=OPERATOR2 operands+=Operand "," operands+=Operand |
  op=OPERATOR3 operands+=Operand "," operands+=Operand "," operands+=Operand;



OPERATOR0 returns string:
  "NOP"|"OUT"|"INT"|"INK"|"WIN"|"SEC"|"CLC"|"LL0"|"LL1"|"LL2"|"LL3"|"LL4"|"LL5"|"LL6"|"LL7"|"RL0"|"RL1"|
  "RL2"|"RL3"|"RL4"|"RL5"|"RL6"|"RL7"|"RR1"|"LR0"|"LR1"|"LR2"|"LR3"|"LR4"|"LR5"|"LR6"|"LR7"|"NOT"|"NEG"|
  "RTS"|"PHS"|"PLS"|"INC"|"DEC";

OPERATOR1 returns string:
  "LLZ"|"LLB"|"LLV"|"LLW"|"LLQ"|"LLL"|"LRZ"|"LRB"|"RLZ"|"RLB"|"RLV"|"RLW"|"RLQ"|"RLL"|"RRZ"|"RRB"|"NOZ"|
  "NOB"|"NOV"|"NOW"|"NOQ"|"NOL"|"NEZ"|"NEB"|"NEV"|"NEW"|"NEQ"|"NEL"|"ANI"|"ANZ"|"ANB"|"ANT"|"ANR"|"AN.Z"|
  "AN.B"|"ORI"|"ORZ"|"ORB"|"ORT"|"ORR"|"OR.Z"|"OR.B"|"XRI"|"XRZ"|"XRB"|"XRT"|"XRR"|"XR.Z"|"XR.B"|"FNE"|
  "FEQ"|"FCC"|"FCS"|"FPL"|"FMI"|"FGT"|"FLE"|"FPA"|"BNE"|"BEQ"|"BCC"|"BCS"|"BPL"|"BMI"|"BGT"|"BLE"|"JPA"|
  "JPR"|"JAR"|"JPS"|"JAS"|"LDS"|"STS"|"RDR"|"RAP"|"WDR"|"LDI"|"LDZ"|"LDB"|"LDT"|"LDR"|"LAP"|"LAB"|"STZ"|
  "STB"|"STT"|"STR"|"CLZ"|"CLB"|"CLV"|"CLW"|"CLQ"|"CLL"|"INZ"|"INB"|"INV"|"INW"|"INQ"|"INL"|"DEZ"|"DEB"|
  "DEV"|"DEW"|"DEQ"|"DEL"|"ADI"|"ADZ"|"ADB"|"ADT"|"ADR"|"AD.Z"|"AD.B"|"AD.T"|"AD.R"|"ADV"|"ADW"|"ADQ"|"ADL"|
  "SUI"|"SUZ"|"SUB"|"SUT"|"SUR"|"SU.Z"|"SU.B"|"SU.T"|"SU.R"|"SUV"|"SUW"|"SUQ"|"SUL"|"CPI"|"CPZ"|"CPB"|"CPT"|
  "CPR"|"ACI"|"ACZ"|"ACB"|"AC.Z"|"AC.B"|"ACV"|"ACW"|"SCI"|"SCZ"|"SCB"|"SC.Z"|"SC.B"|"SCV"|"SCW";

OPERATOR2 returns string:
  "RDB"|"RZP"|"WDB"|"LZP"|"LZB"|"SZP"|"MIZ"|"MIB"|"MIT"|"MIR"|"MIV"|"MIW"|"MZZ"|"MZB"|"MBZ"|"MBB"|"MVV"|
  "MWV"|"AIZ"|"AIB"|"AIT"|"AIR"|"AIV"|"AIW"|"AIQ"|"AIL"|"AZZ"|"AZB"|"AZV"|"AZW"|"AZQ"|"AZL"|"ABZ"|"ABB"|
  "ABV"|"ABW"|"ABQ"|"AVV"|"SIZ"|"SIB"|"SIT"|"SIR"|"SIV"|"SIW"|"SIQ"|"SIL"|"SZZ"|"SZB"|"SZV"|"SZW"|"SZQ"|
  "SZL"|"SBZ"|"SBB"|"SBV"|"SBW"|"SBQ"|"SVV"|"CIZ"|"CIB"|"CIT"|"CIR"|"CZZ"|"CZB"|"CBZ"|"CBB";

OPERATOR3 returns string:
  "RZP";

Operand:
  Expression;

Expression:
  Addition;

Addition infers Expression:
  Primary ({infer BinaryExpression.left=current} operator=("+"|"-") right=Primary)*;

Primary infers Expression:
  ByteLiteral | 
  WordLiteral | 
  CharLiteral | 
  StringLiteral |
  LabelReference;

CharLiteral:
  value=CHAR;

StringLiteral:
  value=STRING;

LabelReference:
  byteSelector=("<"|">")? label=[Label:ID];

ByteLiteral:
  value=(HEX8 | DECI);

WordLiteral:
  value=HEX16;

terminal HEX16 returns number: /0x[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]/;
terminal HEX8 returns number: /0x[0-9A-Fa-f][0-9A-Fa-f]/;
terminal DECI returns number: /[0-9]+/;
terminal COMMENT: /;[^\n]*/;
terminal CHAR: /'([^'\\]|\\.)'/;
terminal STRING: /"(\\.|[^"\\])*"|'(\\.|[^'\\])*'/;
terminal ID: /[a-zA-Z_][a-zA-Z0-9_]*/;
hidden terminal WS: /\s+/;
