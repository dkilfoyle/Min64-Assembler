; set z_PTR and load z_A from @z_Ptr
__loadZA:
  MTZ z_PTR,z_A+1 DEV z_PTR      
  MTZ z_PTR,z_A+0 INV z_PTR
  RTS