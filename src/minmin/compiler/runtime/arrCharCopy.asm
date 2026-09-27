; copy z_CNT Chars from z_PTR to z_PTR2
__arrCharCopy:
    MVV z_CNT,z_TMP
    __arrCharCopyLoop:
        DEV z_TMP FCC __arrCharCopyEnd
        MTT z_PTR,z_PTR2 INV z_PTR INV z_PTR2 FPA __arrCharCopyLoop
    __arrCharCopyEnd: RTS