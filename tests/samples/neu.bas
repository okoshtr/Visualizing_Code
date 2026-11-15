Option Explicit

Function Bewertung(ByVal punkte As Long, Optional ByVal maximum As Long = 10) As String
    Select Case punkte
        Case Is >= maximum
            Bewertung = "perfekt"
        Case 5 To 9
            Bewertung = "gut"
        Case Else
            Bewertung = "üben"
    End Select
End Function

Sub Main()
    Dim i As Long
    i = 0
    Do
        i = i + 3
    Loop Until i > 7
    Debug.Print "i = " & i
    Debug.Print Bewertung(10)
    Debug.Print Bewertung(6, 20)
    Debug.Print Bewertung(1)
End Sub
