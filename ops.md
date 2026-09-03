| OP   | Action                                                     | Args        |
| ---- | ---------------------------------------------------------- | ----------- |
| NOP  | No operation                                               | -           |
| OUT  | Output A to UART: UART = A                                 | -           |
| INT  | Read UART input to A: A = UART                             | -           |
| INK  | Read PS/2 input to A: A = PS2                              | -           |
| WIN  | Wait for any input (UART or PS/2)                          | -           |
| LL0  | Logical left-shift A 0 steps (C=0)                         | -           |
| LL1  | Logical left-shift A 1 step (C=0)                          | -           |
| LL2  | Logical left-shift A 2 steps (C=0)                         | -           |
| LL3  | Logical left-shift A 3 steps (C=0)                         | -           |
| LL4  | Logical left-shift A 4 steps (C=0)                         | -           |
| LL5  | Logical left-shift A 5 steps (C=0)                         | -           |
| LL6  | Logical left-shift A 6 steps (C=0)                         | -           |
| LL7  | Logical left-shift A 7 steps (C=0)                         | -           |
| RL0  | Rotate left A 0 steps via C (= RR9)                        | -           |
| RL1  | Rotate left A 1 step via C (= RR8)                         | -           |
| RL2  | Rotate left A 2 steps via C (= RR7)                        | -           |
| RL3  | Rotate left A 3 steps via C (= RR6)                        | -           |
| RL4  | Rotate left A 4 steps via C (= RR5)                        | -           |
| RL5  | Rotate left A 5 steps via C (= RR4)                        | -           |
| RL6  | Rotate left A 6 steps via C (= RR3)                        | -           |
| RL7  | Rotate left A 7 steps via C (= RR2)                        | -           |
| RR1  | Rotate right A 1 step via C (= RL8)                        | -           |
| LR0  | Logical right-shift A 0 steps (C=0) (= RR0, RL9)           | -           |
| LR1  | Logical right-shift A 1 step (C=0)                         | -           |
| LR2  | Logical right-shift A 2 steps (C=0) §                      | -           |
| LR3  | Logical right-shift A 3 steps (C=0) §                      | -           |
| LR4  | Logical right-shift A 4 steps (C=0) §                      | -           |
| LR5  | Logical right-shift A 5 steps (C=0) §                      | -           |
| LR6  | Logical right-shift A 6 steps (C=0) §                      | -           |
| LR7  | Logical right-shift A 7 steps (C=0)                        | -           |
| LLZ  | Logical shift left \*Z 1 step (C=0)                        | Z           |
| LLB  | Logical shift byte left 1 step (C=0)                       | addr        |
| LLV  | Logical shift fast word left 1 step (C=0)                  | V           |
| LLW  | Logical shift word left 1 step (C=0)                       | addr        |
| LLQ  | Logical shift fast long left 1 step (C=0)                  | Q           |
| LLL  | Logical shift long left 1 step (C=0)                       | addr        |
| LRZ  | Logical shift right zero-page byte 1 step (C=0)            | Z           |
| LRB  | Logical shift right abs byte 1 step (C=0)                  | addr        |
| RLZ  | Rotate left zero-page byte 1 step via C                    | Z           |
| RLB  | Rotate left byte at addr 1 step via C                      | addr        |
| RLV  | Rotate left zero-page word 1 step via C                    | V           |
| RLW  | Rotate left word at addr 1 step via C                      | addr        |
| RLQ  | Rotate left zero-page long 1 step via C                    | Q           |
| RLL  | Rotate left abs long 1 step via C                          | addr        |
| RRZ  | Rotate right zero-page byte 1 step via C                   | Z           |
| RRB  | Rotate right byte at addr 1 step via C                     | addr        |
| NOT  | Bitwise NOT A: A = ~A                                      | -           |
| NOZ  | Bitwise NOT *Z: *Z = ~\*Z                                  | Z           |
| NOB  | Bitwise NOT byte: *addr = ~*addr                           | addr        |
| NOV  | Bitwise NOT zero-page word: *V = ~(*V)                     | V           |
| NOW  | Bitwise NOT word at address                                | addr        |
| NOQ  | Bitwise NOT zero-page long                                 | Q           |
| NEG  | Negate A: A = -A                                           | -           |
| NEZ  | Negate zero-page byte: *Z = -*Z                            | Z           |
| NEB  | Negate byte at address: *addr = -*addr                     | addr        |
| NEV  | Negate zero-page word (C = 1 only if word = 0)             | V           |
| NEW  | Negate word at address (C = 1 only if word = 0)            | addr        |
| NEQ  | Negate zero-page long (C = 1 only if long = 0)             | Q           |
| ANI  | Bitwise AND: A = A & imm                                   | imm         |
| ANZ  | Bitwise AND: A = A & \*Z                                   | Z           |
| ANB  | Bitwise AND: A = A & \*addr                                | addr        |
| ANT  | Bitwise AND: A = A & \*\*Z                                 | Z           |
| ANR  | Bitwise AND: A = A & \*\*addr                              | addr        |
| AN.Z | Bitwise AND: *Z = *Z & A                                   | Z           |
| AN.B | Bitwise AND: *addr = *addr & A                             | addr        |
| AN.T | Bitwise AND: **Z = A & **Z                                 | Z           |
| AN.R | Bitwise AND: **addr = A & **addr                           | addr        |
| ORI  | Bitwise OR: A = A or imm                                   | imm         |
| ORZ  | Bitwise OR: A = A or \*Z                                   | Z           |
| ORB  | Bitwise OR: A = A or \*addr                                | addr        |
| ORT  | Bitwise OR: A = A or \*\*Z                                 | Z           |
| ORR  | Bitwise OR: A = A or \*\*addr                              | addr        |
| OR.Z | Bitwise OR: *Z = *Z or A                                   | Z           |
| OR.B | Bitwise OR: *addr = *addr or A                             | addr        |
| OR.T | Bitwise OR: \*\*Z = A or \*\*Z                             | Z           |
| OR.R | Bitwise OR: \*\*addr = A or \*\*addr                       | addr        |
| XRI  | Bitwise XOR: A = A ^ imm §                                 | imm         |
| XRZ  | Bitwise XOR: A = A ^ \*Z                                   | Z           |
| XRB  | Bitwise XOR: A = A ^ \* addr §                             | addr        |
| XRT  | Bitwise XOR: A = A ^ \*\*Z                                 | Z           |
| XRR  | Bitwise XOR: A = A ^ \*\*addr §                            | addr        |
| XR.Z | Bitwise XOR: *Z = *Z ^ A                                   | Z           |
| XR.B | Bitwise XOR: *addr = *addr ^ A                             | addr        |
| XR.T | Bitwise XOR: **Z = A ^ **Z                                 | Z           |
| XR.R | Bitwise XOR: **addr = A ^ **addr §                         | addr        |
|      |                                                            |             |
| FNE  | Fast branch on non-zero                                    | addr lsb    |
| FEQ  | Fast branch on zero                                        | addr lsb    |
| FCC  | Fast branch on carry clear                                 | addr lsb    |
| FCS  | Fast branch on carry set                                   | addr lsb    |
| FPL  | Fast branch on plus                                        | addr lsb    |
| FMI  | Fast branch on minus                                       | addr lsb    |
| FGT  | Fast branch on greater                                     | addr lsb    |
| FLE  | Fast branch on less or equal                               | addr lsb    |
| FPA  | Fast jump to lsb addr                                      | addr lsb    |
| BNE  | Branch on non-zero                                         | addr        |
| BEQ  | Branch on zero                                             | addr        |
| BCC  | Branch on carry clear                                      | addr        |
| BCS  | Branch on carry set                                        | addr        |
| BPL  | Branch on plus                                             | addr        |
| BMI  | Branch on minus                                            | addr        |
| BGT  | Branch on greater                                          | addr        |
| BLE  | Branch on less or equal                                    | addr        |
| JPA  | Jump to address: PC = addr                                 | addr        |
| JPR  | Jump to rel address: PC = \*addr                           | addr        |
| JAR  | Jump A-indexed to rel address: PC = \*(addr + A)           | addr        |
| JPS  | Jump to subroutine                                         | addr        |
| JAS  | Jump to subroutine conserving A §                          | addr        |
| RTS  | Return from subroutine                                     | -           |
|      |                                                            |             |
| PHS  | Push A onto stack                                          | -           |
| PLS  | Pull A from stack                                          | -           |
| LDS  | Load from stack: A = \*(0xff00 + SP + off)                 | offset      |
| SDS  | Store on stack: \*(0xff00 + SP + off) = A                  | offset      |
|      |                                                            |             |
| RDB  | Read FLASH data from abs 3-byte address                    | addr, bnk   |
| RDR  | Read FLASH data from rel 3-byte address                    | addr        |
| RAP  | Read A-indexed FLASH data: A = \_(page<<8 + A)             | page, bnk   |
| RZP  | Read Z-indexed FLASH data: A = \_(page<<8 + \*Z)           | Z,page, bnk |
| WDB  | Write FLASH data to abs 3-byte address §                   | addr, bnk   |
| WDR  | Write FLASH data to rel 3-byte address §                   | addr        |
|      |                                                            |             |
| LDI  | Load A immediate: A = imm                                  | imm         |
| LDZ  | Load A from Z: A = \*Z                                     | Z           |
| LDB  | Load A from address: A = \*addr                            | addr        |
| LDT  | Load A from rel address in zero page: A = \*\*Z            | Z           |
| LDR  | Load A from relative address: A = \*\*addr                 | addr        |
| LAP  | Load A A-indexed from page: A = \_(page<<8 + A)            | page        |
| LAB  | Load A A-indexed from addr: A = \_(addr + A)               | addr        |
| LZP  | Load A Z-indexed from page: A = *(page<<8 + *Z)            | Z, page     |
| LZB  | Load A Z-indexed from addr: A = *(addr + *Z)               | Z, addr     |
| SDZ  | Store A to Z: \*Z = A                                      | Z           |
| SDB  | Store A to address: \*addr = A                             | addr        |
| SDT  | Store A at rel address in zero page: \*\*Z = A             | Z           |
| SDR  | Store A at relative address: \*\*addr = A                  | addr        |
| SZP  | Store A Z-indexed to page: *(page<<8 + *Z) = A             | Z, page     |
|      |                                                            |             |
| MIZ  | Move imm byte to zero-page: \*Z = imm                      | imm, Z      |
| MIB  | Move imm byte to addr: \*addr = imm                        | imm, addr   |
| MIT  | Move imm byte to rel zero-page addr: *(*T) = imm           | imm, Z      |
| MIR  | Move imm byte to rel addr: \*\*addr = imm                  | imm, addr   |
| MIV  | Move imm word to zero-page word: \*V = imm                 | imm, V      |
| MIW  | Move imm word to addr: \*addr = imm                        | imm, addr   |
| MZZ  | Move byte at ZP addr to zero-page addr: *Z2 = *Z1          | Z1, Z2      |
| MZB  | Move byte at ZP addr to addr: *addr = *Z                   | Z, addr     |
| MZT  | Move byte at ZP addr to rel ZP addr: \*\*Z2 = \*Z1         | Z1, Z2      |
| MZR  | Move byte at ZP addr to rel addr: \*\*addr = \*Z1          | Z, addr     |
| MBZ  | Move byte at addr to zero-page: *Z = *addr                 | addr, Z     |
| MBB  | Move byte at adr1 to adr2: \*adr2 = \*adr1                 | adr1, adr2  |
| MBT  | Move byte at addr to rel ZP addr: \*\*Z = \*addr           | addr, Z     |
| MBR  | Move byte at adr1 to rel adr2: \*\*adr2 = \*adr1           | adr1, adr2  |
| MTZ  | Move byte at rel ZP addr to ZP addr: \*Z2 = \*\*Z1         | Z1, Z2      |
| MTB  | Move byte at rel ZP addr to addr: \*addr = \*\*Z           | Z, addr     |
| MTT  | Move byte at rel ZP adr to rel ZP adr: **Z2 = **Z1         | Z1, Z2      |
| MTR  | Move byte at rel ZP addr to rel addr: **addr = **Z         | Z, addr     |
| MRZ  | Move byte at rel addr to ZP addr: \*Z = \*\*addr           | addr, Z     |
| MRB  | Move byte at rel adr1 to adr2: \*adr2 = \*\*adr1           | adr1, adr2  |
| MRT  | Move byte at rel addr to rel ZP addr: **Z = **addr         | addr, Z     |
| MRR  | Move byte at rel adr1 to rel adr2: \*\*adr2 = \*\*adr1     | adr1, adr2  |
| MVV  | Move word at ZP addr to word at ZP addr: *V2 = *V1         | V1, V2      |
| MWV  | Move word at addr to word at ZP addr: *V = *addr           | addr, V     |
|      |                                                            |             |
| CLD  | Clear A: A = 0x00                                          | -           |
| CLZ  | Clear byte at zero-page addr: \*Z = 0x00                   | Z           |
| CLB  | Clear byte at addr: \*addr = 0x00                          | addr        |
| CLV  | Clear word at zero-page addr: \*V = 0x0000                 | V           |
| CLW  | Clear word at addr: \*addr = 0x0000                        | addr        |
| CLQ  | Clear long at zero-page addr: \*Q = 0x00000000             | Q           |
| CLL  | Clear long at addr: \*addr = 0x00000000                    | addr        |
| CL5  | Clear data at rel ZP: \*\*Z = 0x0000000000 and \*Z += 5    | Z           |
|      |                                                            |             |
| INC  | Increment A: A = A + 1                                     | -           |
| INZ  | Increment zero-page byte: *Z = *Z + 1                      | Z           |
| INB  | Increment byte at addr: *addr = *addr + 1                  | addr        |
| INV  | Increment zero-page word: *V = *V + 0x0001                 | V           |
| INW  | Increment word at addr: *addr = *addr + 0x0001             | addr        |
| INQ  | Increment zero-page long: *Q = *Q + 0x00000001             | Q           |
| DEC  | Decrement A: A = A - 1                                     | -           |
| DEZ  | Decrement *Z = *Z - 1                                      | Z           |
| DEB  | Decrement byte: *addr = *addr - 1                          | addr        |
| DEV  | Decrement zero-page word: *V = *V - 0x0001                 | V           |
| DEW  | Decrement word at addr: *addr = *addr - 0x0001             | addr        |
| DEQ  | Decrement zero-page long: *Q = *Q - 0x00000001             | Q           |
|      |                                                            |             |
| ADI  | Add immediate to A: A = A + imm                            | imm         |
| ADZ  | Add zero-page byte to A: A = A + \*Z                       | Z           |
| ADB  | Add byte at addr to A: A = A + \*addr                      | addr        |
| ADT  | Add byte at rel zero-page addr to A: A = A + \*\*Z         | Z           |
| ADR  | Add byte at rel addr to A: A = A + \*\*addr                | addr        |
| AD.Z | Add A to zero-page byte: *Z = *Z + A                       | Z           |
| AD.B | Add A to byte at addr: *addr = *addr + A                   | addr        |
| AD.T | Add A to rel zero-page address: **Z = **Z + A              | Z           |
| AD.R | Add A to rel address: **addr = **addr + A                  | addr        |
| ADV  | Add A to zero-page word: *V = *V + A                       | V           |
| ADW  | Add A to word at addr: *addr = *addr + A                   | addr        |
| ADQ  | Add A to zero-page long: *Q = *Q + A                       | Q           |
| AIZ  | Add imm byte to zero-page byte: *Z = *Z + imm              | imm, Z      |
| AIB  | Add imm to byte at addr: \*addr = \_addr + imm             | imm, addr   |
| AIT  | Add imm to byte at rel Z addr: **Z = **Z + imm             | imm, Z      |
| AIR  | Add imm to byte at rel adr: _(\_adr) = _(\*adr) + imm      | imm, addr   |
| AIV  | Add imm byte to zero-page word: *V = *V + imm              | imm, V      |
| AIW  | Add imm byte to abs word: *addr = *addr + imm              | imm, addr   |
| AIQ  | Add imm byte to zero-page long: *Q = *Q + imm              | imm, Q      |
| AZZ  | Add zero-page byte to zero-page byte: *Z2 = *Z2 + \*Z1     | Z1, Z2      |
| AZT  | Add ZP byte to rel ZP address: **Z2 = **Z2 + \*Z1          | Z1, Z2      |
| AZV  | Add zero-page byte to zero-page word: *V = *V + \*Z        | Z, V        |
| AZQ  | Add zero-page byte to zero-page long: *Q = *Q + \*Z        | Z, Q        |
| ABB  | Add abs byte to byte: *adr2 = *adr2 + \*adr1               | adr1, adr2  |
| ABW  | Add byte at ad1 to word at ad2: *ad2 = *ad2 + \*ad1        | ad1, ad2    |
| ATZ  | Add byte at rel ZP addr to ZP byte: \*Z2 = \*Z2 + \*\*Z1   | Z1, Z2      |
| ATT  | Add byte at rel ZP to rel ZP: **Z2 = **Z2 + \*\*Z1         | Z1, Z2      |
| AVV  | Add zero-page word to zero-page word: *V2 = *V2 + \*V1     | V1, V2      |
|      |                                                            |             |
| SUI  | Sub immediate from A: A = A - imm                          | imm         |
| SUZ  | Sub zero-page byte from A: A = A - \*Z                     | Z           |
| SUB  | Sub byte at addr from A: A = A - \*addr                    | addr        |
| SUT  | Sub byte at rel zero-page addr from A: A = A - \*\*Z       | Z           |
| SUR  | Sub byte at rel addr from A: A = A - \*\*addr              | addr        |
| SU.Z | Sub A from zero-page byte: *Z = *Z - A                     | Z           |
| SU.B | Sub A from byte at addr: *addr = *addr - A                 | addr        |
| SU.T | Sub A from rel zero-page address: **Z = **Z - A            | Z           |
| SU.R | Sub A from byte at rel addr: **addr = **addr - A           | addr        |
| SUV  | Sub A from zero-page word: *v = *V - A                     | V           |
| SUW  | Sub A from word at addr: *addr = *addr - A                 | addr        |
| SUQ  | Sub A from zero-page long: *Q = *Q - A                     | Q           |
| SIZ  | Sub immediate from zero-page byte: *Z = *Z - imm           | imm, Z      |
| SIB  | Sub imm from byte: *addr = *addr - imm                     | imm, addr   |
| SIT  | Sub imm from byte at rel Z addr: **Z = **Z + imm           | imm, Z      |
| SIR  | Sub imm from byte at rel addr: *(*ad) = *(*ad) + imm       | imm, addr   |
| SIV  | Sub imm byte from zero-page word: *V = *V - imm            | imm, V      |
| SIW  | Sub imm byte from abs word: *addr = *addr - imm            | imm, addr   |
| SIQ  | Sub imm byte from zero-page long Z: *Z = *Z - imm          | imm, Q      |
| SZZ  | Sub zero-page byte from Z byte: *Z2 = *Z2 - \*Z1           | Z1, Z2      |
| SZT  | Sub ZP byte from rel ZP address: **Z2 = **Z2 + \*Z1        | Z1, Z2      |
| SZV  | Sub zero-page byte from zero-page word: *V = *V - \*Z      | Z, V        |
| SZQ  | Sub zero-page byte from zero-page long: *Q = *Q - \*Z      | Z, Q        |
| SBB  | Sub abs byte from byte: *adr2 = *adr2 - \*adr1             | adr1, adr2  |
| SBW  | Sub abs byte from word at adr2: *adr2 = *adr2 - \*adr1     | adr1, adr2  |
| STZ  | Sub byte at rel ZP addr from ZP byte: \*Z2 = \*Z2 - \*\*Z1 | Z1, Z2      |
| STT  | Sub byte at rel ZP from rel ZP: **Z2 = **Z2 - \*\*Z1       | Z1, Z2      |
| SVV  | Sub zero-page word from word: *V2 = *V2 - \*V1             | V1, V2      |
|      |                                                            |             |
| CPI  | Compare imm byte to A: eval A - imm                        | imm         |
| CPZ  | Compare byte in zero-page to A: eval A - \*Z               | Z           |
| CPB  | Compare byte at addr to A: eval A - \*addr                 | addr        |
| CPT  | Compare byte at rel Z to A: eval A - \*\*Z                 | Z           |
| CPR  | Compare byte at rel addr to A: eval A - \*\*addr           | addr        |
| CIZ  | Compare imm byte to zero-page byte: LDZ Z CPI ..           | imm, Z      |
| CIB  | Compare imm byte to byte at addr: LDB addr CPI ..          | imm, addr   |
| CIT  | Compare imm byte to byte at rel Z: LDT Z CPI ..            | imm, Z      |
| CIR  | Compare imm byte to byte at rel addr: LDR addr CPI ..      | imm, addr   |
| CIV  | Compare imm word to word in ZP: eval \*V – imm             | imm, V      |
| CIW  | Compare imm word to ZP word: eval \*addr – imm             | imm, addr   |
| CZZ  | Compare byte in ZP to ZP byte: LDZ Z2 CPZ Z1               | Z1, Z2      |
| CZT  | Compare byte in ZP to rel ZP addr: LDT Z2 CPZ Z1           | Z1, Z2      |
| CBB  | Compare byte at adr1 to byte at adr2: LDB adr2 CPB adr1    | adr1, adr2  |
| CTZ  | Compare byte at rel ZP to ZP byte: LDZ Z2 CPT Z1           | Z1, Z2      |
| CTT  | Compare byte at rel ZP to rel ZP byte: LDT Z2 CPT Z1       | adr1, adr2  |
| CVV  | Compare word in ZP to ZP word: eval *V2 - *V1              | V1, V2      |
|      |                                                            |             |
| ACI  | Add imm byte to A with C: A = A + imm + C                  | imm         |
| ACZ  | Add byte in zero-page to A with C: A = A + \*Z + C         | Z           |
| AC.Z | Add A to zero-page byte with C: *Z = *Z + A + C            | Z           |
| SCI  | Sub imm byte from A with C: A = A - imm - 1 + C            | imm         |
| SCZ  | Sub byte in ZP from A with C: A = A - \*Z - 1 + C          | Z           |
| SC.Z | Sub A from zero-page byte with C: \*Z = \*Z - A - 1 + C    | Z           |

Addressing modes
I - Immediate
Z - Byte in Zero-page
V - Word in Zero-page
Q - Long in Zero-page
T - Byte pointer in Zero-page
B - Byte in RAM
W - Word in RAM
L - Long in RAM
R - Byte pointer in RAM
