' ============================================================
' SAP_GRETD_to_ETDAT.vbs
' Kullanim: SAP_GRETD_CALISTIR.bat ile ac (komut satirinda gorursun)
' Gereksinim: SAP acik + Scripting aktif + Excel KAPALI olmali
' ============================================================
Option Explicit

Dim EXCEL_PATH
EXCEL_PATH = InputBox("Excel dosyasinin tam yolunu girin:" & vbCrLf & vbCrLf & _
             "Ornek: C:\Users\furkan\Desktop\siparisler.xlsx", _
             "SAP GRETD - ETDAT", _
             "C:\Users\" & CreateObject("WScript.Shell").ExpandEnvironmentStrings("%USERNAME%") & "\Desktop\siparisler.xlsx")
If Trim(EXCEL_PATH) = "" Then WScript.Quit

Log "Basliyor..."

' ---- SAP baglantisi ----
Dim oSap, oSession
On Error Resume Next
Set oSap = GetObject("SAPGUI")
If Err.Number <> 0 Then
    Log "HATA: SAP GUI bulunamadi. SAP acik ve Scripting aktif mi?"
    WScript.Quit
End If
On Error GoTo 0
Set oSession = oSap.GetScriptingEngine.Children(0).Children(0)
Log "SAP baglantisi OK"

' ---- Excel ac ----
Dim oExcel, oWb, oWs, lastRow
Set oExcel = CreateObject("Excel.Application")
oExcel.Visible = False
Set oWb   = oExcel.Workbooks.Open(EXCEL_PATH)
Set oWs   = oWb.Sheets(1)
lastRow   = oWs.Cells(oWs.Rows.Count, 1).End(-4162).Row
Log "Excel acildi: " & lastRow - 1 & " satir bulundu"

' ---- Ana dongu ----
Dim i, vbeln, sonuc, islemSayisi, atlanSayisi
islemSayisi = 0
atlanSayisi = 0

For i = 2 To lastRow
    vbeln = Trim(CStr(oWs.Cells(i, 1).Value))
    If vbeln <> "" And vbeln <> "0" Then
        If LCase(Trim(CStr(oWs.Cells(i, 2).Value))) = "ok" Then
            Log "[" & i-1 & "/" & lastRow-1 & "] ATLANDI (zaten ok): " & vbeln
            atlanSayisi = atlanSayisi + 1
        Else
            Log ""
            Log "---------------------------------------"
            Log "[" & i-1 & "/" & lastRow-1 & "] Siradaki: " & vbeln
            Log "Devam etmek icin ENTER'a basin..."
            Log "Durdurmak icin CTRL+C'ye basin."
            Log "---------------------------------------"
            WScript.StdIn.ReadLine   ' ENTER bekle
            Log "Isleniyor: " & vbeln & " ..."
            sonuc = IslemYap(oSession, vbeln)
            oWs.Cells(i, 2).Value = sonuc
            oWb.Save
            Log "    --> " & sonuc
            islemSayisi = islemSayisi + 1
        End If
    End If
Next

oWb.Save
oWb.Close False
oExcel.Quit
Set oExcel = Nothing

Log ""
Log "========================================="
Log "BITTI! Islenen: " & islemSayisi & "  Atlanan: " & atlanSayisi
Log "========================================="
WScript.Echo "Bitti! Islenen: " & islemSayisi & "  Atlanan: " & atlanSayisi

' ============================================================
Function IslemYap(oSes, sVbeln)

    Dim gretd, r

    Dim oShell
    Set oShell = CreateObject("WScript.Shell")

    On Error Resume Next

    ' VA02 ac — SAP penceresi one gelsin
    oSes.StartTransaction "VA02"
    WScript.Sleep 600
    oShell.AppActivate "SAP"
    WScript.Sleep 400
    Do While oSes.Children.Count > 1
        oSes.FindById("wnd[1]").SendVKey 0
        Err.Clear
    Loop

    ' VBELN gir — kullanici gorsubn
    oSes.FindById("wnd[0]/usr/ctxtVBAK-VBELN").Text = sVbeln
    WScript.Sleep 500
    oSes.FindById("wnd[0]").SendVKey 0
    WScript.Sleep 800
    Do While oSes.Children.Count > 1
        oSes.FindById("wnd[1]").SendVKey 0
        Err.Clear
    Loop

    If Err.Number <> 0 Then
        IslemYap = "HATA (giris): " & Err.Description
        Exit Function
    End If

    ' Shipping tab - GRETD oku
    Err.Clear
    oSes.FindById("wnd[0]/usr/tabsTAXI_TABSTRIP_OVERVIEW/tabpT\06").Select
    WScript.Sleep 700
    gretd = oSes.FindById( _
        "wnd[0]/usr/tabsTAXI_TABSTRIP_OVERVIEW/tabpT\06" & _
        "/ssubSUBSCREEN_BODY:SAPMV45A:4403" & _
        "/subSUBSCREEN_TC:SAPMV45A:4921" & _
        "/tblSAPMV45ATCTRL_UEIN_VERSAND" & _
        "/ctxtRV45A-GRETD[3,0]").Text

    If Err.Number <> 0 Or Trim(gretd) = "" Then
        IslemYap = "GRETD BOS"
        Exit Function
    End If

    ' Item Overview tab
    Err.Clear
    oSes.FindById("wnd[0]/usr/tabsTAXI_TABSTRIP_OVERVIEW/tabpT\02").Select
    WScript.Sleep 700

    If Err.Number <> 0 Then
        IslemYap = "HATA (tab02): " & Err.Description
        Exit Function
    End If

    ' Dolu satirlara ETDAT yaz (bos satiri atla)
    ' Her satir icin once item numarasini oku — bossa satir bos demek
    Dim sPosnr, sEtdat
    r = 0
    Do While r < 99
        Err.Clear

        ' Item numarasi (kolon 0) bossa bu satir bos — dur
        sPosnr = oSes.FindById( _
            "wnd[0]/usr/tabsTAXI_TABSTRIP_OVERVIEW/tabpT\02" & _
            "/ssubSUBSCREEN_BODY:SAPMV45A:4401" & _
            "/subSUBSCREEN_TC:SAPMV45A:4900" & _
            "/tblSAPMV45ATCTRL_U_ERF_AUFTRAG" & _
            "/txtRV45A-POSNR[0," & r & "]").Text
        If Err.Number <> 0 Or Trim(sPosnr) = "" Then
            Err.Clear
            Exit Do
        End If

        ' Bu satir doluysa ETDAT'a yaz
        Err.Clear
        oSes.FindById( _
            "wnd[0]/usr/tabsTAXI_TABSTRIP_OVERVIEW/tabpT\02" & _
            "/ssubSUBSCREEN_BODY:SAPMV45A:4401" & _
            "/subSUBSCREEN_TC:SAPMV45A:4900" & _
            "/tblSAPMV45ATCTRL_U_ERF_AUFTRAG" & _
            "/ctxtRV45A-ETDAT[11," & r & "]").Text = gretd
        If Err.Number <> 0 Then
            Err.Clear
        End If

        r = r + 1
    Loop

    If r = 0 Then
        IslemYap = "ETDAT YAZILMADI"
        Exit Function
    End If

    ' *** KAYDETME YOK — kullanici SAP'de kendisi kaydedecek ***
    IslemYap = "YAZILDI (" & r & " kalem, GRETD=" & gretd & ") — sen kaydet"

End Function

' ---- Anlık log (cscript ile konsolda, wscript ile yoksayilir) ----
Sub Log(mesaj)
    On Error Resume Next
    WScript.StdOut.WriteLine Now() & "  " & mesaj
End Sub
