; store z_A into runtime stack @ z_PTR
__storeZA:
  MZT z_A+1,z_PTR DEV z_PTR         
  MZT z_A+0,z_PTR INV z_PTR          
  RTS