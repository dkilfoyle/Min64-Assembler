; copy z_CNT integers from z_PTR to z_PTR2
__arrIntCopy:
    MVV z_CNT,z_TMP LLZ z_TMP
    _arrIntCopyLoop:
        DEV z_TMP FCC __arrIntCopyEnd
        MTT z_PTR,z_PTR2 INV z_PTR INV z_PTR2 FPA __arrIntCopyLoop
    __arrIntCopyEnd: RTS
