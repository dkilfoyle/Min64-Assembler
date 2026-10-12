; copy z_B Chars from z_PTR to z_PTR2
__memCopy:
    DEV z_B FCC __memCopyEnd
    MTT z_PTR,z_PTR2 INV z_PTR INV z_PTR2 FPA __memCopy
    __memCopyEnd: RTS
    