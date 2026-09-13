; 16-bit logical left shift z_A by LSB(z_B) count
__shl16:      LDZ z_B CPI 0 FEQ __shl_done
              FPL __shl_pos
                NEG FPA __shr_pos
  __shl_pos:    SDZ z_cnt
  __shl_loop:   LLV z_A DEZ z_cnt FNE __shl_loop
  __shl_done:   RTS