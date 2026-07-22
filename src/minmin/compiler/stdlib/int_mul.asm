int_mul:				MVV z_A,z_C										     ; copy A factor into C (C will be shifted right)
                CLV z_A
                MIZ 16,z_count
  multloop:			RRZ z_C+1 RRZ z_C+0					; shift C one step right, lowest bit is now in carry flag
                FCC multbitoff
                  AVV z_B,z_A	                                ; adds current B to accumulator A
  multbitoff:		LLV z_B                                        ; increase the value of B with shift left one step left
                DEZ z_count FNE multloop
                  RTS