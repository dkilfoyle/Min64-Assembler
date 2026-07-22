int_div:				CLZ z_flag											; clear the sign byte
                LDZ z_A+1 CPI 0 FPL divanotneg		              ; make A and B positive, evaluate the sign of result
                  INZ z_flag NEV z_A						                    ; store a sign, negate A									;
  divanotneg:		LDZ z_B+1 CPI 0 FPL divbnotneg
                  INZ z_flag NEV z_B						                    ; store a(nother) sign, negate B
  divbnotneg:		MZZ z_B+0,z_B+1 CLZ z_B+0			                   ; move the lower half of B to upper half, clear lower half
                CLV z_D													; clear result E
                MIZ 8,z_count									; pre-init the shiftcounter (needs modification below)
  divup:				LDZ z_B+1 LL1 FMI divloop				; ist oberstes bit vom B schon 'ganz oben'?
                  STZ z_B+1 INZ z_count FPA divup             ; increase number of shifts and shift upper B one step up
  divloop:			MVV z_A,z_C										; copy A to C
                LDZ z_B+0 SUV z_A+0 FCC divcarry0 SZZ z_B+1,z_A+1 FCS divresult		 ; A = A - B (B fits in A => shift '1' into E)
  divcarry0:			MVV z_C,z_A									; restore A from C (B does not fit in A => shift '0' into E)
  divresult:		RLV z_D                                         ; E = E<<1 | C (1: B fit in A, 0: B does not fit into A)
                LRZ z_B+1 RRZ z_B+0						; shift B one step down
                DEZ z_count FCS divloop
                  MVV z_D,z_A							; move result back into A
                  LDZ z_flag LR1 FCC divallnotneg
                    NEV z_A
  divallnotneg:		RTS