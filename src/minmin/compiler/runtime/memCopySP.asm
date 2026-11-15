; copy z_B Chars from *z_A to z_SP
__memCopySP:
    DEV z_B FCC __memCopySPEnd
    MTT z_A,z_SP INV z_A INV z_SP FPA __memCopySP
    __memCopySPEnd: RTS
    