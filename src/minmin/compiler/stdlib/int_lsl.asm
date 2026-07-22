int_lsl:  			LDZ z_B+0 CPI 0 FEQ intlsldone
                  FPL intlslpos
                    NEG FPA intlsrpos
  intlslpos:			STZ z_count
  intlslloop:			LLV z_A DEZ z_count FGT intlslloop
  intlsldone:				RTS