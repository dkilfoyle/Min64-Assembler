; Code compiled from file:///workspace/example.min

#org 0x2000
; print(5+5)
MIV 0x0005,z_A                        ; const 5
AIV 5,z_A                             ; + byte constant
JPS __inttostr
LDB __strptr+0 PHS LDB __strptr+1 PHS JPS _PrintPtr PLS PLS
JPA _Prompt

; --- runtime library ---
#page
; __strptr points to a null-terminated string
; modifies: z_C
__inttostr
__inttostr:			CLB __intstr													; PRINT A 16-BIT REGISTER AS DEC NUMBER
                MVV z_A,z_C								; copy A to working reg C so A remains unchanged
                RL1 FCC __intnotneg
                  NEV z_C LDI '-' STB __intstr                 ; negative sign
  __intnotneg:		LDI <__intstr+5 STB __strptr+0			                 ; point to last digit of output string
                LDI >__intstr+5 STB __strptr+1
  __intstart:		CLZ z_C+2 	                    		               ; clear upper register and carry store
                MIZ 16,z_cnt
  __intshift:		LDZ z_C+2 RL1		  								; activate C stored in bit 7 (initially = 0)
                RLV z_C RLZ z_C+2                             ; shift C back in and shift everything one step left
                CPI 10 FCC __intdone									                  ; 10 did not fit in => do not set bit 7 as carry
                  ADI 118 STZ z_C+2			        	               ; 10 went into it => subtract 10 and set bit 7 as carry (-10 +128)
  __intdone:		  DEZ z_cnt FNE __intshift
                  LDZ z_C+2 ANI 0x7f								                  ; erase a possible stored carry
                  ADI '0' STR __strptr DEW __strptr   	           ; store remainder as char
                  LDZ z_C+2 RL1			  						                    ; restore stored carry flag
                  RLV z_C                                     ; shift in C and shift everything one step up
                  RLZ z_C+2                                   ; shift C into 'remember' and shift an old carry out
                  LDI 0 CPZ z_C+0 FNE __intstart               ; prüfe nach, ob big register null enthält
                    CPZ z_C+1 FNE __intstart
                      LDB __intstr CPI '-' FNE __intout
                        STR __strptr RTS
  __intout:						INW __strptr RTS
  __intstr:		  '-32768', 0
  __strptr:				0x0000

; ---- expression compiler zero-page working storage ----
#org 0x0000
z_A:      0x0000    ; accumulator / expression result / fn return value
z_B:      0x0000    ; secondary operand
z_C:      0x0000    ; scratch (mul/div/cmp)
z_D:      0x0000    ; scratch (div quotient)
z_cnt:    0x00      ; loop counter (mul/div/shifts)
z_flag:   0x00      ; sign flag (div)

; MinOS API
#org 0xf048 _PrintPtr:
#org 0xf003 _Prompt: