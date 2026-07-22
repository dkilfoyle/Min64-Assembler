; Reads an element of the math stack (int or char -> int, depending on z_type) into z_A
getA:						CIZ 2,z_type FEQ getint
                  LDT z_sp STZ z_A+0				;						; load char and cast to int in C-style
                  LL1 FCS getminus
                    CLZ z_A+1 RTS
  getminus:				MIZ 0xff,z_A+1 RTS
  getint:				LDT z_sp STZ z_A+0						; load int
                LDT z_spi STZ z_A+1
                RTS

; Put z_A as single-element value on math stack. Requires 'z_type' to be set to desired type.
putA:						CLZ z_cnt+1 MIZ 1,z_cnt+0 					; set element count to one in any case
                CPZ z_type FEQ putchar
                  LDZ z_A+1 STT z_spi									                ; store single int
  putchar:			LDZ z_A+0 STT z_sp
                RTS

; Reads an element of the math stack (int or char -> int, depending on z_type) into z_B
getB:						CIZ 2,z_type FEQ getBint
                  LDT z_sp STZ z_B+0										                ; load char and cast to int in C-style
                  LL1 FCS getBminus
                    CLZ z_B+1 RTS
  getBminus:			MIZ 0xff,z_B+1 RTS
  getBint:			LDT z_sp STZ z_B+0											                    ; load int
                LDT z_spi STZ z_B+1
                RTS

                