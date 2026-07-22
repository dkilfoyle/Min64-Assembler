getVar:					CIZ 2,z_type FEQ getint
                  LDT z_sp STZ z_A+0				;						; load char and cast to int in C-style
                  LL1 FCS getminus
                    CLZ z_A+1 RTS
  getminus:				MIZ 0xff,z_A+1 RTS
  getint:				LDT z_sp STZ z_A+0						; load int
                LDT z_sp+1 STZ z_A+1
                RTS