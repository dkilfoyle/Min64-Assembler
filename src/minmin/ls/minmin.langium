grammar MinminModel

entry Program:
  elements+=GlobalElement*;

LocalElement:
  SimpleStatement |
  ";" SimpleStatement |
  If |
  While;

GlobalElement:
  LocalElement | 
  Def | 
  Use;

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
    INDENT block+=LocalElement+
    DEDENT
  );

ParameterDeclaration returns NamedElement:
  {infer ParameterDeclaration} type=("char"|"int") byRef?="&"? name=ID;

Use:
  'use' libPath=STRING;

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
  {infer VariableDeclaration} type=("int"|"char") name=ID ("@" atExpr=Expression)? ("=" assignExpr=CompoundExpression)?;

VariableAssignment:
  varName=[NamedElement:ID] ArrayIndex? "=" assignExpr=CompoundExpression;

VariableCalcAssignment:
  varName=[NamedElement:ID] ArrayIndex? op=("+="|"-=") value=(HEXNUMBER|DECIMALNUMBER);

ReturnStatement:
  "return" expr=CompoundExpression;

BreakStatement:
  break="break";

CallStatement:
  "call" address=NumberLiteral;

PrintStatement:
  "print" "(" args+=CompoundExpression ("," args+=CompoundExpression)* ")";

fragment ArrayIndex:
  "[" indexExpr=Expression "]";

CompoundExpression:
  exprs+=Expression ("_" exprs+=Expression)*;

Expression:
  Logic;

Logic infers Expression:
  Comparison ({infer BinaryExpression.left=current} op=('and'|'or'|'xor'|'>>'|'<<') right=Comparison)*;

Comparison infers Expression:
  Addition ({infer ComparisonExpression.left=current} op=('<' | '<=' | '>' | '>=' | '==' | '!=') right=Addition)*;

Addition infers Expression:
  Multiplication ({infer BinaryExpression.left=current} op=('+' | '-') right=Multiplication)*;


Multiplication infers Expression:
  Unary ({infer BinaryExpression.left=current} op=('*' | '/') right=Unary)*;

Unary infers Expression:
  {infer UnaryExpression} op=('not' | '-') inner=Primary
    | Primary;

Primary infers Expression:
  '(' Expression ')' |
    ConstExpression |
    VariableReference |
    FunctionCall;

FunctionCall:
  functionName=[Def:ID] '(' (args+=CompoundExpression ("," args+=CompoundExpression)*)? ')';

ConstExpression:
  NumberLiteral | StringLiteral;

NumberLiteral:
  value=(HEXNUMBER|DECIMALNUMBER);

StringLiteral:
  value=STRING;

VariableReference:
  isAddress?="&"? varName=[NamedElement:ID] index=RangeIndex?;

RangeIndex:
  "[" startExpr=Expression? ("|" endExpr=Expression)? "]";

type NamedElement = ParameterDeclaration | VariableDeclaration;

terminal INDENT: 'synthetic:indent';
terminal DEDENT: 'synthetic:dedent';
hidden terminal WS: /[\t ]+/;
hidden terminal NL: /[\r\n]+/;
hidden terminal COMMENT: /#[^\n\r]*/;
// terminal US: /_/;
terminal HEXNUMBER returns number: /0x[0-9A-Fa-f]+/;
terminal DECIMALNUMBER returns number: /[0-9]+/;
terminal STRING: /"(\\.|[^"])*"|'(\\.|[^'])*'/;
terminal ID: /[a-zA-Z][a-zA-Z0-9]*/;