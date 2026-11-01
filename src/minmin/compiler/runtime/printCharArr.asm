; print z_CNT Chars from address in z_A
__printCharArr:
    MVV z_CNT,z_TMP1
    __printCharArrLoop:
        DEV z_TMP1 FCC __printCharArrEnd
        LDT z_A 
        JAS _PrintChar
        INZ z_A
        FPA __printCharArrLoop
    __printCharArrEnd: RTS