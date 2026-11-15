; copy z_B Chars from *z_A to z_PTR2
__memCopyPTR2:
    DEV z_B FCC __memCopyPTR2End
    MTT z_A,z_PTR2 INV z_A INV z_PTR2 FPA __memCopyPTR2
    __memCopyPTR2End: RTS
    