; store z_A into runtime stack @ z_Ptr
__sdZA:
  MVV z_FP,z_PTR LDS 3 SUV z_PTR
  MZT z_A+1,z_PTR DEV z_PTR         
  MZT z_A+0,z_PTR INV z_PTR          
  RTS

; store z_A into runtime stack @ z_Ptr
__sdCachedZA:
  MZT z_A+1,z_PTR DEV z_PTR         
  MZT z_A+0,z_PTR INV z_PTR       
  RTS