; 16bit and: z_A &= z_B
__and16:      LDZ z_B+1 AN.Z z_A+1
              LDZ z_B AN.Z z_A
              RTS