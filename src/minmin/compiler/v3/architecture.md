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
Order of variables on the frame is:

1. CallerFP starting at z_FP+0
2. Params left to right starting at z_FP+2
3. Locals in order of declaration

- Fixed length arrays are stored as bytes
- Variable length arrays are stored as pointer

4. z_SP is set to z_FP + frameSize
5. Variable length array data pushed to z_SP as the array is declared, saving the starting z_SP into reserved pointer earlier in the stack
