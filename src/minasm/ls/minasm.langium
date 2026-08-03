grammar MinasmModel

entry Program:
  entries+=Entry*;

Entry:
  Comment |
  Label |
  Instruction |
  Directive |
  Data;

Comment:
  comment=COMMENT;

Directive:
  dir=("#emit"|"#mute"|"#page") |
  (dir="#org" address=HEX16);

Label:
  name=LABELID;

Data:
  items+=Expression ("," items+=Expression)* ","?;

Instruction:
  op=OPERATOR;

OPERATOR returns string:
  "NOP"|"OUT"|"INT"|"INK"|"WIN"|"LL0"|"LL1"|"LL2"|"LL3"|"LL4"|"LL5"|"LL6"|"LL7"|"RL0"|"RL1"|"RL2"|"RL3"|"RL4"|"RL5"|"RL6"|"RL7"|"RR1"|"LR0"|"LR1"|"LR2"|"LR3"|"LR4"|"LR5"|"LR6"|"LR7"|"LLZ"|"LLB"|"LLV"|"LLW"|"LLQ"|"LLL"|"LRZ"|"LRB"|
  "RLZ"|"RLB"|"RLV"|"RLW"|"RLQ"|"RLL"|"RRZ"|"RRB"|"NOT"|"NOZ"|"NOB"|"NOV"|"NOW"|"NOQ"|"NEG"|"NEZ"|"NEB"|"NEV"|"NEW"|"NEQ"|"ANI"|"ANZ"|"ANB"|"ANT"|"ANR"|"AN.Z"|
  "AN.B"|"AN.T"|"AN.R"|"ORI"|"ORZ"|"ORB"|"ORT"|"ORR"|"OR.Z"|"OR.B"|"OR.T"|"OR.R"|"XRI"|"XRZ"|"XRB"|"XRT"|"XRR"|"XR.Z"|"XR.B"|"XR.T"|"XR.R"|"FNE"|"FEQ"|"FCC"|"FCS"|"FPL"|"FMI"|"FGT"|"FLE"|"FPA"|"BNE"|"BEQ"|"BCC"|
  "BCS"|"BPL"|"BMI"|"BGT"|"BLE"|"JPA"|"JPR"|"JAR"|"JPS"|"JAS"|"RTS"|"PHS"|"PLS"|"LDS"|"SDS"|"RDB"|"RDR"|"RAP"|"RZP"|"WDB"|"WDR"|"LDI"|"LDZ"|"LDB"|"LDT"|"LDR"|"LAP"|"LAB"|"LZP"|"LZB"|"SDZ"|
  "SDB"|"SDT"|"SDR"|"SZP"|"MIZ"|"MIB"|"MIT"|"MIR"|"MIV"|"MIW"|"MZZ"|"MZB"|"MZT"|"MZR"|"MBZ"|"MBB"|"MBT"|"MBR"|"MTZ"|"MTB"|"MTT"|"MTR"|"MRZ"|"MRB"|"MRT"|"MRR"|"MVV"|"MWV"|"CLD"|"CLZ"|
  "CLB"|"CLV"|"CLW"|"CLQ"|"CLL"|"CL5"|"INC"|"INZ"|"INB"|"INV"|"INW"|"INQ"|"DEC"|"DEZ"|"DEB"|"DEV"|"DEW"|"DEQ"|"ADI"|"ADZ"|"ADB"|"ADT"|"ADR"|"AD.Z"|
  "AD.B"|"AD.T"|"AD.R"|"ADV"|"ADW"|"ADQ"|"AIZ"|"AIB"|"AIT"|"AIR"|"AIV"|"AIW"|"AIQ"|"AZZ"|"AZT"|"AZV"|"AZQ"|"ABB"|"ABW"|"ATZ"|"ATT"|"AVV"|"SUI"|"SUZ"|"SUB"|"SUT"|"SUR"|"SU.Z"|
  "SU.B"|"SU.T"|"SU.R"|"SUV"|"SUW"|"SUQ"|"SIZ"|"SIB"|"SIT"|"SIR"|"SIV"|"SIW"|"SIQ"|"SZZ"|"SZT"|"SZV"|"SZQ"|"SBB"|"SBW"|"STZ"|"STT"|"SVV"|"CPI"|"CPZ"|"CPB"|"CPT"|"CPR"|"CIZ"|"CIB"|"CIT"|"CIR"|
  "CIV"|"CIW"|"CZZ"|"CZT"|"CBB"|"CTZ"|"CTT"|"CVV"|"ACI"|"ACZ"|"AC.Z"|"SCI"|"SCZ"|"SC.Z";

Expression:
  Addition;

Addition infers Expression:
  (MenmonicLiteral {infer BinaryExpression.left=current} operator=("+"|"-") right=Primary) |
  (Primary ({infer BinaryExpression.left=current} operator=("+"|"-") right=Primary)*);

Primary infers Expression:
  ImmediateByteLiteral | 
  ImmediateWordLiteral | 
  Address |
  StringLiteral |
  UnaryExpression;

MenmonicLiteral:
  value=OPERATOR;

Address:
  LabelReference | StarLiteral;

UnaryExpression:
  operator=("<"|">") expr=Expression;

LabelReference:
  label=[Label:LABELREF];

ImmediateByteLiteral:
  neg?="-"? value=(HEX8 | DECI);

ImmediateWordLiteral:
  neg?="-"? value=HEX16;

StarLiteral:
  value="*";

StringLiteral:
  value=STRING;

// terminal STRING: /"(\\.|[^"])*"|'(\\.|[^'])*'/;
terminal STRING:  /"([^"])*"|'([^'])*'/;
terminal HEX16 returns number: /0x[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]?/;
terminal HEX8 returns number: /0x[0-9A-Fa-f][0-9A-Fa-f]/;
terminal DECI returns number: /[0-9]+/;
terminal COMMENT: /;[^\n]*/;
terminal LABELID: /[a-zA-Z_][a-zA-Z0-9_]*:/;
terminal LABELREF: /[a-zA-Z_][a-zA-Z0-9_]*/;
hidden terminal WS: /\s+/;