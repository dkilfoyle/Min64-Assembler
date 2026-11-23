# Memory

Min64x4 cpu is little endian - byte order is LSB MSB

# Variables

int = 2 bytes
char = 1 byte

# Zero page registers

z_A - expression result or a pointer if evaluates to an array
z_B - number of bytes in array
z_SP - top of the stack, the next free position
z_PTR - currently selected stack variable, address of the LSB
z_PTR2 - destination pointer
z_FP2 - frame base for the pointer stack
z_SP2 - top of the pointer stack, the next free position

# Stack

There are two separate stacks: a data stack and a pointer stack
The pointer stack contains a 16bit address pointer for a named variable or a function parameter that points to the start of that variables data on the data stack. This allows to have arrays of runtime variable length.


Order of building the frame:

1. compileFunctionCall
   1. push the caller FP2 to SP2
   2. set FP2 = SP2 - the first param or the first local
   3. params left to right
      1. these are compiled in the caller's stack but will be addressed from the callee's
2. compileDef
   1. locals
   2. calls
3. return statement
   1. if return expr is array
      1. push the current SP2 = pointer to the return value
      2. compile return compound expression
      3. copy entire array to **FP2
   2. else
      1. compile return compound expression -> result in z_A
4. function epilog
   1. pop pointer frame by setting SP2 = FP2
   2. z_SP2 now points to the first stack pointer
   3. set z_SP to the word at z_SP2 = pops the data stack
   4. restore the caller FP2 by pruning off 2 bytes from z_SP2 

Every argument and variable declaration:
1. push current z_SP onto the pointer stack
2. compile it's value onto the data stack from z_SP

```
int a = 3;
char b = "cde";
foo(a,b)
def foo(int x, char y):
  int z = 5
  char bla = "bla"
  int nums = getnums()
def getnums():
  int j = 8
  return 1_2_3
```

0x1000 | global  |  aLSB        | local0  | 03    |
0x1000 |         |  aMSB        | local0  | 00    |
0x1002 |         |  b[0]        | local1  | "c"   |
0x1003 |         |  b[1]        | local1  | "d"   |
0x1004 |         |  b[2]        | local1  | "e"   |
0x1000 | foo     |  xLSB        | param0  | 03    |
0x1000 |         |  xLSB        | param0  | 03    |
0x1000 |         |  xLSB        | param0  | 03    |
0x1001 |         |  xMSB        | param0  | 00    |
0x1002 |         |  y[0]        | param1  | "c"   |
0x1003 |         |  y[1]        | param1  | "d"   |
0x1004 |         |  y[2]        | param1  | "e"   |
0x1005 |         |  zLSB        | local0  | 05    |
0x1006 |         |  zMSB        | local0  | 00    |
0x1007 |         |  bla[0]      | local1  | "b"   |
0x1008 |         |  bla[1]      | local1  | "l"   |
0x1009 |         |  bla[2]      | local1  | "a"   |
0x1009 | getnums |  jLSB        | local0  | 8     |
0x1009 |         |  jMSB        | local0  | 0     |
0x1009 |         |              | return  | 1     |
0x1009 |         |              | return  | 2     |
0x1009 |         |              | return  | 3     |
   
0x100A |             | z_SP    |       |


| +00 | &x          | =FP     |       |
| +01 | &x          |         |       |
| +02 | &y          |         |       |
| +03 | &y          |         |       |
| +04 | &z          |         |       |
| +05 | &z          |         |       |
| +06 | &bla        |         |       |
| +07 | &bla        |         |       |
| +08 |             | z_sp2   |       |

To pop the value stack
z_SP = z_SP - &x

To pop the addr table
z_SP2 = z_SP2 - num vars * 2