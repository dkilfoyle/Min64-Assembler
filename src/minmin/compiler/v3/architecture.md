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

# Stack

The stack frame grows upwards from the end of the binary data
Every function adds a new frame with z_FP = current z_SP
Order of items on the frame is:

1. params left to right
2. callerFP  <-- FP
3. locals
5. arrays and calls

```
int a = 3;
char b = "c";
foo(a,b)
def foo(int x, char y):
  int z = 5
  char bla = "bla"
```

| -04 | xLSB        | param0  |                   |
| -03 | xMSB        | param0  |                   |
| -02 | yLSB        | param1  |                   |
| -01 | yMSB        | param1  | all param 2 bytes |
| +00 | CallerFPLSB |         |                   |
| +01 | CallerFPMSB |         |                   |
| +02 | zLSB        | local0  |                   |
| +03 | zMSB        | local0  |                   |
| +04 | *blaLSB     | local1  |                   |
| +05 | *blaMSB     | local1  |                   |
| +06 | b           |         | z_SP starts here  |
| +07 | l           |         |                   |
| +08 | a           |         |                   |

