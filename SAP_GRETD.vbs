' ============================================================
' SAP_GRETD_to_ETDAT.vbs
' Kullanim: Cift tikla → Excel yolunu gir → calisir
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
Dim i, r, vbeln, gretd
For i = 2 To lastRow

    vbeln = Trim(CStr(oWs.Cells(i, 1).Value))
    If vbeln = "" Or vbeln = "0" Then GoTo NextRow
    If LCase(Trim(CStr(oWs.Cells(i, 2).Value))) = "ok" Then GoTo NextRow

    ' VA02 ac
    On Error Resume Next
    oSession.StartTransaction "VA02"
    Do While oSession.Children.Count > 1
        oSession.FindById("wnd[1]").SendVKey 0
        Err.Clear
    Loop

    ' VBELN gir
    oSession.FindById("wnd[0]/usr/ctxtVBAK-VBELN").Text = vbeln
    oSession.FindById("wnd[0]").SendVKey 0
    Do While oSession.Children.Count > 1
        oSession.FindById("wnd[1]").SendVKey 0
        Err.Clear
    Loop

    If Err.Number <> 0 Then
        oWs.Cells(i, 2).Value = "HATA (giris): " & Err.Description
        Err.Clear
        GoTo NextRow
    End If

    ' Shipping tab - GRETD oku
    Err.Clear
    oSession.FindById("wnd[0]/usr/tabsTAXI_TABSTRIP_OVERVIEW/tabpT\06").Select
    gretd = oSession.FindById( _
        "wnd[0]/usr/tabsTAXI_TABSTRIP_OVERVIEW/tabpT\06" & _
        "/ssubSUBSCREEN_BODY:SAPMV45A:4403" & _
        "/subSUBSCREEN_TC:SAPMV45A:4921" & _
        "/tblSAPMV45ATCTRL_UEIN_VERSAND" & _
        "/ctxtRV45A-GRETD[3,0]").Text

    If Err.Number <> 0 Or Trim(gretd) = "" Then
        oWs.Cells(i, 2).Value = "GRETD BOS"
        Err.Clear
        GoTo NextRow
    End If

    ' Item Overview tab
    Err.Clear
    oSession.FindById("wnd[0]/usr/tabsTAXI_TABSTRIP_OVERVIEW/tabpT\02").Select
    If Err.Number <> 0 Then
        oWs.Cells(i, 2).Value = "HATA (tab): " & Err.Description
        Err.Clear
        GoTo NextRow
    End If

    ' Tum satirlara ETDAT yaz - hata gelince dur (o satir yok demek)
    r = 0
    Do While r < 99
        Err.Clear
        oSession.FindById( _
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
        oWs.Cells(i, 2).Value = "ETDAT YAZILMADI"
        GoTo NextRow
    End If

    ' Enter - Kaydet
    Err.Clear
    oSession.FindById("wnd[0]").SendVKey 0
    oSession.FindById("wnd[0]").SendVKey 11

    oWs.Cells(i, 2).Value = "ok (" & r & " kalem)"
    oWb.Save

NextRow:
    On Error GoTo 0
Next

oWb.Save
oWb.Close False
oExcel.Quit
Set oExcel = Nothing

WScript.Echo "Tum siparisler islendi!"
