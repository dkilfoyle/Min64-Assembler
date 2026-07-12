grammar MinminModel

entry Program:
  elements+=Element*;

Element:
  SimpleStatement |
  ";" SimpleStatement |
  If |
  While |
  Def | 
  Use;

// If:
//   'if' condition=Expression ':' 
//     (thenBlock+=SimpleStatement | (
//       INDENT thenBlock+=Element+
//       DEDENT)
//     )
//     (elifs+=ElIf*)
//     ('else' ':'
//        (elseBlock+=SimpleStatement | (
//          INDENT elseBlock+=Element+
//          DEDENT)
//        )
//     )?;
If:
  'if' condition=Expression ':' Block
    (elifs+=ElIf*)
    (elseBlock=Else)?;

ElIf:
  'elif' condition=Expression ':' Block;

Else:
  'else' ':' Block;

While:
  'while' condition=Expression ':' Block;

Def:
  'def' name=ID '(' (params+=ParameterDeclaration ("," params+=ParameterDeclaration)*)? ')' ':' Block;

fragment Block:
  (
    block+=SimpleStatement (";" block+=SimpleStatement)* 
  ) |
  (
    INDENT block+=Element+
    DEDENT
  );

ParameterDeclaration returns NamedElement:
  {infer ParameterDeclaration} type=("char"|"int") and?="&"? name=ID;

Use:
  'use' lib=STRING;

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
  {infer VariableDeclaration} type=("int"|"char") name=ID ("@" atexpr=Expression)? ("=" assignExpr=CompoundExpression)?;

VariableAssignment:
  {infer VariableAssignment} id=[NamedElement:ID] (index=ArrayIndex)? "=" assignExpr=CompoundExpression;

VariableCalcAssignment:
  id=[NamedElement:ID] (index=ArrayIndex)? operator=("+="|"-=") NumberLiteral;

ReturnStatement:
  "return" expr=CompoundExpression;

BreakStatement returns string:
  "break";

CallStatement:
  "call" address=NumberLiteral;

PrintStatement:
  "print" "(" args+=CompoundExpression ("," args+=CompoundExpression)* ")";


ArrayIndex:
  "[" expr=Expression "]";

CompoundExpression:
  exprs+=Expression ("_" exprs+=Expression)*;

Expression:
  Addition;

// Assignment infers Expression:
//   Addition ({infer BinaryExpression.left=current} operator=('=') right=Addition)*;

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
    VariableReference |
    FunctionCall;

UnaryExpression:
  operator=("not"|"-") Expression;

FunctionCall:
  functionName=[Def:ID] '(' (args+=CompoundExpression ("," args+=CompoundExpression)*)? ')';

NumberLiteral:
  value=(HEXNUMBER|DECIMALNUMBER);

StringLiteral:
  value=STRING;

VariableReference:
  isAddress?="&"? id=[NamedElement:ID] index=RangeIndex?;

RangeIndex:
  "[" startExpr=Expression? ("|" endExpr=Expression)? "]";

type NamedElement = ParameterDeclaration | VariableDeclaration;

terminal INDENT: 'synthetic:indent';
terminal DEDENT: 'synthetic:dedent';
hidden terminal WS: /[\t ]+/;
hidden terminal NL: /[\r\n]+/;
hidden terminal COMMENT: /#[^\n]*/;
// terminal US: /_/;
terminal HEXNUMBER returns number: /0x[0-9A-Fa-f]+/;
terminal DECIMALNUMBER returns number: /[0-9]+/;
terminal STRING: /"(\\.|[^"])*"|'(\\.|[^'])*'/;
terminal ID: /[a-zA-Z][a-zA-Z0-9]*/;