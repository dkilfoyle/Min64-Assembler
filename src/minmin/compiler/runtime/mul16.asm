; 16 x 16 -> 16 unsigned/signed-safe multiply (two's-complement wraps correctly)
; in: __A, __B   out: __A = __A * __B   clobbers: __B, __C, __cnt
__mul16:      MVV z_A,z_C
              CLV z_A
              MIZ 16,z_cnt
  __mul16_lp: RRZ z_C+1 RRZ z_C
              FCC __mul16_off
                AVV z_B,z_A
  __mul16_off:  LLV z_B
              DEZ z_cnt FNE __mul16_lp
              RTS