' ============================================================
' SAP_GRETD_to_ETDAT.vbs
' Kullanim: Cift tikla, Excel yolunu gir, calisir
' Gereksinim: SAP acik + Scripting aktif + Excel KAPALI olmali
' ============================================================
Option Explicit

Dim EXCEL_PATH
EXCEL_PATH = InputBox("Excel dosyasinin tam yolunu girin:" & vbCrLf & vbCrLf & _
             "Ornek: C:\Users\furkan\Desktop\siparisler.xlsx", _
             "SAP GRETD - ETDAT", _
             "C:\Users\" & CreateObject("WScript.Shell").ExpandEnvironmentStrings("%USERNAME%") & "\Desktop\siparisler.xlsx")
If Trim(EXCEL_PATH) = "" Then WScript.Quit

' ---- SAP baglantisi ----
Dim oSap, oSession
On Error Resume Next
Set oSap = GetObject("SAPGUI")
If Err.Number <> 0 Then
    WScript.Echo "HATA: SAP GUI bulunamadi. SAP acik ve Scripting aktif mi?"
    WScript.Quit
End If
On Error GoTo 0
Set oSession = oSap.GetScriptingEngine.Children(0).Children(0)

' ---- Excel ac ----
Dim oExcel, oWb, oWs, lastRow
Set oExcel = CreateObject("Excel.Application")
oExcel.Visible = False
Set oWb   = oExcel.Workbooks.Open(EXCEL_PATH)
Set oWs   = oWb.Sheets(1)
lastRow   = oWs.Cells(oWs.Rows.Count, 1).End(-4162).Row

WScript.Echo lastRow - 1 & " satir bulundu. Islem basliyor..."

' ---- Ana dongu ----
Dim i, vbeln, sonuc
For i = 2 To lastRow
    vbeln = Trim(CStr(oWs.Cells(i, 1).Value))
    If vbeln <> "" And vbeln <> "0" Then
        If LCase(Trim(CStr(oWs.Cells(i, 2).Value))) <> "ok" Then
            sonuc = IslemYap(oSession, vbeln)
            oWs.Cells(i, 2).Value = sonuc
            oWb.Save
        End If
    End If
Next

oWb.Save
oWb.Close False
oExcel.Quit
Set oExcel = Nothing

WScript.Echo "Tum siparisler islendi!"

' ============================================================
' Her VBELN icin islem yapan fonksiyon
' Basarida "ok (N kalem)", hatada "HATA: ..." dondurur
' ============================================================
Function IslemYap(oSes, sVbeln)

    Dim gretd, r

    On Error Resume Next

    ' VA02 ac
    oSes.StartTransaction "VA02"
    Do While oSes.Children.Count > 1
        oSes.FindById("wnd[1]").SendVKey 0
        Err.Clear
    Loop

    ' VBELN gir
    oSes.FindById("wnd[0]/usr/ctxtVBAK-VBELN").Text = sVbeln
    oSes.FindById("wnd[0]").SendVKey 0
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

    If Err.Number <> 0 Then
        IslemYap = "HATA (tab02): " & Err.Description
        Exit Function
    End If

    ' Tum satirlara ETDAT yaz
    r = 0
    Do While r < 99
        Err.Clear
        oSes.FindById( _
            "wnd[0]/usr/tabsTAXI_TABSTRIP_OVERVIEW/tabpT\02" & _
            "/ssubSUBSCREEN_BODY:SAPMV45A:4401" & _
            "/subSUBSCREEN_TC:SAPMV45A:4900" & _
            "/tblSAPMV45ATCTRL_U_ERF_AUFTRAG" & _
            "/ctxtRV45A-ETDAT[11," & r & "]").Text = gretd
        If Err.Number <> 0 Then
            Err.Clear
            Exit Do
        End If
        r = r + 1
    Loop

    If r = 0 Then
        IslemYap = "ETDAT YAZILMADI"
        Exit Function
    End If

    ' Enter - Kaydet
    Err.Clear
    oSes.FindById("wnd[0]").SendVKey 0
    oSes.FindById("wnd[0]").SendVKey 11

    IslemYap = "ok (" & r & " kalem)"

End Function
