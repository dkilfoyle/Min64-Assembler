; set z_PTR and load z_A from @z_Ptr
__ldZA:
  MVV z_FP,z_PTR LDS 3 SUV z_PTR
  MTZ z_PTR,z_A+1 DEV z_PTR      
  MTZ z_PTR,z_A+0 INV z_PTR
  RTS

; load z_A from precomputed z_PTR
__ldCachedZA:
  MTZ z_PTR,z_A+1 DEV z_PTR      
  MTZ z_PTR,z_A+0 INV z_PTR
  RTS