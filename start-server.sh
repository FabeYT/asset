#!/bin/bash

# Asset Management Server - Start-Skript für Ubuntu/Linux

echo "=================================================="
echo "Asset Management Server - Start-Skript"
echo "=================================================="
echo ""

# Farben für Ausgaben
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Prüfe ob Node.js installiert ist
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js ist nicht installiert!${NC}"
    echo "Installiere Node.js mit:"
    echo "  curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -"
    echo "  sudo apt-get install -y nodejs"
    exit 1
fi

echo -e "${GREEN}✅ Node.js gefunden: $(node --version)${NC}"
echo -e "${GREEN}✅ npm gefunden: $(npm --version)${NC}"
echo ""

# Prüfe ob dependencies installiert sind
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}📦 Dependencies nicht gefunden, installiere...${NC}"
    npm install
fi

echo ""

# Prüfe Dateistruktur
echo -e "${YELLOW}🔍 Prüfe Dateistruktur...${NC}"

if [ ! -d "public" ]; then
    echo -e "${RED}❌ public/ Verzeichnis fehlt!${NC}"
    exit 1
fi

if [ ! -f "public/devices.json" ]; then
    echo -e "${YELLOW}📄 devices.json nicht gefunden, erstelle...${NC}"
    echo '[]' > public/devices.json
    chmod 666 public/devices.json
fi

if [ ! -d "backups" ]; then
    echo -e "${YELLOW}📁 backups/ Verzeichnis nicht gefunden, erstelle...${NC}"
    mkdir -p backups
    chmod 755 backups
fi

echo -e "${GREEN}✅ Dateistruktur OK${NC}"
echo ""

# Berechtigungen prüfen und korrigieren
echo -e "${YELLOW}🔧 Prüfe und korrigiere Berechtigungen...${NC}"
chmod 755 public
chmod 666 public/devices.json 2>/dev/null
chmod 755 backups 2>/dev/null
echo -e "${GREEN}✅ Berechtigungen korrigiert${NC}"
echo ""

# Diagnose-Endpunkt testen (wenn Server läuft)
echo -e "${YELLOW}🔍 Prüfe ob Server bereits läuft...${NC}"
if curl -s http://localhost:2000/api/diagnose > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Server läuft bereits auf Port 2000${NC}"
    read -p "Soll der Server gestoppt und neu gestartet werden? (j/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Jj]$ ]]; then
        pkill -f "node server.js"
        sleep 2
    else
        echo "Starte Server erneut..."
    fi
fi

echo ""
echo -e "${GREEN}==================================================${NC}"
echo -e "${GREEN}🚀 Starte Asset Management Server...${NC}"
echo -e "${GREEN}==================================================${NC}"
echo ""

# Server starten
node server.js
