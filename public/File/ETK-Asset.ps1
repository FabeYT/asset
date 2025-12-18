# ============================================================
# Gerätedaten sammeln und an Server senden
# ============================================================

 $ip = "DIE IP ADRESSE"
 $hostname = $env:COMPUTERNAME
 $user = $env:USERNAME
 $os = (Get-WmiObject Win32_OperatingSystem).Caption
 $osVersion = (Get-WmiObject Win32_OperatingSystem).Version
 $osArch = (Get-WmiObject Win32_OperatingSystem).OSArchitecture
 $manufacturer = (Get-WmiObject Win32_ComputerSystem).Manufacturer
 $model = (Get-WmiObject Win32_ComputerSystem).Model
 $serial = (Get-WmiObject Win32_BIOS).SerialNumber
 $biosVersion = (Get-WmiObject Win32_BIOS).SMBIOSBIOSVersion
 $cpu = (Get-WmiObject Win32_Processor).Name
 $cores = (Get-WmiObject Win32_Processor).NumberOfCores
 $logicalProc = (Get-WmiObject Win32_Processor).NumberOfLogicalProcessors
 $ram = [Math]::Round((Get-WmiObject Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 2)

# Asset-Nummer generieren (falls nicht vorhanden)
 $assetNumber = $null
try {
    # Versuche, eine vorhandene Asset-Nummer aus der Registry zu lesen
    $assetNumber = Get-ItemProperty -Path "HKLM:\SOFTWARE\ETK-Asset" -Name "AssetNumber" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty "AssetNumber"
} catch {
    # Ignoriere Fehler, wenn der Registry-Eintrag nicht existiert
}


if (-not $assetNumber) {
    # Generiere eine 8-stellige Asset-Nummer, falls keine vorhanden ist
    $assetNumber = -join ((48..57 + 65..90 | Get-Random -Count 8) | ForEach-Object {[char]$_})
    
    try {
        # Speichere die Asset-Nummer in der Registry für zukünftige Verwendung
        if (-not (Test-Path "HKLM:\SOFTWARE\ETK-Asset")) {
            New-Item -Path "HKLM:\SOFTWARE\ETK-Asset" -Force | Out-Null
        }
        Set-ItemProperty -Path "HKLM:\SOFTWARE\ETK-Asset" -Name "AssetNumber" -Value $assetNumber -Force
    } catch {
        Write-Host "Fehler beim Speichern der Asset-Nummer in der Registry: $_"
    }
}

# Standort ermitteln (falls nicht vorhanden)
 $location = ""
try {
    # Versuche, einen vorhandenen Standort aus der Registry zu lesen
    $location = Get-ItemProperty -Path "HKLM:\SOFTWARE\ETK-Asset" -Name "Location" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty "Location"
    if (-not $location) { $location = "" }
} catch {
    # Ignoriere Fehler, wenn der Registry-Eintrag nicht existiert
    $location = ""
}

# Status ermitteln (Standard: "in Betrieb")
 $status = "in Betrieb"
try {
    # Versuche, einen vorhandenen Status aus der Registry zu lesen
    $status = Get-ItemProperty -Path "HKLM:\SOFTWARE\ETK-Asset" -Name "Status" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty "Status"
    if (-not $status) { $status = "in Betrieb" }
} catch {
    # Ignoriere Fehler, wenn der Registry-Eintrag nicht existiert
    $status = "in Betrieb"
}

# Bemerkungen ermitteln (falls vorhanden)
 $notes = ""
try {
    # Versuche, vorhandene Bemerkungen aus der Registry zu lesen
    $notes = Get-ItemProperty -Path "HKLM:\SOFTWARE\ETK-Asset" -Name "Notes" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty "Notes"
    if (-not $notes) { $notes = "" }
} catch {
    # Ignoriere Fehler, wenn der Registry-Eintrag nicht existiert
    $notes = ""
}

# Detaillierte GPU-Informationen
 $gpuInfo = @()
 $gpus = Get-WmiObject Win32_VideoController

foreach ($gpu in $gpus) {
    $gpuDetails = @{
        Name = $gpu.Name
        AdapterRAMGB = if ($gpu.AdapterRAM -and $gpu.AdapterRAM -gt 0) {
            [Math]::Round($gpu.AdapterRAM / 1GB, 2)
        } else {
            "N/A"
        }
        DriverVersion = $gpu.DriverVersion
        DriverDate = if ($gpu.DriverDate) {
            [System.Management.ManagementDateTimeConverter]::ToDateTime($gpu.DriverDate).ToString("yyyy-MM-dd")
        } else {
            "N/A"
        }
        VideoProcessor = $gpu.VideoProcessor
        VideoModeDescription = $gpu.VideoModeDescription
        CurrentHorizontalResolution = $gpu.CurrentHorizontalResolution
        CurrentVerticalResolution = $gpu.CurrentVerticalResolution
        CurrentRefreshRate = $gpu.CurrentRefreshRate
    }
    $gpuInfo += $gpuDetails
}

# Lokale Festplatteninformationen
 $localDrives = @()
 $logicalDisks = Get-WmiObject Win32_LogicalDisk -Filter "DriveType=3" # Nur lokale Festplatten

foreach ($disk in $logicalDisks) {
    $driveDetails = @{
        DeviceID = $disk.DeviceID
        SizeGB = [Math]::Round($disk.Size / 1GB, 2)
        FreeGB = [Math]::Round($disk.FreeSpace / 1GB, 2)
        UsedGB = [Math]::Round(($disk.Size - $disk.FreeSpace) / 1GB, 2)
        UsedPercentage = if ($disk.Size -gt 0) {
            [Math]::Round(($disk.Size - $disk.FreeSpace) / $disk.Size * 100, 2)
        } else { 0 }
        VolumeName = $disk.VolumeName
        VolumeSerialNumber = $disk.VolumeSerialNumber
        FileSystem = $disk.FileSystem
        DriveType = "Lokale Festplatte"
    }

    # Zusätzliche Partition-Informationen
    $partition = Get-WmiObject Win32_DiskPartition | Where-Object {
        $_.DeviceID -like "*" + $disk.DeviceID.Replace(":", "") + "*"
    } | Select-Object -First 1

    if ($partition) {
        $driveDetails.PartitionSizeGB = [Math]::Round($partition.Size / 1GB, 2)
        $driveDetails.PartitionType = $partition.Type
    }

    $localDrives += $driveDetails
}

# Netzwerk-Laufwerke (gemappte Netzlaufwerke)
 $networkDrives = @()
 $logicalDisks = Get-WmiObject Win32_LogicalDisk -Filter "DriveType=4" # Nur Netzwerk-Laufwerke

foreach ($disk in $logicalDisks) {
    $driveDetails = @{
        DeviceID = $disk.DeviceID
        SizeGB = [Math]::Round($disk.Size / 1GB, 2)
        FreeGB = [Math]::Round($disk.FreeSpace / 1GB, 2)
        UsedGB = [Math]::Round(($disk.Size - $disk.FreeSpace) / 1GB, 2)
        UsedPercentage = if ($disk.Size -gt 0) {
            [Math]::Round(($disk.Size - $disk.FreeSpace) / $disk.Size * 100, 2)
        } else { 0 }
        VolumeName = $disk.VolumeName
        VolumeSerialNumber = $disk.VolumeSerialNumber
        FileSystem = $disk.FileSystem
        DriveType = "Netzwerk-Laufwerk"
        ProviderName = $disk.ProviderName
    }
    $networkDrives += $driveDetails
}

# Cloud-Laufwerke erkennen
 $cloudDrives = @()

# Methode 1: Über WMI nach Cloud-Laufwerken suchen
try {
 $cloudLogicalDisks = Get-WmiObject Win32_LogicalDisk | Where-Object {
 $_.VolumeName -like "*OneDrive*" -or
 $_.VolumeName -like "*Google Drive*" -or
 $_.VolumeName -like "*Dropbox*" -or
 $_.VolumeName -like "*iCloud*" -or
 $_.Description -like "*Cloud*"
}

foreach ($disk in $cloudLogicalDisks) {
 $driveDetails = @{
DeviceID = $disk.DeviceID
SizeGB = [Math]::Round($disk.Size / 1GB, 2)
FreeGB = [Math]::Round($disk.FreeSpace / 1GB, 2)
UsedGB = [Math]::Round(($disk.Size - $disk.FreeSpace) / 1GB, 2)
UsedPercentage = if ($disk.Size -gt 0) {
[Math]::Round(($disk.Size - $disk.FreeSpace) / $disk.Size * 100, 2)
} else { 0 }
VolumeName = $disk.VolumeName
VolumeSerialNumber = $disk.VolumeSerialNumber
FileSystem = $disk.FileSystem
DriveType = "Cloud-Laufwerk"
CloudProvider = if ($disk.VolumeName -like "*OneDrive*") { "Microsoft OneDrive" }
elseif ($disk.VolumeName -like "*Google Drive*") { "Google Drive" }
elseif ($disk.VolumeName -like "*Dropbox*") { "Dropbox" }
elseif ($disk.VolumeName -like "*iCloud*") { "Apple iCloud" }
else { "Unbekannter Cloud-Anbieter" }
SyncStatus = "Aktiv" # WMI gibt hier leider keinen direkten Status
LastSyncTime = if ($disk.Description) { $disk.Description } else { "N/A" }
IsEncrypted = "N/A" # WMI gibt hier leider keine direkte Information
}

 $cloudDrives += $driveDetails
}
} catch {
Write-Host "Fehler beim Erkennen von Cloud-Laufwerken über WMI: $($_.Exception.Message)" -ForegroundColor Yellow
}

# Methode 2: Über Registry-Einträge nach Cloud-Synchronisations-Tools suchen
try {
 $cloudRegPaths = @(
"HKCU:\SOFTWARE\Microsoft\OneDrive",
"HKCU:\SOFTWARE\Google\Drive",
"HKCU:\SOFTWARE\Dropbox",
"HKCU:\SOFTWARE\Apple\iCloud"
)

foreach ($regPath in $cloudRegPaths) {
if (Test-Path $regPath) {
 $cloudProvider = switch ($regPath) {
"*OneDrive*" { "Microsoft OneDrive" }
"*Google Drive*" { "Google Drive" }
"*Dropbox*" { "Dropbox" }
"*iCloud*" { "Apple iCloud" }
default { "Unbekannter Cloud-Anbieter" }
}

try {
 $regProps = Get-ItemProperty -Path $regPath -ErrorAction SilentlyContinue
if ($regProps) {
 $installPath = $regProps.InstallPath -replace "`"", ""
 $accountEmail = $regProps.UserEmail -replace "`"", ""
 $accountName = $regProps.UserFolder -replace "`"", ""

# Prüfen, ob der Ordner existiert und Informationen sammeln
if ($installPath -and (Test-Path $installPath)) {
 $cloudDriveInfo = @{
DeviceID = "Cloud:$(Split-Path $regPath -Leaf)"
SizeGB = "N/A" # Größe über Registry nicht zuverlässig ermittelbar
FreeGB = "N/A"
UsedGB = "N/A"
UsedPercentage = "N/A"
VolumeName = Split-Path $installPath -Leaf
VolumeSerialNumber = "N/A"
FileSystem = "N/A"
DriveType = "Cloud-Laufwerk"
CloudProvider = $cloudProvider
InstallPath = $installPath
AccountEmail = $accountEmail
AccountName = $accountName
SyncStatus = "Installiert"
LastSyncTime = "N/A"
IsEncrypted = "N/A"
}

# Versuche, zusätzliche Informationen über den Ordner zu sammeln
try {
 $folderSize = (Get-ChildItem -Path $installPath -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Length / 1GB
 $cloudDriveInfo.SizeGB = [Math]::Round($folderSize, 2)
} catch {
# Ordnergröße konnte nicht ermittelt werden
}

 $cloudDrives += $cloudDriveInfo
}
}
} catch {
# Fehler beim Lesen der Registry-Einträge ignorieren
}
}
}
} catch {
Write-Host "Fehler beim Erkennen von Cloud-Laufwerken über Registry: $($_.Exception.Message)" -ForegroundColor Yellow
}

# Methode 3: Über Prozesse nach Cloud-Synchronisations-Tools suchen
try {
 $cloudProcesses = @("OneDrive.exe", "GoogleDriveSync.exe", "Dropbox.exe", "iCloudPhotos.exe", "iCloudDrive.exe")

foreach ($processName in $cloudProcesses) {
 $process = Get-Process $processName -ErrorAction SilentlyContinue
if ($process) {
 $cloudProvider = switch ($processName) {
"OneDrive.exe" { "Microsoft OneDrive" }
"GoogleDriveSync.exe" { "Google Drive" }
"Dropbox.exe" { "Dropbox" }
"iCloudPhotos.exe" { "Apple iCloud Photos" }
"iCloudDrive.exe" { "Apple iCloud Drive" }
default { "Unbekannter Cloud-Anbieter" }
}

 $cloudDriveInfo = @{
DeviceID = "Cloud:Process:$($process.Id)"
SizeGB = "N/A"
FreeGB = "N/A"
UsedGB = "N/A"
UsedPercentage = "N/A"
VolumeName = $cloudProvider
VolumeSerialNumber = "N/A"
FileSystem = "N/A"
DriveType = "Cloud-Laufwerk"
CloudProvider = $cloudProvider
ProcessId = $process.Id
ProcessPath = $process.Path
StartTime = $process.StartTime.ToString("yyyy-MM-dd HH:mm:ss")
SyncStatus = "Aktiv"
LastSyncTime = "N/A"
IsEncrypted = "N/A"
}

 $cloudDrives += $cloudDriveInfo
}
}
} catch {
Write-Host "Fehler beim Erkennen von Cloud-Laufwerken über Prozesse: $($_.Exception.Message)" -ForegroundColor Yellow
}

# Weitere Laufwerkstypen (CD-ROM, Netzlaufwerke, etc.)
 $otherDrives = Get-WmiObject Win32_LogicalDisk -Filter "DriveType!=3 AND DriveType!=4" | ForEach-Object {
 $driveType = switch ($_.DriveType) {
0 { "Unbekannt" }
1 { "Kein Root-Verzeichnis" }
2 { "Wechseldatenträger" }
3 { "Lokale Festplatte" } # Wird bereits oben erfasst
4 { "Netzwerk-Laufwerk" } # Wird bereits oben erfasst
5 { "CD-ROM" }
6 { "RAM-Disk" }
default { "Unbekannt" }
}

@{
DeviceID = $_.DeviceID
DriveType = $driveType
SizeGB = if ($_.Size) { [Math]::Round($_.Size / 1GB, 2) } else { "N/A" }
FreeGB = if ($_.FreeSpace) { [Math]::Round($_.FreeSpace / 1GB, 2) } else { "N/A" }
VolumeName = $_.VolumeName
VolumeSerialNumber = $_.VolumeSerialNumber
FileSystem = $_.FileSystem
}
}

# Netzwerkkarteninformationen
 $networkInfo = Get-WmiObject Win32_NetworkAdapterConfiguration | Where-Object {
    $_.IPEnabled -eq $true
} | ForEach-Object {
    @{
        Description = $_.Description
        MACAddress = $_.MACAddress
        IPAddress = if ($_.IPAddress) { $_.IPAddress[0] } else { "N/A" }
        SubnetMask = if ($_.IPSubnet) { $_.IPSubnet[0] } else { "N/A" }
        DefaultGateway = if ($_.DefaultIPGateway) { $_.DefaultIPGateway[0] } else { "N/A" }
        DNSServers = if ($_.DNSServerSearchOrder) { $_.DNSServerSearchOrder -join ", " } else { "N/A" }
        DHCPEnabled = $_.DHCPEnabled
        Speed = if ($_.Speed) { $_.Speed } else { 0 }
        SpeedMbps = if ($_.Speed) { [Math]::Round($_.Speed / 1MB, 2) } else { 0 }
    }
}

# JSON-Objekt erstellen
 $data = @{
    assetNumber = $assetNumber
    hostname = $hostname
    user = $user
    os = $os
    osVersion = $osVersion
    osArch = $osArch
    manufacturer = $manufacturer
    model = $model
    serialNumber = $serial
    biosVersion = $biosVersion
    cpu = $cpu
    cores = $cores
    logicalProc = $logicalProc
    ramGB = $ram
    gpu = $gpuInfo # Detaillierte GPU-Informationen
    drives = @{
        localDrives = $localDrives
        networkDrives = $networkDrives
    }
    network = $networkInfo
    status = $status
    location = $location
    notes = $notes
    timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
} | ConvertTo-Json -Depth 6

# An Server senden
try {
    $response = Invoke-RestMethod -Uri "${ip}/api/devices" -Method Post -Body $data -ContentType "application/json"
    Write-Host "Daten erfolgreich gesendet: $($response.message)" -ForegroundColor Green
    Write-Host "Hostname: $hostname" -ForegroundColor Yellow
    Write-Host "Asset-Nummer: $assetNumber" -ForegroundColor Cyan

    # Zusätzliche Informationen anzeigen
    Write-Host "`nGefundene GPUs:" -ForegroundColor Magenta
    $gpuInfo | ForEach-Object {
        Write-Host " - $($_.Name) ($($_.VideoProcessor))" -ForegroundColor Gray
    }

    Write-Host "`nGefundene Laufwerke:" -ForegroundColor Magenta
    $localDrives | ForEach-Object {
        Write-Host " - $($_.DeviceID): $($_.SizeGB) GB ($($_.UsedPercentage)% verwendet)" -ForegroundColor Gray
    }

    $networkDrives | ForEach-Object {
        Write-Host " - Netzwerklaufwerk $($_.DeviceID): $($_.SizeGB) GB ($($_.UsedPercentage)% verwendet)" -ForegroundColor Cyan
    }
} catch {
    Write-Host "Fehler beim Senden: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Stellen Sie sicher, dass der Node.js-Server erreichbar ist" -ForegroundColor Red
}