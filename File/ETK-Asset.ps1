# ============================================================
# ETK Asset Management System
# Systemdaten-Sammlung MIT Netzwerklaufwerk-Erkennung über Registry
# ============================================================

# Konfiguration
$serverIP = "http://10.10.10.99"
$registryPath = "HKLM:\SOFTWARE\ETK-Asset"

# Basis-Informationen sammeln
$hostname = $env:COMPUTERNAME
$user = $env:USERNAME
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

Write-Host "`n=== ETK Asset Management ===" -ForegroundColor Cyan
Write-Host "Hostname: $hostname" -ForegroundColor Yellow
Write-Host "Benutzer: $user" -ForegroundColor Yellow
Write-Host "Zeitstempel: $timestamp" -ForegroundColor Yellow

# Betriebssystem-Informationen
try {
    Write-Host "`n[1/8] Sammle Betriebssystem-Informationen..." -ForegroundColor Cyan
    $osInfo = Get-WmiObject Win32_OperatingSystem
    $os = $osInfo.Caption
    $osVersion = $osInfo.Version
    $osArch = $osInfo.OSArchitecture
    # osBuild wird nicht verwendet, daher entfernt
    Write-Host "   OK Betriebssystem: $os" -ForegroundColor Green
}
catch {
    Write-Host "   FEHLER beim Abrufen der OS-Informationen" -ForegroundColor Red
    $os = "Unbekannt"
    $osVersion = "N/A"
    $osArch = "N/A"
}

# Hardware-Informationen
try {
    Write-Host "`n[2/8] Sammle Hardware-Informationen..." -ForegroundColor Cyan
    $computerSystem = Get-WmiObject Win32_ComputerSystem
    $manufacturer = $computerSystem.Manufacturer
    $model = $computerSystem.Model
    $totalRam = [Math]::Round($computerSystem.TotalPhysicalMemory / 1GB, 2)
    Write-Host "   OK Hersteller/Modell: $manufacturer / $model" -ForegroundColor Green
    Write-Host "   OK RAM: $totalRam GB" -ForegroundColor Green
}
catch {
    Write-Host "   FEHLER beim Abrufen der Hardware-Informationen" -ForegroundColor Red
    $manufacturer = "Unbekannt"
    $model = "N/A"
    $totalRam = 0
}

# CPU-Informationen
try {
    Write-Host "`n[3/8] Sammle CPU-Informationen..." -ForegroundColor Cyan
    $cpuInfo = Get-WmiObject Win32_Processor
    $cpu = $cpuInfo.Name
    $cpuCores = $cpuInfo.NumberOfCores
    $cpuThreads = $cpuInfo.NumberOfLogicalProcessors
    # cpuMaxSpeed wird nicht verwendet, daher entfernt
    Write-Host "   OK CPU: $cpu" -ForegroundColor Green
    Write-Host "   OK Kerne/Threads: $cpuCores / $cpuThreads" -ForegroundColor Green
}
catch {
    Write-Host "   FEHLER beim Abrufen der CPU-Informationen" -ForegroundColor Red
    $cpu = "Unbekannt"
    $cpuCores = 0
    $cpuThreads = 0
}

# BIOS-Informationen
try {
    Write-Host "`n[4/8] Sammle BIOS-Informationen..." -ForegroundColor Cyan
    $bios = Get-WmiObject Win32_BIOS
    $serialNumber = $bios.SerialNumber
    $biosVersion = $bios.SMBIOSBIOSVersion
    Write-Host "   OK Seriennummer: $serialNumber" -ForegroundColor Green
    Write-Host "   OK BIOS Version: $biosVersion" -ForegroundColor Green
}
catch {
    Write-Host "   FEHLER beim Abrufen der BIOS-Informationen" -ForegroundColor Red
    $serialNumber = "N/A"
    $biosVersion = "N/A"
}

