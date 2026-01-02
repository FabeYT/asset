# Ubuntu/Linux Troubleshooting Guide

## Problem: Geräte verschwinden auf Ubuntu (aber nicht auf Windows)

Das Problem liegt meistens an **Dateiberechtigungen** oder **Dateisystem-Synchronisation** auf Linux.

## Ursachen

1. **Berechtigungsprobleme**: Der Node.js-Prozess hat keine Schreibrechte auf `public/devices.json`
2. **Race Conditions**: Gleichzeitige Schreibvorgänge überschreiben sich
3. **Filesystem-Buffering**: Linux puffert Schreibvorgänge, was zu Datenverlust führen kann

## Lösungen

### 1. Schnelle Lösung (empfohlen)

Das Skript wurde bereits mit Verbesserungen ausgestattet:
- Atomare Datei-Operationen (write + rename statt direktem overwrite)
- Automatische Backup-Erstellung
- Berechtigungsprüfung beim Start

**Starte den Server einfach neu:**
```bash
node server.js
```

Der Server wird jetzt beim Start automatisch:
- Die Berechtigungen prüfen
- Beschädigte Dateien wiederherstellen
- Backups erstellen

### 2. Manuelle Reparatur

Führe das Diagnose-Skript aus:
```bash
chmod +x diagnose.sh
./diagnose.sh
```

### 3. Berechtigungen manuell korrigieren

```bash
# Berechtigungen reparieren
chmod 755 public
chmod 666 public/devices.json
chmod 755 backups

# Besitz überprüfen
ls -l public/devices.json
```

### 4. Server als Benutzer mit Berechtigungen starten

```bash
# Nicht als root starten!
node server.js

# Wenn du sudo verwenden musst, setze die richtigen Berechtigungen danach:
sudo chown -R $USER:$USER public/
chmod -R 755 public/
chmod 666 public/devices.json
```

## Diagnose-Tools

### API-Diagnose

Öffne im Browser:
```
http://dein-server-ip:2000/api/diagnose
```

Dies zeigt dir:
- Datei-Berechtigungen
- JSON-Validität
- Backup-Status
- Device-Count

### API-Reparatur

```bash
# Reparatur-Endpunkt (nur Linux/Ubuntu)
curl -X POST http://localhost:2000/api/repair
```

## Detailliertes Logging

Starte den Server mit Debug-Logging:
```bash
DEBUG=true node server.js
```

Du wirst sehen:
```
📁 Working Directory: /path/to/Asset
📁 Server Directory: /path/to/Asset
📁 Devices File: /absolute/path/to/public/devices.json
🖥️  Platform: linux
👤 User: uid=1000 gid=1000
🔧 Linux/Ubuntu erkannt - prüfe Berechtigungen...
✅ public/ Verzeichnis: 755
✅ devices.json: 666
✅ Berechtigungen erfolgreich repariert
```

## Was wurde im Code geändert?

### 1. Absolute Pfade
```javascript
// Vorher (relativ)
const devicesFile = path.join(__dirname, 'public', 'devices.json');

// Jetzt (absolut)
const devicesFile = path.resolve(__dirname, 'public', 'devices.json');
```

### 2. Atomare Datei-Operationen
```javascript
// Neue safeWriteFile Funktion:
// 1. Schreibe in temporäre Datei (.tmp)
// 2. fsync (auf Festplatte schreiben)
// 3. rename (atomar, überschreibt Ziel)
// 4. fsync Verzeichnis
```

### 3. Berechtigungsprüfung
```javascript
// Prüft automatisch beim Start auf Linux:
// - Schreibrechte auf devices.json
// - Gültigkeit der JSON-Datei
// - Wiederherstellung aus Backups
```

### 4. Automatische Backups
```javascript
// Vor jedem Schreibvorgang wird ein Backup erstellt:
// backups/devices-backup-2025-01-02T10-30-45-123Z.json
// (bis zu 10 Backups werden aufbewahrt)
```

## Häufige Fehlermeldungen

### "EACCES: permission denied"
```bash
# Lösung:
chmod 666 public/devices.json
```

### "ENOENT: no such file or directory"
```bash
# Lösung:
touch public/devices.json
chmod 666 public/devices.json
```

### "Unexpected end of JSON input"
```bash
# Lösung: Backup wiederherstellen
./diagnose.sh
```

## Permanente Lösung

Füge dies zu deiner `~/.bashrc` oder `~/.profile` hinzu:
```bash
# Asset Management Server Aliases
alias asset-start='cd /path/to/Asset && node server.js'
alias asset-diagnose='cd /path/to/Asset && ./diagnose.sh'
alias asset-repair='curl -X POST http://localhost:2000/api/repair'
```

## Systemd-Service (Optional)

Erstelle `/etc/systemd/system/asset-management.service`:
```ini
[Unit]
Description=Asset Management Server
After=network.target

[Service]
Type=simple
User=dein-username
WorkingDirectory=/path/to/Asset
ExecStart=/usr/bin/node /path/to/Asset/server.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Aktiviere den Service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable asset-management
sudo systemctl start asset-management
```

## Support

Wenn das Problem weiterhin besteht, sammle folgende Informationen:

1. Server-Log beim Start
2. Ausgabe von `./diagnose.sh`
3. Ausgabe von `curl http://localhost:2000/api/diagnose`
4. Datei-Berechtigungen: `ls -la public/`

Sende diese Informationen zur weiteren Analyse.
