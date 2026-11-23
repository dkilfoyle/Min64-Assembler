; expect offset from z_FP2 in z_TMP1
; injects the &var at z_PTR
; z_PTR will be address of var[0] in stack

__getVarPtr:
  MVV z_FP2,z_TMP2
  AVV z_TMP1,z_TMP2              ; z_TMP2=&*var
  MRZ z_TMP2,z_PTR+0 INV z_TMP2  ; dereference
  MRZ z_TMP2,z_PTR+1 
  ;MTZ z_PTR,z_TMP1+0 INV z_PTR
  ;MTZ z_PTR,z_TMP1+1
  ;MVV z_TMP1,z_PTR
  RTS

__getVarVal:
  MVV z_FP2,z_TMP2
  AVV z_TMP1,z_TMP2              ; z_TMP2=&*var
  MRZ z_TMP2,z_PTR+0 INV z_TMP2  ; dereference
  MRZ z_TMP2,z_PTR+1 
  MTZ z_PTR,z_A+0 INV z_PTR
  MTZ z_PTR,z_A+1
  RTS

__getVarValue:
  MVV z_FP2,z_TMP2
  AVV z_TMP1,z_TMP2              ; z_TMP2=&*var
  MRZ z_TMP2,z_PTR+0 INV z_TMP2  ; dereference
  MRZ z_TMP2,z_PTR+1 

  MWV z_PTR,z_A
  RTS

__getVarPtr2:
  MVV z_FP2,z_TMP2
  AVV z_TMP1,z_TMP2               ; z_TMP2=&*var
  MRZ z_TMP2,z_PTR2+0 INV z_TMP2  ; dereference
  MRZ z_TMP2,z_PTR2+1 
  RTS
