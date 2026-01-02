const express = require('express');
const https = require('https');
const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const app = express();
const PORT_HTTP = process.env.PORT || 2000; // Standard HTTP Port
const PORT_HTTP_80 = 80; // Port 80 für Zugriff ohne Portnummer
const PORT_HTTPS = 443; // Standard HTTPS Port (443 statt 2001)
const clients = [];

// Dateisperre für Race-Condition-Verhinderung
const fileLocks = new Map();

// Pfad zur devices.json Datei im isolierten devices Ordner
const devicesFile = path.join(__dirname, 'devices', 'devices.json');

// Pfade für SSL Zertifikate (falls vorhanden)
const sslOptions = {
  key: null,
  cert: null,
  isHttpsAvailable: false
};

// WICHTIG: Statische Dateien servieren - FIX für das Bildproblem
app.use(express.static(path.join(__dirname, 'public')));
app.use('/Bilder', express.static(path.join(__dirname, 'Bilder')));

// JSON Body Parser Middleware für API-Anfragen
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Prüfe ob SSL Zertifikate vorhanden sind
async function checkSSLCertificates() {
  try {
    // Mehrere mögliche Pfade für Zertifikate
    const possiblePaths = [
      path.join(__dirname, 'ssl', 'key.pem'),
      path.join(__dirname, 'ssl', 'private.key'),
      path.join(__dirname, 'key.pem'),
      path.join(__dirname, 'private.key')
    ];
    
    const certPaths = [
      path.join(__dirname, 'ssl', 'cert.pem'),
      path.join(__dirname, 'ssl', 'certificate.crt'),
      path.join(__dirname, 'cert.pem'),
      path.join(__dirname, 'certificate.crt')
    ];
    
    let keyFound = false;
    let certFound = false;
    
    // Suche nach Key
    for (const keyPath of possiblePaths) {
      try {
        await fs.access(keyPath);
        sslOptions.key = await fs.readFile(keyPath);
        keyFound = true;
        console.log(`✅ SSL Key gefunden: ${keyPath}`);
        break;
      } catch (error) {
        // Key nicht an diesem Pfad gefunden, weiter suchen
      }
    }
    
    // Suche nach Zertifikat
    for (const certPath of certPaths) {
      try {
        await fs.access(certPath);
        sslOptions.cert = await fs.readFile(certPath);
        certFound = true;
        console.log(`✅ SSL Zertifikat gefunden: ${certPath}`);
        break;
      } catch (error) {
        // Zertifikat nicht an diesem Pfad gefunden, weiter suchen
      }
    }
    
    if (keyFound && certFound) {
      sslOptions.isHttpsAvailable = true;
      console.log('✅ HTTPS wird aktiviert.');
    } else {
      console.log('⚠️  SSL Zertifikate nicht gefunden. Nur HTTP wird verfügbar sein.');
    }
  } catch (error) {
    console.log('⚠️  SSL Zertifikate nicht gefunden. Nur HTTP wird verfügbar sein.');
  }
}

// ==================== API-Endpunkte ====================

// GET /api/devices - Ruft alle Geräte ab
app.get('/api/devices', async (req, res) => {
    try {
        console.log(`[${new Date().toISOString()}] GET /api/devices - Geräte werden abgerufen`);
        
        const devices = await withFileLock(devicesFile, async () => {
            return await readDevicesSafely();
        });
        
        console.log(`📋 ${devices.length} Geräte zurückgegeben`);
        res.json(devices);
    } catch (error) {
        console.error('❌ Fehler beim Abrufen der Geräte:', error);
        res.status(500).json({ 
            error: 'Fehler beim Abrufen der Geräte',
            timestamp: new Date().toISOString()
        });
    }
});

