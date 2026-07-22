 ; left >= right: left in stack, right in z_b <=> l+(-r) >= 0
__gteq16:
  NEV z_B
  LDS 2 AD.Z z_B+1 LDS 2 ADV z_B+0      ; z_B += l
  FPL __gteq16true
  CLV z_A RTS                           ; return false
  __gteqtrue: MIV 0xffff,z_A RTS        ; return true