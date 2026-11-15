Option Explicit

' Zählt die Vokale in einem Text
Function ZaehleVokale(ByVal text As String) As Long
    Dim i As Long
    Dim anzahl As Long
    anzahl = 0
    For i = 1 To Len(text)
        If InStr("aeiou", LCase(Mid(text, i, 1))) > 0 Then
            anzahl = anzahl + 1
        End If
    Next i
    ZaehleVokale = anzahl
End Function

Sub Main()
    Dim wort As String
    Dim zahl As Long
    wort = "Programmieren"
    Debug.Print "Vokale in " & wort & ": " & ZaehleVokale(wort)
    zahl = 1
    Do While zahl < 100
        zahl = zahl * 2
    Loop
    Debug.Print "Zahl: "; zahl
    If zahl > 100 Then Debug.Print "groß" Else Debug.Print "klein"
    Dim k As Long
    For k = 10 To 0 Step -5
        Debug.Print k
    Next k
End Sub
