; Sign-extends A into the __A zero-page word
__signext:
    STZ z_A+0 LL1 FCS sext_neg
      CLZ z_A+1 RTS
    sext_neg: MIZ 0xff,z_A+1 RTS