# GPU-Informationen
try {
    Write-Host "`n[5/8] Sammle GPU-Informationen..." -ForegroundColor Cyan
    $gpus = @()
    $videoControllers = Get-WmiObject Win32_VideoController
    
    foreach ($gpu in $videoControllers) {
        $gpuInfo = @{
            Name = $gpu.Name
            DriverVersion = $gpu.DriverVersion
            AdapterRAMGB = if ($gpu.AdapterRAM) { [Math]::Round($gpu.AdapterRAM / 1GB, 2) } else { 0 }
            DriverDate = if ($gpu.DriverDate) { 
                try {
                    [DateTime]::ParseExact($gpu.DriverDate.Substring(0, 8), "yyyyMMdd", $null).ToString("yyyy-MM-dd")
                }
                catch {
                    $gpu.DriverDate
                }
            } else { "N/A" }
            VideoProcessor = $gpu.VideoProcessor
            VideoModeDescription = $gpu.VideoModeDescription
        }
        $gpus += $gpuInfo
        Write-Host "   OK GPU: $($gpu.Name)" -ForegroundColor Green
    }
    
    if ($gpus.Count -eq 0) {
        Write-Host "   INFO: Keine GPU gefunden" -ForegroundColor Yellow
    }
}
catch {
    Write-Host "   FEHLER beim Abrufen der GPU-Informationen" -ForegroundColor Red
    $gpus = @()
}

# Lokale Festplatten
try {
    Write-Host "`n[6/8] Sammle Festplatten-Informationen..." -ForegroundColor Cyan
    $localDrives = @()
    $disks = Get-WmiObject Win32_LogicalDisk -Filter "DriveType=3"  # Nur lokale Festplatten
    
    foreach ($disk in $disks) {
        $sizeGB = [Math]::Round($disk.Size / 1GB, 2)
        $freeGB = [Math]::Round($disk.FreeSpace / 1GB, 2)
        $usedGB = $sizeGB - $freeGB
        if ($sizeGB -gt 0) {
            $usedPercent = [Math]::Round(($usedGB / $sizeGB) * 100, 2)
        } else {
            $usedPercent = 0
        }
        
        $driveInfo = @{
            DeviceID = $disk.DeviceID
            SizeGB = $sizeGB
            FreeGB = $freeGB
            UsedGB = $usedGB
            UsedPercentage = $usedPercent
            VolumeName = $disk.VolumeName
            FileSystem = $disk.FileSystem
            VolumeSerialNumber = $disk.VolumeSerialNumber
            DriveType = "Lokale Festplatte"
        }
        $localDrives += $driveInfo
        
        Write-Host "   OK Laufwerk $($disk.DeviceID): $sizeGB GB ($usedPercent% verwendet)" -ForegroundColor Green
    }
    
    if ($localDrives.Count -eq 0) {
        Write-Host "   INFO: Keine lokalen Festplatten gefunden" -ForegroundColor Yellow
    }
}
catch {
    Write-Host "   FEHLER beim Abrufen der Festplatten-Informationen" -ForegroundColor Red
    $localDrives = @()
}

# Andere Laufwerke (USB, CD-ROM)
try {
    Write-Host "`n[7/8] Sammle andere Laufwerke..." -ForegroundColor Cyan
    $otherDrives = @()
    $drives = Get-WmiObject Win32_LogicalDisk | Where-Object { 
        $_.DriveType -ne 3  # Nicht lokale Festplatten
    }
    
    foreach ($drive in $drives) {
        $driveType = switch ($drive.DriveType) {
            2 { "USB-Laufwerk" }
            4 { "Netzwerklaufwerk (WMI)" }
            5 { "CD/DVD-Laufwerk" }
            default { "Unbekannt" }
        }
        
        # Netzwerklaufwerke über WMI werden ignoriert
        if ($drive.DriveType -ne 4) {
            $sizeGB = "N/A"
            if ($drive.Size) {
                $sizeGB = [Math]::Round($drive.Size / 1GB, 2)
            }
            
            $freeGB = "N/A"
            if ($drive.FreeSpace) {
                $freeGB = [Math]::Round($drive.FreeSpace / 1GB, 2)
            }
            
            $driveInfo = @{
                DeviceID = $drive.DeviceID
                DriveType = $driveType
                SizeGB = $sizeGB
                FreeGB = $freeGB
                VolumeName = $drive.VolumeName
                FileSystem = $drive.FileSystem
            }
            $otherDrives += $driveInfo
            
            Write-Host "   OK $driveType $($drive.DeviceID)" -ForegroundColor Green
        } else {
            Write-Host "   INFO: Ignoriere WMI-Netzwerklaufwerk $($drive.DeviceID)" -ForegroundColor Gray
        }
    }
}
catch {
    Write-Host "   FEHLER beim Abrufen anderer Laufwerke" -ForegroundColor Red
    $otherDrives = @()
}

