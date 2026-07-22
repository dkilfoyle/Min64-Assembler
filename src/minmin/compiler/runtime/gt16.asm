; left > right: left in stack, right in z_b <=> (-l) + r < 0
__gt16:
  LDS 2 STZ z_C+1 LDS 2 STZ z_C+0       ; z_C = l
  NEV z_C                               ; z_C = -l
  LDZ z_B+1 AD.Z z_C+1
  LDZ z_B+0 AD.Z z_C+0                  ; z_C += r
  FMI __gt16true
    CLV z_A RTS
  __lt16true: MIV 0xffff,z_A RTS