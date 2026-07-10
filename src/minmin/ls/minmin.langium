grammar MinminModel

//  Python-style code block indentation (2 SPACES)
// o control structure 'if-elif-else', 'while-break'
// o variables with C-style static explicit typing
// o data types 'char' (8-bit) and 'int' (16-bit)
// o local and global variables, @ address operator
// o 'def-return', C-style '&' variable references
// o 'call ..' for assembly/API routine integration
// o full expression handling including '+=', '-='
// o bitwise/logical operators 'and/or/xor/not'
// o [..|..] element access and '_' concatenation
// o decimal and HEX '0xffff' numbers, "..." strings
// o print(..) for text and decimal number output
// o 'use "<library>"' for recursive file import
// o 'std.min' library implements: pos, rnd, clear,
//   line, rect, dot, str, len, strcmp, key, etc.


entry Program:
  elements+=Element*;

Element:
  SimpleLine |
  If |
  While |
  Def |
  Use;

If:
  'if' condition=Expression ':'
        INDENT thenBlock+=Element+
        DEDENT
    (elifs+=ElIf*)
    ('else' ':'
        INDENT elseBlock+=Element+
        DEDENT)?;

ElIf:
  'elif' ':'
      INDENT elifBlock+=Element+
      DEDENT;

While:
  'while' Expression ':'
      INDENT block+=Element
      DEDENT;

Def:
  'def' name=ID '(' (argDefs+=ArgumentDeclaration ("," argDefs+=ArgumentDeclaration)*)? ')' ':'
    INDENT block+=Element
    DEDENT;

ArgumentDeclaration returns NamedElement:
  {infer ArgumentDeclaration} type=("char"|"int") and?="&" name=ID;

Use:
  'use' StringLiteral;

SimpleLine:
  statements+=SimpleStatement (";" statements+=SimpleStatement)*;

SimpleStatement:
  VariableDeclaration |
  VariableAssignment |
  VariableCalcAssignment |
  FunctionCall |
  ReturnStatement |
  BreakStatement |
  CallStatement |
  PrintStatement;

VariableDeclaration returns NamedElement:
  {infer VariableDeclaration} type=("int"|"char") name=ID ("@" expr=Expression)? ("=" CompoundExpression);

VariableAssignment:
  id=[NamedElement:ID] (index=ArrayIndex)? "=" CompoundExpression;

VariableCalcAssignment:
  id=[NamedElement:ID] (index=ArrayIndex)? operator=("+="|"-=") NumberLiteral;

ReturnStatement:
  "return" CompoundExpression;

BreakStatement returns string:
  "break";

CallStatement:
  "call" NumberLiteral;

PrintStatement:
  "print" "(" CompoundExpression ")";


ArrayIndex:
  "[" expr=Expression "]";

CompoundExpression:
  exprs+=Expression ("_" exprs+=Expression)*;

Expression:
  Assignment;

Assignment infers Expression:
  Addition ({infer BinaryExpression.left=current} operator=('=') right=Addition)*;

Addition infers Expression:
  Multiplication ({infer BinaryExpression.left=current} operator=('+' | '-') right=Multiplication)*;

Multiplication infers Expression:
  Logical ({infer BinaryExpression.left=current} operator=('*' | '/') right=Logical)*;

Logical infers Expression:
  Comparison ({infer BinaryExpression.left=current} operator=('and' | 'or' | 'xor' | '>>' | '<<') right=Comparison)*;

Comparison infers Expression:
  Primary ({infer BinaryExpression.left=current} operator=('<=' | '<' | '>=' | '>' | '==' | '!=') right=Primary)*;

Primary infers Expression:
  '(' Expression ')' |
    UnaryExpression |
    StringLiteral |
    NumberLiteral |
    FunctionCall;

UnaryExpression:
  operator=("not"|"-") Expression;

FunctionCall:
  functionName=[Def:ID] '(' CompoundExpression? ')';

NumberLiteral:
  value=(HEXNUMBER|DECIMALNUMBER);

StringLiteral:
  value=STRING;

type NamedElement = ArgumentDeclaration | VariableDeclaration;

terminal INDENT: 'synthetic:indent';
terminal DEDENT: 'synthetic:dedent';
hidden terminal WS: /[\t ]+/;
hidden terminal NL: /[\r\n]+/;
hidden terminal COMMENT: /#[^\n]*/;
terminal HEXNUMBER returns number: /0x[0-9A-Fa-f]+/;
terminal DECIMALNUMBER returns number: /[0-9]+/;
terminal STRING: /"(\\.|[^"])*"|'(\\.|[^'])*'/;
terminal ID: /[a-zA-Z_][a-zA-Z0-9_]*/;