# Netzwerklaufwerke über Registry erkennen (HKCU)
try {
    Write-Host "`n[8/8] Sammle Netzwerklaufwerke aus Registry..." -ForegroundColor Cyan
    $networkDrives = @()
    
    # Prüfe, ob der Registry-Pfad existiert
    if (Test-Path "HKCU:\Network") {
        $networkKeys = Get-ChildItem "HKCU:\Network" -ErrorAction SilentlyContinue
        
        foreach ($key in $networkKeys) {
            $driveLetter = $key.PSChildName
            $drivePath = "HKCU:\Network\$driveLetter"
            
            try {
                $regValues = Get-ItemProperty -Path $drivePath -ErrorAction SilentlyContinue
                
                $driveInfo = @{
                    DeviceID = "$driveLetter" + ":"
                    ProviderName = if ($regValues.ProviderName) { $regValues.ProviderName } else { "Unbekannt" }
                    RemotePath = if ($regValues.RemotePath) { $regValues.RemotePath } else { "N/A" }
                    ConnectionType = if ($regValues.ConnectionType) { 
                        switch ($regValues.ConnectionType) {
                            1 { "Laufwerk" }
                            default { "Anderer Typ ($($regValues.ConnectionType))" }
                        }
                    } else { "N/A" }
                    UserName = if ($regValues.UserName) { $regValues.UserName } else { "N/A" }
                    Source = "Registry (HKCU)"
                }
                
                $networkDrives += $driveInfo
                Write-Host "   OK Netzwerklaufwerk $($driveInfo.DeviceID): $($driveInfo.RemotePath)" -ForegroundColor Green
            }
            catch {
                Write-Host "   INFO: Fehler beim Lesen von Laufwerk $driveLetter" -ForegroundColor Yellow
            }
        }
        
        if ($networkDrives.Count -eq 0) {
            Write-Host "   INFO: Keine Netzwerklaufwerke in Registry gefunden" -ForegroundColor Yellow
        }
    } else {
        Write-Host "   INFO: Registry-Pfad HKCU:\Network existiert nicht" -ForegroundColor Yellow
    }
}
catch {
    Write-Host "   FEHLER beim Abrufen der Netzwerklaufwerke aus Registry" -ForegroundColor Red
    $networkDrives = @()
}

# Asset-Nummer verwalten
function Get-AssetNumber {
    try {
        if (Test-Path $registryPath) {
            $asset = Get-ItemProperty -Path $registryPath -Name "AssetNumber" -ErrorAction SilentlyContinue
            if ($asset -and $asset.AssetNumber) {
                return $asset.AssetNumber
            }
        }
        
        $newAsset = -join ((48..57 + 65..90 | Get-Random -Count 8) | ForEach-Object { [char]$_ })
        
        if (-not (Test-Path $registryPath)) {
            New-Item -Path $registryPath -Force | Out-Null
        }
        
        Set-ItemProperty -Path $registryPath -Name "AssetNumber" -Value $newAsset -Force
        return $newAsset
    }
    catch {
        Write-Host "Warnung: Konnte Asset-Nummer nicht in Registry speichern" -ForegroundColor Yellow
        return "TEMP-" + (Get-Date -Format "yyyyMMddHHmmss")
    }
}

