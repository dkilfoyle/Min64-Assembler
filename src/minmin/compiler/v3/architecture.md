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
z_FP - frame base, stack locations are relative to this
z_VP - current top of the variable frame

# Stack

The stack frame grows upwards from the end of the binary data
Every function adds a new frame with z_FP = current z_SP
Order of items on the frame is:

1. callerFP  <-- FP
2. params left to right
3. locals
4. calls

arguments are passed by value

Every argument and variable declaration:
1. saves z_SP as a pointer to it's stack position in the varInfo stack from z_FP2
2. copies it's value into the stack from z_SP
3.  

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