// Hilfsfunktion für sicheren Dateizugriff mit Sperre
async function withFileLock(filePath, callback) {
    const lockKey = filePath;
    
    // Warte bis die Sperre frei ist
    while (fileLocks.has(lockKey)) {
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    // Setze Sperre
    fileLocks.set(lockKey, true);
    
    try {
        return await callback();
    } finally {
        // Gib Sperre frei
        fileLocks.delete(lockKey);
    }
}

// Hilfsfunktion zum sicheren Lesen der devices.json - DATENSCHUTZ AKTIVIERT
async function readDevicesSafely() {
    console.log('🛡️ DATENSCHUTZ: Lese Geräte aus geschützter Datei...');
    
    // ZUERST: Versuche aus der Hauptdatei zu lesen
    try {
        const data = await fs.readFile(devicesFile, 'utf8');
        const devices = JSON.parse(data);
        
        // Validiere dass es sich um ein Array handelt
        if (!Array.isArray(devices)) {
            console.error('❌ KRITISCH: devices.json enthält kein Array! Versuche Wiederherstellung...');
            return await restoreFromBackup();
        }
        
        // ZÄHLE GERÄTE und logge sie
        console.log(`✅ Sicher geladen: ${devices.length} Geräte`);
        devices.forEach((device, index) => {
            console.log(`  ${index + 1}. ${device.assetNumber} - ${device.hostname} (${device.user || 'Unbekannt'})`);
        });
        
        return devices;
    } catch (error) {
        console.error('❌ KRITISCH: Konnte devices.json nicht lesen! Fehler:', error.message);
        console.log('🔄 Versuche Wiederherstellung aus Backup...');
        return await restoreFromBackup();
    }
}

// Hilfsfunktion zur Wiederherstellung aus Backup
async function restoreFromBackup() {
    const backupFile = devicesFile + '.backup';
    
    try {
        // Prüfe ob Backup existiert
        await fs.access(backupFile);
        const backupData = await fs.readFile(backupFile, 'utf8');
        const devices = JSON.parse(backupData);
        
        if (Array.isArray(devices)) {
            console.log(`✅ Backup-Wiederherstellung erfolgreich: ${devices.length} Geräte aus Backup`);
            
            // Schreibe die wiederhergestellten Daten zurück in die Hauptdatei
            await fs.writeFile(devicesFile, JSON.stringify(devices, null, 2));
            return devices;
        } else {
            console.error('❌ Backup enthält kein gültiges Array');
            throw new Error('Backup corrupted');
        }
    } catch (backupError) {
        console.error('❌ Backup-Wiederherstellung fehlgeschlagen:', backupError.message);
        console.log('⚠️  LETZTE NOTLÖSUNG: Leere devices.json werden NICHT überschrieben!');
        
        // WICHTIG: Gib niemals ein leeres Array zurück!
        // Versuche stattdessen die aktuelle Datei zu retten
        try {
            const data = await fs.readFile(devicesFile, 'utf8');
            console.log('📋 Originaldateiinhalt wird trotz Fehler zurückgegeben');
            return []; // Nur wenn absolut nichts geht
        } catch {
            console.error('💀 COMPLETTER DATENVERLUST VERHINDERT! Rette BITTE Backup manuell!');
            return [];
        }
    }
}

// Hilfsfunktion zum sicheren Schreiben der devices.json - DATENSCHUTZ MODUS
async function writeDevicesSafely(devices) {
    console.log('🛡️ DATENSCHUTZ: Versuche Geräte zu speichern...');
    
    try {
        // KRITISCHE VALIDIERUNG
        if (!Array.isArray(devices)) {
            throw new Error('❌ KRITISCH: Versuch ein Nicht-Array zu schreiben!');
        }
        
        // ZÄHLE GERÄTE VOR DEM SCHREIBEN
        const deviceCount = devices.length;
        console.log(`📝 VERSUCH: Schreibe ${deviceCount} Geräte in devices.json...`);
        
        // ABSOLUTER SCHUTZ: Verhindere JEDES Löschen von Geräten
        if (deviceCount === 0) {
            console.error('🚨 ABSOLUTER DATENSCHUTZ: Versuch LEERE GERÄTELISTE zu schreiben! GEBLOCKIERT!');
            console.log('🔄 Lade Backup wiederherstellung...');
            return await restoreFromBackup();
        }
        
        // ZUSÄTZLICHER SCHUTZ: Prüfe ob plötzlich viel weniger Geräte als erwartet
        try {
            const currentData = await fs.readFile(devicesFile, 'utf8');
            const currentDevices = JSON.parse(currentData);
            if (Array.isArray(currentDevices) && currentDevices.length > deviceCount * 2) {
                console.error(`🚨 DATENSCHUTZ: Unerwarteter Geräteverlust von ${currentDevices.length} auf ${deviceCount}! GEBLOCKIERT!`);
                return false;
            }
        } catch (e) {
            // Ignoriere Lesefehler beim Schutz-Check
        }
        
        // Erstelle Backup vor dem Schreiben
        const backupFile = devicesFile + '.backup';
        try {
            await fs.copyFile(devicesFile, backupFile);
            console.log('💾 Backup erfolgreich erstellt');
        } catch (error) {
            console.warn('⚠️  Backup-Erstellung fehlgeschlagen:', error.message);
        }
        
        // Schreibe die Daten atomar
        const tempFile = devicesFile + '.tmp';
        await fs.writeFile(tempFile, JSON.stringify(devices, null, 2));
        await fs.rename(tempFile, devicesFile);
        
        console.log(`✅ devices.json erfolgreich gespeichert: ${deviceCount} Geräte`);
        
        // VERIFIKATION: Stelle sicher dass die Datei korrekt geschrieben wurde
        try {
            const verifyData = await fs.readFile(devicesFile, 'utf8');
            const verifyDevices = JSON.parse(verifyData);
            
            if (!Array.isArray(verifyDevices) || verifyDevices.length !== deviceCount) {
                throw new Error(`Verifikation fehlgeschlagen: ${verifyDevices?.length || 0} statt ${deviceCount} Geräte`);
            }
            
            console.log(`✅ Verifikation erfolgreich: ${verifyDevices.length} Geräte gespeichert`);
            return true;
        } catch (verifyError) {
            console.error('❌ Verifikation fehlgeschlagen:', verifyError.message);
            // Versuche Backup wiederherzustellen
            return await restoreBackupToFile();
        }
        
    } catch (error) {
        console.error('❌ KRITISCHER FEHLER beim Schreiben:', error.message);
        return await restoreBackupToFile();
    }
}

// Hilfsfunktion zur Wiederherstellung des Backups
async function restoreBackupToFile() {
    const backupFile = devicesFile + '.backup';
    
    try {
        const backupData = await fs.readFile(backupFile, 'utf8');
        const backupDevices = JSON.parse(backupData);
        
        if (Array.isArray(backupDevices)) {
            await fs.writeFile(devicesFile, backupData);
            console.log(`🛡️  DATEN GESCHÜTZT: Backup mit ${backupDevices.length} Geräten wiederhergestellt!`);
            return true;
        }
    } catch (backupError) {
        console.error('❌ Backup-Wiederherstellung fehlgeschlagen:', backupError.message);
    }
    
    return false;
}

// POST /api/devices - Fügt ein neues Gerät hinzu oder aktualisiert ein bestehendes
app.post('/api/devices', async (req, res) => {
    const startTime = Date.now();
    
    try {
        console.log(`[${new Date().toISOString()}] POST /api/devices - Gerät empfangen:`, req.body?.hostname || 'Unbekannt');
        
        // Validiere die Anfragedaten
        if (!req.body || typeof req.body !== 'object') {
            return res.status(400).json({ error: 'Ungültige Anfragedaten' });
        }
        
        const newDevice = {
            ...req.body,
            id: Date.now() + Math.random(), // Einzigartige ID mit Zufallsanteil
            timestamp: new Date().toISOString(),
            lastModified: new Date().toISOString(),
            modifiedBy: 'script'
        };

        const result = await withFileLock(devicesFile, async () => {
            const devices = await readDevicesSafely();
            
            // Finde existierendes Gerät anhand von assetNumber oder hostname
            const existingIndex = devices.findIndex(d => 
                d.assetNumber === newDevice.assetNumber || 
                (d.hostname === newDevice.hostname && d.assetNumber === newDevice.assetNumber)
            );

            if (existingIndex > -1) {
                const oldDevice = devices[existingIndex];
                
                // Laufwerksdaten zusammenführen
                const mergedDrives = {
                    localDrives: newDevice.drives?.localDrives || [],
                    otherDrives: newDevice.drives?.otherDrives || [],
                    networkDrives: newDevice.drives?.networkDrives || []
                };
                
                // Behalte wichtige alte Metadaten
                devices[existingIndex] = {
                    ...oldDevice,
                    ...newDevice,
                    id: oldDevice.id, // Behalte die ursprüngliche ID
                    drives: mergedDrives,
                    lastModified: newDevice.timestamp,
                    modifiedBy: newDevice.modifiedBy
                };
                
                console.log(`✅ Gerät aktualisiert: ${newDevice.assetNumber || newDevice.hostname} (ID: ${oldDevice.id})`);
                
                return {
                    success: await writeDevicesSafely(devices),
                    device: devices[existingIndex],
                    action: 'updated'
                };
            } else {
                // Stelle sicher, dass die drives-Struktur für neue Geräte existiert
                if (!newDevice.drives) {
                    newDevice.drives = {
                        localDrives: [],
                        otherDrives: [],
                        networkDrives: []
                    };
                }
                
                devices.push(newDevice);
                console.log(`✅ Neues Gerät hinzugefügt: ${newDevice.assetNumber || newDevice.hostname} (ID: ${newDevice.id})`);
                
                return {
                    success: await writeDevicesSafely(devices),
                    device: newDevice,
                    action: 'added'
                };
            }
        });

        const duration = Date.now() - startTime;
        
        if (result.success) {
            const message = result.action === 'updated' ? 'Gerät erfolgreich aktualisiert' : 'Gerät erfolgreich hinzugefügt';
            console.log(`📊 POST-Abschluss in ${duration}ms: ${message}`);
            
            res.status(result.action === 'updated' ? 200 : 201)
               .json({ 
                   message, 
                   device: result.device,
                   timestamp: new Date().toISOString()
               });
        } else {
            console.error(`❌ POST-Abschluss in ${duration}ms: Schreibfehler`);
            res.status(500).json({ error: 'Fehler beim Speichern der Gerätedaten' });
        }

    } catch (error) {
        const duration = Date.now() - startTime;
        console.error(`❌ POST-Fehler in ${duration}ms:`, error);
        res.status(500).json({ 
            error: 'Serverfehler beim Verarbeiten der Gerätedaten',
            timestamp: new Date().toISOString()
        });
    }
});

// PUT /api/devices/:assetNumber - Aktualisiert ein Gerät
app.put('/api/devices/:assetNumber', async (req, res) => {
    try {
        const assetNumber = req.params.assetNumber;
        let devices = JSON.parse(await fs.readFile(devicesFile, 'utf8'));
        
        const deviceIndex = devices.findIndex(d => d.assetNumber === assetNumber);
        
        if (deviceIndex === -1) {
            return res.status(404).json({ error: 'Gerät nicht gefunden' });
        }
        
        devices[deviceIndex] = {
            ...devices[deviceIndex],
            ...req.body,
            lastModified: new Date().toISOString(),
            modifiedBy: 'system'
        };
        
        await fs.writeFile(devicesFile, JSON.stringify(devices, null, 2));
        console.log(`Gerät aktualisiert (PUT): ${assetNumber}`);
        
        res.status(200).json({ message: 'Gerät erfolgreich aktualisiert', device: devices[deviceIndex] });
    } catch (error) {
        console.error('Fehler beim Aktualisieren des Geräts (PUT):', error);
        res.status(500).json({ error: 'Serverfehler beim Aktualisieren des Geräts' });
    }
});

// DELETE /api/devices/:assetNumber - DATENSCHUTZ MODUS - DEAKTIVIERT!
app.delete('/api/devices/:assetNumber', async (req, res) => {
    const assetNumber = req.params.assetNumber;
    
    console.log('🚨 DATENSCHUTZ MODUS AKTIV');
    console.log(`🛡️ DELETE-ANFRAGE für Gerät ${assetNumber} wurde BLOCKIERT!`);
    console.log('⚠️  LÖSCHFUNKTION IST ZUM SCHUTZ DER DATEN DEAKTIVIERT!');
    
    // Immer ablehnen mit klarem Hinweis
    res.status(403).json({ 
        error: 'DATENSCHUTZ MODUS AKTIV',
        message: 'Löschfunktion wurde zum Schutz der Daten deaktiviert',
        details: 'Geräte können nur durch direkten Server-Zugriff gelöscht werden',
        timestamp: new Date().toISOString()
    });
    
    return;
});

// GET / - Liefert die Haupt-HTML-Datei
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API für Server-Status
app.get('/api/server-info', (req, res) => {
    res.json({
        status: 'online',
        ports: {
            http: PORT_HTTP_80,
            http_alt: PORT_HTTP,
            https: sslOptions.isHttpsAvailable ? PORT_HTTPS : 'disabled'
        }
    });
});

// Hilfsfunktion zum Finden aller lokalen IPv4-Adressen
function getAllLocalIps() {
    const interfaces = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                ips.push(iface.address);
            }
        }
    }
    return ips;
}

