; copy z_A into *z_PTR`
__copyZA:
  MZT z_A+0,z_PTR INV z_PTR         
  MZT z_A+1,z_PTR DEV z_PTR          
  RTS