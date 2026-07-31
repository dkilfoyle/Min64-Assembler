      #org 0x0100

; test sub to positive byte
      JPS _Print "Byte SUB to pos (5-2): ",0
      JAS init_test
      LDI 0x5
      SUI 0x2
      JAS dump

; test sub to positive word
      JPS _Print "Word SUV to pos (5-2): ",0
      JAS init_test
      MIZ 0x00 1
      MIZ 0x05 0
      LDI 2
      SUV 0x0 ;v-v-a
      JAS dump

; test sub to negative byte
      JPS _Print "Byte SUB to neg (5-7): ",0
      JAS init_test
      LDI 0x5
      SUI 0x7
      JAS dump

; sub to negative small word
      JPS _Print "Word SUV to neg (5-7): ",0
      JAS init_test
      MIZ 0x00 1
      MIZ 0x05 0
      LDI 7
      SUV 0x0 ;v-v-a
      JAS dump

; sub to negative large word
      JPS _Print "Word SUV to neg (5-255): ",0
      JAS init_test
      MIZ 0x00 1
      MIZ 0x05 0
      LDI 255
      SUV 0x0 ;v-v-a
      JAS dump

; sub with borrow
      JPS _Print "SCI positive (255-2): ",0
      JAS init_test
      LDI 255
      SCI 2
      JAS dump

; sub with borrow
      JPS _Print "SCI negative (5-7): ",0
      JAS init_test
      LDI 5
      SCI 7
      JAS dump

done:
      JPA _Prompt
  
init_test: ; zero flags and a and *0 *1
      CLQ 0
      CLQ 4
      LDI 10
      INC ; // flags to 0
      RTS     

dump:
      STZ 2 ; save a to Z2
  checkN:
      BMI dumpN
  checkC:
      BCS dumpC
  checkZ:
      BEQ dumpZ
  flagsDone:
      LDI 0
      ADZ 3
      ADZ 4
      ADZ 5
      STZ 6 ; save flags to 6
  print_summary:
      JPS _Print "a=0x",0
      LDZ 2 JAS _PrintHex     ; // A
      JPS _Print "  res=0x",0
      LDZ 1 JAS _PrintHex     ; // hi byte result
      LDZ 0 JAS _PrintHex     ; // lo byte result
      JPS _Print "  flags=", 0
      LDZ 6 JAS _PrintHex     ; // flags
      JPS _Print 10, 0
      RTS
  dumpN:
      MIZ 4, 3 JPA checkC ; save N to 3
  dumpC:
      MIZ 2, 4 JPA checkZ ; save C to 4
  dumpZ:
      MIZ 1, 5 JPA flagsDone ; save Z to 5

; 01 02 03 04 05 06
; rl rh FN FC FZ Ft

#org 0xf003 _Prompt:
#org 0xf042 _PrintChar:
#org 0xf045 _Print:
#org 0xf048 _PrintPtr:
#org 0xf04b _PrintHex:
