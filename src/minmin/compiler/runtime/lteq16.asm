; left <= right: left in stack, right in z_b <=> r-l >= 0
__lteq16:
  LDS 2 STZ z_C+1 LDS 2 STZ z_C+0       ; z_C = l
  SVV z_C,z_B                           ; z_B -= z_C (r-=l)
  FPL __lteq16true
  CLV z_A RTS                           ; return false
  __lteqtrue: MIV 0xffff,z_A RTS        ; return true