# Metadaten aus Registry lesen
function Get-AssetMetadata {
    $metadata = @{
        Location = ""
        Status = "in Betrieb"
        Notes = ""
    }
    
    try {
        if (Test-Path $registryPath) {
            $regData = Get-ItemProperty -Path $registryPath
            
            if ($regData.Location) { $metadata.Location = $regData.Location }
            if ($regData.Status) { $metadata.Status = $regData.Status }
            if ($regData.Notes) { $metadata.Notes = $regData.Notes }
        }
    }
    catch {
        # Keine Warnung, da optional
    }
    
    return $metadata
}

# Netzwerkadapter-Informationen
function Get-NetworkAdapters {
    $adapters = @()
    
    try {
        $networkConfigs = Get-WmiObject Win32_NetworkAdapterConfiguration | Where-Object { $_.IPEnabled }
        
        foreach ($adapter in $networkConfigs) {
            $adapterInfo = @{
                Description = $adapter.Description
                MACAddress = $adapter.MACAddress
                IPAddress = if ($adapter.IPAddress) { $adapter.IPAddress[0] } else { "N/A" }
                SubnetMask = if ($adapter.IPSubnet) { $adapter.IPSubnet[0] } else { "N/A" }
                DefaultGateway = if ($adapter.DefaultIPGateway) { $adapter.DefaultIPGateway[0] } else { "N/A" }
                DNSServers = if ($adapter.DNSServerSearchOrder) { $adapter.DNSServerSearchOrder -join ", " } else { "N/A" }
                DHCPEnabled = $adapter.DHCPEnabled
            }
            $adapters += $adapterInfo
        }
    }
    catch {
        # Fehler ignorieren, nicht kritisch
    }
    
    return $adapters
}

# Hauptfunktion: JSON-Daten erstellen
function New-SystemData {
    Write-Host "`n=== Erstelle JSON-Datenstruktur ===" -ForegroundColor Cyan
    
    # Asset-Informationen
    $assetNumber = Get-AssetNumber
    $metadata = Get-AssetMetadata
    $networkAdapters = Get-NetworkAdapters
    
    # JSON-Datenstruktur erstellen - angepasst an die HTML-Anwendung
    $systemData = @{
        assetNumber = $assetNumber
        hostname = $hostname
        user = $user
        timestamp = $timestamp
        os = $os
        osVersion = $osVersion
        osArch = $osArch
        manufacturer = $manufacturer
        model = $model
        serialNumber = $serialNumber
        biosVersion = $biosVersion
        cpu = $cpu
        cores = $cpuCores
        logicalProc = $cpuThreads
        ramGB = $totalRam
        gpu = $gpus
        network = $networkAdapters
        drives = @{
            localDrives = $localDrives
            otherDrives = $otherDrives
            networkDrives = $networkDrives
        }
        location = $metadata.Location
        status = $metadata.Status
        notes = $metadata.Notes
    }
    
    Write-Host "OK JSON-Datenstruktur erstellt" -ForegroundColor Green
    Write-Host "  Enthält $($networkDrives.Count) Netzwerklaufwerke aus Registry" -ForegroundColor Gray
    return $systemData
}