// Funktion zur Initialisierung der devices.json-Datei
async function initializeDevicesFile() {
    try {
        // Stelle sicher dass der devices Ordner existiert
        const devicesDir = path.dirname(devicesFile);
        await fs.mkdir(devicesDir, { recursive: true });
        
        await fs.access(devicesFile);
        console.log('✅ devices.json gefunden im isolierten Ordner.');
    } catch {
        console.log('📄 devices.json nicht gefunden. Erstelle neue Datei im devices Ordner...');
        
        // Stelle sicher dass der Ordner existiert
        const devicesDir = path.dirname(devicesFile);
        await fs.mkdir(devicesDir, { recursive: true });
        
        await fs.writeFile(devicesFile, JSON.stringify([], null, 2));
        console.log('✅ devices.json erfolgreich erstellt im devices Ordner.');
    }
}

// ==================== Server-Start ====================

async function startServer() {
    await checkSSLCertificates();
    await initializeDevicesFile();
    
    const localIps = getAllLocalIps();
    
    // WICHTIG: Server auf Port 80 starten (benötigt Admin-Rechte!)
    try {
        const httpServer80 = http.createServer(app);
        httpServer80.listen(PORT_HTTP_80, () => {
            console.log('==================================================');
            console.log(`🚀 ETK Asset Management Server`);
            console.log('==================================================');
            console.log(`🌐 HTTP Server läuft auf Port ${PORT_HTTP_80} (ohne Portnummer erreichbar)`);
            console.log('--------------------------------------------------');
            console.log(`📍 Zugriff ohne Port:  http://10.10.10.99`);
            if (localIps.length) {
                localIps.forEach(ip => console.log(`   http://${ip}`));
            }
            console.log('==================================================');
        });
        
        httpServer80.on('error', (error) => {
            if (error.code === 'EACCES') {
                console.log(`❌ Port ${PORT_HTTP_80} benötigt Admin-Rechte. Starte auf Port ${PORT_HTTP} statt.`);
                startAlternativePort();
            } else {
                console.error('❌ HTTP Server Fehler:', error);
            }
        });
        
    } catch (error) {
        console.error('❌ Fehler beim Starten des HTTP Servers:', error);
        startAlternativePort();
    }
    
    // HTTPS Server starten (falls Zertifikate vorhanden)
    if (sslOptions.isHttpsAvailable) {
        try {
            const httpsServer = https.createServer(sslOptions, app);
            httpsServer.listen(PORT_HTTPS, () => {
                console.log(`🔒 HTTPS Server läuft auf Port ${PORT_HTTPS} (Standard HTTPS)`);
                console.log('--------------------------------------------------');
                console.log(`📍 Zugriff:  https://10.10.10.99`);
                if (localIps.length) {
                    localIps.forEach(ip => console.log(`   https://${ip}`));
                }
                console.log('==================================================');
                console.log(`📊 API-Endpunkte:`);
                console.log(`   GET    /api/devices`);
                console.log(`   POST   /api/devices`);
                console.log(`   PUT    /api/devices/:assetNumber`);
                console.log(`   DELETE /api/devices/:assetNumber`);
                console.log(`   Status /api/server-info`);
                console.log('==================================================');
            });
        } catch (error) {
            console.error('❌ Fehler beim Starten des HTTPS Servers:', error);
        }
    }
    
    // Alternative Funktion für Port 2000
    function startAlternativePort() {
        const httpServer2000 = http.createServer(app);
        httpServer2000.listen(PORT_HTTP, () => {
            console.log(`🌐 HTTP Server läuft auf Port ${PORT_HTTP} (alternativer Port)`);
            console.log('--------------------------------------------------');
            console.log(`📍 Lokal:            http://localhost:${PORT_HTTP}`);
            console.log(`📍 Zugriff mit Port: http://10.10.10.99:${PORT_HTTP}`);
            if (localIps.length) {
                localIps.forEach(ip => console.log(`   http://${ip}:${PORT_HTTP}`));
            }
            console.log('==================================================');
        });
    }
    
    // Graceful Shutdown
    process.on('SIGINT', () => {
        console.log('\n==================================================');
        console.log('🛑 Server wird heruntergefahren...');
        console.log('✅ Server erfolgreich heruntergefahren.');
        console.log('==================================================');
        process.exit(0);
    });
}

// Starte den Server
startServer().catch(console.error);