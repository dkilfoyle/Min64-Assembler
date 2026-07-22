; left == right: left in stack, right in z_b 
__eq16:
  LDS 2 STZ z_C+1 LDS 2 STZ z_C+0       ; z_C = l
  LDZ z_C+1 CPZ z_B+1 FNE __eqfalse
  LDZ z_C+0 CPZ z_B+0 FNE __eqfalse
  MIV 0xffff,z_A RTS                    ; return true
  __eqfalse: CLV z_A RTS                ; return false;