# Daten an Server senden
function Send-DataToServer {
    param(
        [Parameter(Mandatory=$true)]
        [object]$Data
    )
    
    try {
        $jsonData = $Data | ConvertTo-Json -Depth 10
        $uri = "$serverIP/api/devices"
        
        Write-Host "`n=== Sende Daten an Server ===" -ForegroundColor Cyan
        Write-Host "Ziel: $uri" -ForegroundColor Yellow
        
        $headers = @{
            "Content-Type" = "application/json"
            "User-Agent" = "ETK-Asset-Management/2.2"
        }
        
        $response = Invoke-RestMethod -Uri $uri -Method Post -Body $jsonData -Headers $headers -TimeoutSec 30 -ErrorAction Stop
        
        Write-Host "OK Daten erfolgreich gesendet!" -ForegroundColor Green
        
        if ($response.message) {
            Write-Host "Serverantwort: $($response.message)" -ForegroundColor Green
        }
        
        return $true
    }
    catch [System.Net.WebException] {
        Write-Host "FEHLER: Netzwerkfehler - Server nicht erreichbar" -ForegroundColor Red
        Write-Host "  Details: $($_.Exception.Message)" -ForegroundColor Gray
        return $false
    }
    catch {
        Write-Host "FEHLER beim Senden der Daten" -ForegroundColor Red
        Write-Host "  Details: $_" -ForegroundColor Gray
        return $false
    }
}

# Zusammenfassung anzeigen
function Show-Summary {
    param(
        [Parameter(Mandatory=$true)]
        [object]$Data
    )
    
    Write-Host "`n" + ("=" * 50) -ForegroundColor Cyan
    Write-Host "ZUSAMMENFASSUNG" -ForegroundColor Cyan
    Write-Host ("=" * 50) -ForegroundColor Cyan
    
    Write-Host "`nBASISINFORMATIONEN:" -ForegroundColor Yellow
    Write-Host "  Asset-Nummer:   $($Data.assetNumber)" -ForegroundColor Gray
    Write-Host "  Hostname:       $($Data.hostname)" -ForegroundColor Gray
    Write-Host "  Benutzer:       $($Data.user)" -ForegroundColor Gray
    Write-Host "  Zeitstempel:    $($Data.timestamp)" -ForegroundColor Gray
    
    Write-Host "`nBETRIEBSSYSTEM:" -ForegroundColor Yellow
    Write-Host "  Name:           $($Data.os)" -ForegroundColor Gray
    Write-Host "  Version:        $($Data.osVersion)" -ForegroundColor Gray
    Write-Host "  Architektur:    $($Data.osArch)" -ForegroundColor Gray
    
    Write-Host "`nHARDWARE:" -ForegroundColor Yellow
    Write-Host "  Hersteller:     $($Data.manufacturer)" -ForegroundColor Gray
    Write-Host "  Modell:         $($Data.model)" -ForegroundColor Gray
    Write-Host "  Seriennummer:   $($Data.serialNumber)" -ForegroundColor Gray
    Write-Host "  BIOS Version:   $($Data.biosVersion)" -ForegroundColor Gray
    Write-Host "  CPU:            $($Data.cpu)" -ForegroundColor Gray
    Write-Host "  Kerne/Threads:  $($Data.cores)/$($Data.logicalProc)" -ForegroundColor Gray
    Write-Host "  RAM:            $($Data.ramGB) GB" -ForegroundColor Gray
    
    if ($Data.gpu.Count -gt 0) {
        Write-Host "  Grafikkarten:" -ForegroundColor Yellow
        foreach ($gpu in $Data.gpu) {
            Write-Host "    - $($gpu.Name)" -ForegroundColor Gray
        }
    }
    
    Write-Host "`nFESTPLATTEN:" -ForegroundColor Yellow
    if ($Data.drives.localDrives.Count -gt 0) {
        foreach ($drive in $Data.drives.localDrives) {
            Write-Host "  $($drive.DeviceID): $($drive.SizeGB) GB ($($drive.UsedPercentage)% verwendet)" -ForegroundColor Gray
        }
    } else {
        Write-Host "  Keine lokalen Festplatten gefunden" -ForegroundColor Gray
    }
    
    if ($Data.drives.otherDrives.Count -gt 0) {
        Write-Host "`nANDERE LAUFWERKE:" -ForegroundColor Yellow
        foreach ($drive in $Data.drives.otherDrives) {
            if ($drive.SizeGB -ne "N/A") {
                Write-Host "  $($drive.DeviceID): $($drive.DriveType) - $($drive.SizeGB) GB" -ForegroundColor Gray
            } else {
                Write-Host "  $($drive.DeviceID): $($drive.DriveType)" -ForegroundColor Gray
            }
        }
    }
    
    # Netzwerklaufwerke anzeigen
    if ($Data.drives.networkDrives.Count -gt 0) {
        Write-Host "`nNETZWERKLAUFWERKE:" -ForegroundColor Yellow
        foreach ($drive in $Data.drives.networkDrives) {
            Write-Host "  $($drive.DeviceID): $($drive.RemotePath)" -ForegroundColor Gray
            if ($drive.UserName -ne "N/A") {
                Write-Host "      Benutzer: $($drive.UserName)" -ForegroundColor DarkGray
            }
        }
    }
    
    if ($Data.location -or $Data.notes) {
        Write-Host "`nMETADATEN:" -ForegroundColor Yellow
        if ($Data.location) {
            Write-Host "  Standort:       $($Data.location)" -ForegroundColor Gray
        }
        Write-Host "  Status:         $($Data.status)" -ForegroundColor Gray
        if ($Data.notes) {
            Write-Host "  Bemerkungen:    $($Data.notes)" -ForegroundColor Gray
        }
    }
    
    Write-Host "`n" + ("=" * 50) -ForegroundColor Cyan
}

