; 16-bit logical shift left / right by a variable count. count is __B's low byte,
; treated as signed: a negative count shifts the other direction (matches MIN's
; int_lsl / int_lsr exactly). Right shift is logical (zero-fill), not arithmetic.
; in: __A (value), __B (count)   out: __A   clobbers: __cnt
__shl16:      LDZ z_B CPI 0 FEQ __shl_done
              FPL __shl_pos
                NEG FPA __shr_pos
  __shl_pos:    STZ z_cnt
  __shl_loop:   LLV z_A DEZ z_cnt FNE __shl_loop
  __shl_done:   RTS