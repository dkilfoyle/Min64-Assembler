; 16 / 16 -> 16 signed divide. NOTE: divisor magnitude must fit in a byte (-255..255)
; after sign removal -- ported directly from MIN's int_div, same limitation applies.
; in: __A (dividend), __B (divisor)   out: __A = __A / __B   clobbers: __B,__C,__D,__cnt,__flag
__div16:      CLZ z_flag
              LDZ z_A+1 CPI 0 FPL __div_anotneg
                INZ z_flag NEV z_A
  __div_anotneg: LDZ z_B+1 CPI 0 FPL __div_bnotneg
                INZ z_flag NEV z_B
  __div_bnotneg: MZZ z_B,z_B+1 CLZ z_B
              CLV z_D
              MIZ 8,z_cnt
  __div_up:     LDZ z_B+1 LL1 BMI __div_loop
                STZ z_B+1 INZ z_cnt FPA __div_up
  __div_loop:   MVV z_A,z_C
                LDZ z_B SUV z_A FCC __div_carry0
                SZZ z_B+1,z_A+1 FCS __div_result
  __div_carry0:   MVV z_C,z_A
  __div_result: RLV z_D
              LRZ z_B+1 RRZ z_B
              DEZ z_cnt FCS __div_loop
                MVV z_D,z_A
                LDZ z_flag LR1 FCC __div_allnotneg
                  NEV z_A
  __div_allnotneg: RTS