# Hauptausführungsblock
try {
    # Zeige Header
    Write-Host "`n" + ("=" * 60) -ForegroundColor Cyan
    Write-Host "ETK ASSET MANAGEMENT SYSTEM" -ForegroundColor White -BackgroundColor DarkBlue
    Write-Host "Version 2.2 - MIT Netzwerklaufwerk-Erkennung (Registry)" -ForegroundColor Yellow
    Write-Host ("=" * 60) -ForegroundColor Cyan
    
    # Daten sammeln und zusammenstellen
    $systemData = New-SystemData
    
    # Zusammenfassung anzeigen
    Show-Summary -Data $systemData
    
    # Benutzerabfrage
    Write-Host "`nMöchten Sie die Daten an den Server senden?" -ForegroundColor Yellow
    $confirmation = Read-Host "  (J/N) [Standard: J]"
    
    if ($confirmation -ne 'N' -and $confirmation -ne 'n') {
        # Daten an Server senden
        $success = Send-DataToServer -Data $systemData
        
        if ($success) {
            Write-Host "`n" + ("=" * 60) -ForegroundColor Green
            Write-Host "ERFOLG: Vorgang erfolgreich abgeschlossen" -ForegroundColor White -BackgroundColor Green
            Write-Host ("=" * 60) -ForegroundColor Green
        } else {
            Write-Host "`n" + ("=" * 60) -ForegroundColor Red
            Write-Host "FEHLER: Daten konnten nicht gesendet werden" -ForegroundColor White -BackgroundColor Red
            Write-Host ("=" * 60) -ForegroundColor Red
            Write-Host "`nTipps:" -ForegroundColor Yellow
            Write-Host "  1. Überprüfen Sie die Netzwerkverbindung" -ForegroundColor Gray
            Write-Host "  2. Stellen Sie sicher, dass der Server erreichbar ist" -ForegroundColor Gray
            Write-Host "  3. Überprüfen Sie die Server-URL: $serverIP" -ForegroundColor Gray
        }
    } else {
        Write-Host "`nVorgang abgebrochen. Daten wurden nicht gesendet." -ForegroundColor Yellow
    }
}
catch {
    Write-Host "`n" + ("=" * 60) -ForegroundColor Red
    Write-Host "KRITISCHER FEHLER" -ForegroundColor White -BackgroundColor Red
    Write-Host ("=" * 60) -ForegroundColor Red
    Write-Host "Fehlerdetails: $_" -ForegroundColor Red
    Write-Host "`nDas Skript wird beendet." -ForegroundColor Yellow
    exit 1
}

Write-Host "`nSkript beendet." -ForegroundColor Cyan