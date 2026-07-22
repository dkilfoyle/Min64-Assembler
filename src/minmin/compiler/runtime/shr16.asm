__shr16:      LDZ z_B CPI 0 FEQ __shr_done
              FPL __shr_pos
                NEG FPA __shl_pos
  __shr_pos:    STZ z_cnt
  __shr_loop:   LRZ z_A+1 RRZ z_A
              DEZ z_cnt FNE __shr_loop
  __shr_done:   RTS