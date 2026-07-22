; left < right: left in stack, right in z_b <=> l + (-r) < 0
__lt16:
  NEV z_B                               ; l < r 
  LDS 2 AD.Z z_B+1 LDS 2 ADV z_B+0      ; z_B += pop (-r += l)
  FMI __lt16true
    CLV z_A RTS
  __lt16true:
    MIV 0xffff,z_A RTS
