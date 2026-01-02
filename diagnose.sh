#!/bin/bash

# Skript zur Diagnose und Reparatur von Dateiberechtigungen für den Asset Management Server

echo "=================================================="
echo "Asset Management - Diagnose & Reparatur"
echo "=================================================="
echo ""

echo "📋 System-Informationen:"
echo "Betriebssystem: $(uname -s)"
echo "Kernel: $(uname -r)"
echo "Benutzer: $(whoami)"
echo "Gruppen: $(groups)"
echo ""

echo "🔍 Prüfe Dateistruktur..."
if [ -f "public/devices.json" ]; then
    echo "✅ public/devices.json gefunden"
    ls -l public/devices.json
else
    echo "❌ public/devices.json nicht gefunden"
fi

if [ -d "public" ]; then
    echo "✅ public/ Verzeichnis gefunden"
    ls -ld public
else
    echo "❌ public/ Verzeichnis nicht gefunden"
fi

if [ -d "backups" ]; then
    echo "✅ backups/ Verzeichnis gefunden"
    echo "Anzahl Backups: $(ls -1 backups/*.json 2>/dev/null | wc -l)"
else
    echo "⚠️  backups/ Verzeichnis nicht gefunden"
fi

echo ""
echo "📊 Prüfe Datei-Permissions..."

# Prüfe Schreibzugriff auf devices.json
if [ -w "public/devices.json" ]; then
    echo "✅ devices.json ist beschreibbar"
else
    echo "❌ devices.json ist NICHT beschreibbar!"
    echo ""
    echo "Repariere Berechtigungen..."
    chmod 666 public/devices.json
    chmod 755 public
    chmod 755 backups 2>/dev/null
    echo "✅ Berechtigungen repariert"
fi

echo ""
echo "🔍 Prüfe JSON-Validität von devices.json..."
if node -e "JSON.parse(require('fs').readFileSync('public/devices.json', 'utf8'))" 2>/dev/null; then
    echo "✅ devices.json enthält gültiges JSON"
    echo "Geräte-Anzahl: $(node -e "console.log(JSON.parse(require('fs').readFileSync('public/devices.json', 'utf8')).length)")"
else
    echo "❌ devices.json enthält ungültiges JSON!"
    echo ""
    echo "Versuche Backup wiederherzustellen..."
    LATEST_BACKUP=$(ls -t backups/*.json 2>/dev/null | head -1)
    if [ -n "$LATEST_BACKUP" ]; then
        echo "Fundenes Backup: $LATEST_BACKUP"
        cp "$LATEST_BACKUP" public/devices.json
        echo "✅ Backup wiederhergestellt"
    else
        echo "❌ Kein Backup gefunden!"
        echo "Erstelle leere devices.json..."
        echo '[]' > public/devices.json
        echo "✅ Neue Datei erstellt"
    fi
fi

echo ""
echo "📋 Aktuelle Berechtigungen:"
ls -l public/devices.json
ls -ld public/
ls -ld backups/ 2>/dev/null || echo "backups/ existiert nicht"

echo ""
echo "=================================================="
echo "✅ Diagnose abgeschlossen"
echo "=================================================="
echo ""
echo "Wenn Probleme bestehen, starte den Server mit:"
echo "  node server.js"
echo ""
echo "Oder für mehr Informationen:"
echo "  curl http://localhost:2000/api/diagnose"
echo "=================================================="
