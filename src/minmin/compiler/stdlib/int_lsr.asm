int_lsr:  			LDZ z_B+0 CPI 0 FEQ intlsrdone
                  FPL intlsrpos
                    NEG FPA intlslpos
  intlsrpos:			STZ z_count
  intlsrloop:			LRZ z_A+1 RRZ z_A+0
                  DEZ z_count FGT intlsrloop
  intlsrdone:     	RTS