; expect offset from z_SP2 in z_TMP1
; injects the &var at z_PTR
; z_PTR will be address of var[0] in stack
__getVarPtr:
  MVV z_SP2,z_TMP2
  SVV z_TMP1,z_TMP2    ; z_TMP2=&*var
  MWV z_TMP2,z_PTR     ; derefernce ptr in z_TMP2 to z_PTR2
  RTS

__getVarPtr2:
  MVV z_SP2,z_TMP2
  SVV z_TMP1,z_TMP2               ; z_TMP2=&*var
  MRZ z_TMP2,z_PTR2+0 INV z_TMP2  ; dereference
  MRZ z_TMP2,z_PTR2+1 
  RTS
