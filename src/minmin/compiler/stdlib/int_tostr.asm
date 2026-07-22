; strptr points to a null-terminated string
; modifies: z_C
int_tostr:			CLB int_str													; PRINT A 16-BIT REGISTER AS DEC NUMBER
                MVV z_A,z_C								; copy A to working reg C so A remains unchanged
                RL1 FCC int_notneg
                  NEV z_C LDI '-' STB int_str                 ; negative sign
  int_notneg:		LDI <int_str+5 STB strptr+0			                 ; point to last digit of output string
                LDI >int_str+5 STB strptr+1
  int_start:		CLZ z_C+2 	                    		               ; clear upper register and carry store
                MIZ 16,z_count
  int_shift:		LDZ z_C+2 RL1		  								; activate C stored in bit 7 (initially = 0)
                RLV z_C RLZ z_C+2                             ; shift C back in and shift everything one step left
                CPI 10 FCC int_done									                  ; 10 did not fit in => do not set bit 7 as carry
                  ADI 118 STZ z_C+2			        	               ; 10 went into it => subtract 10 and set bit 7 as carry (-10 +128)
  int_done:		  DEZ z_count FNE int_shift
                  LDZ z_C+2 ANI 0x7f								                  ; erase a possible stored carry
                  ADI '0' STR strptr DEW strptr   	           ; store remainder as char
                  LDZ z_C+2 RL1			  						                    ; restore stored carry flag
                  RLV z_C                                     ; shift in C and shift everything one step up
                  RLZ z_C+2                                   ; shift C into 'remember' and shift an old carry out
                  LDI 0 CPZ z_C+0 FNE int_start               ; prüfe nach, ob big register null enthält
                    CPZ z_C+1 FNE int_start
                      LDB int_str CPI '-' FNE int_out
                        STR strptr RTS
  int_out:						INW strptr RTS
  int_str:		  '-32768', 0
  strptr:				0x0000