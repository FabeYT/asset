const express = require('express');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const PORT_HTTP = process.env.PORT || 2000; // Standard HTTP Port
const PORT_HTTP_80 = 80; // Port 80 für Zugriff ohne Portnummer
const PORT_HTTPS = 443; // Standard HTTPS Port (443 statt 2001)
const clients = [];
const DEBUG = process.env.DEBUG === 'true'; // Debug-Logging aktivieren mit DEBUG=true

// Pfad zur devices.json Datei im öffentlichen Verzeichnis (ABSOLUTER PFAD!)
const __filename = process.argv[1];
const __dirname = path.dirname(__filename);
const devicesFile = path.resolve(__dirname, 'public', 'devices.json');

console.log('📁 Working Directory:', process.cwd());
console.log('📁 Server Directory:', __dirname);
console.log('📁 Devices File:', devicesFile);
console.log('🖥️  Platform:', process.platform);
console.log('👤 User:', process.getuid ? `UID:${process.getuid()} GID:${process.getgid()}` : 'N/A');

// Backup-Funktion für devices.json mit File-Locking
async function backupDevicesFile() {
    try {
        const backupDir = path.join(__dirname, 'backups');
        await fs.mkdir(backupDir, { recursive: true });
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFile = path.join(backupDir, `devices-backup-${timestamp}.json`);
        
        await fs.copyFile(devicesFile, backupFile);
        console.log(`✅ Backup erstellt: ${path.basename(backupFile)}`);
        
        // Entferne alte Backups (nur die letzten 10 behalten)
        try {
            const files = await fs.readdir(backupDir);
            const backupFiles = files
                .filter(f => f.startsWith('devices-backup-') && f.endsWith('.json'))
                .map(f => ({ name: f, path: path.join(backupDir, f) }));
            
            if (backupFiles.length > 10) {
                backupFiles.sort((a, b) => a.name.localeCompare(b.name));
                const filesToDelete = backupFiles.slice(0, backupFiles.length - 10);
                
                for (const file of filesToDelete) {
                    await fs.unlink(file.path);
                    console.log(`🗑️  Altes Backup entfernt: ${file.name}`);
                }
            }
        } catch (error) {
            console.warn('⚠️  Konnte alte Backups nicht aufräumen:', error.message);
        }
    } catch (error) {
        console.error('❌ Fehler beim Erstellen des Backups:', error);
    }
}

// Sicheres Schreiben mit File-Locking für Linux/Ubuntu
async function safeWriteFile(filepath, data) {
    return new Promise((resolve, reject) => {
        const tempFile = `${filepath}.tmp`;
        
        // 1. Schreibe in temporäre Datei
        fs.writeFile(tempFile, data, { mode: 0o644 }, (writeErr) => {
            if (writeErr) {
                console.error('❌ Fehler beim Schreiben in temporäre Datei:', writeErr);
                return reject(writeErr);
            }
            
            // 2. Synchronisiere auf die Festplatte (wichtig für Linux!)
            fs.open(tempFile, 'r', (openErr, fd) => {
                if (openErr) {
                    return reject(openErr);
                }
                
                fs.fsync(fd, (syncErr) => {
                    fs.close(fd, (closeErr) => {
                        // Ignoriere fsync/close errors, der rename ist wichtiger
                    });
                    
                    if (syncErr) {
                        console.warn('⚠️  fsync Fehler:', syncErr.message);
                    }
                    
                    // 3. Rename (atomisch auf den meisten Dateisystemen)
                    fs.rename(tempFile, filepath, (renameErr) => {
                        if (renameErr) {
                            console.error('❌ Fehler beim Umbenennen der Datei:', renameErr);
                            return reject(renameErr);
                        }
                        
                        // 4. Optional: Nochmal fsync für das Verzeichnis
                        try {
                            const dirFd = fs.openSync(path.dirname(filepath), 'r');
                            fs.fsyncSync(dirFd);
                            fs.closeSync(dirFd);
                        } catch (dirSyncErr) {
                            // Verzeichnis-Sync ist optional
                        }
                        
                        console.log(`✅ Datei sicher geschrieben: ${filepath}`);
                        resolve();
                    });
                });
            });
        });
    });
}

// Prüfe Datei-Berechtigungen auf Linux
function checkFilePermissions() {
    try {
        if (process.platform !== 'win32') {
            const stats = fs.statSync(devicesFile);
            const mode = stats.mode;
            
            console.log(`📋 Dateiberechtigungen: ${mode.toString(8)}`);
            console.log(`👤 Owner UID: ${stats.uid}`);
            console.log(`👥 Group GID: ${stats.gid}`);
            
            // Prüfe ob die Datei beschreibbar ist
            fs.accessSync(devicesFile, fs.constants.W_OK);
            console.log('✅ Datei ist beschreibbar');
        }
    } catch (error) {
        console.error('❌ Berechtigungsproblem:', error.message);
        if (error.code === 'EACCES') {
            console.error('❌ Keine Schreibberechtigung! Führe den Server mit Schreibrechten aus.');
            console.error('💡 Lösung: chmod 666 public/devices.json');
        }
    }
}

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
        const data = await fs.promises.readFile(devicesFile, 'utf8');
        const devices = JSON.parse(data);
        console.log(`📊 GET /api/devices - ${devices.length} Geräte geladen`);
        res.json(devices);
    } catch (error) {
        console.error('❌ Fehler beim Lesen von devices.json:', error);
        
        if (error.code === 'ENOENT') {
            console.log('📄 devices.json existiert nicht, gibt leere Liste zurück');
            res.json([]);
        } else if (error.code === 'EACCES') {
            console.error('❌ Keine Leserechte auf devices.json!');
            res.status(500).json({ error: 'Keine Berechtigung zum Lesen der Geräte-Daten' });
        } else {
            res.json([]);
        }
    }
});

// POST /api/devices - Fügt ein neues Gerät hinzu oder aktualisiert ein bestehendes
app.post('/api/devices', async (req, res) => {
    try {
        console.log('Empfangene Gerätedaten:', req.body);

        // Validierung: Pflichtfelder prüfen
        const requiredFields = ['assetNumber', 'manufacturer', 'model', 'user'];
        const missingFields = requiredFields.filter(field => !req.body[field]);
        
        if (missingFields.length > 0) {
            console.error('Fehlende Pflichtfelder:', missingFields);
            return res.status(400).json({ 
                error: 'Fehlende Pflichtfelder', 
                missingFields 
            });
        }

        // Prüfe ob assetNumber vorhanden ist
        if (!req.body.assetNumber || req.body.assetNumber.trim() === '') {
            console.error('❌ Asset-Nummer ist leer oder nicht vorhanden');
            console.error('Empfangene Daten:', JSON.stringify(req.body, null, 2));
            return res.status(400).json({ error: 'Asset-Nummer darf nicht leer sein' });
        }

        // Prüfe ob assetNumber gültig ist (nicht nur aus Sonderzeichen)
        const assetNumberClean = req.body.assetNumber.trim();
        if (assetNumberClean.length < 3) {
            console.error('❌ Asset-Nummer zu kurz:', assetNumberClean);
            return res.status(400).json({ error: 'Asset-Nummer muss mindestens 3 Zeichen lang sein' });
        }

        const newDevice = {
            ...req.body,
            id: Date.now(),
            timestamp: new Date().toISOString(),
            lastModified: new Date().toISOString(),
            modifiedBy: 'system'
        };

        // Stelle sicher, dass die drives-Struktur existiert
        if (!newDevice.drives) {
            newDevice.drives = {
                localDrives: [],
                otherDrives: [],
                networkDrives: []
            };
        }

        let devices = [];
        try {
            const data = await fs.promises.readFile(devicesFile, 'utf8');
            devices = JSON.parse(data);
            console.log(`📖 ${devices.length} existierende Geräte geladen`);
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log('📄 devices.json existiert nicht, erstelle neue Liste.');
                devices = [];
            } else {
                console.error('❌ Fehler beim Lesen von devices.json:', error);
                return res.status(500).json({ error: 'Fehler beim Laden der Geräte-Daten' });
            }
        }

        const existingIndex = devices.findIndex(d => d.assetNumber === newDevice.assetNumber);

        if (existingIndex > -1) {
            // Prüfe ob es ein Update-Versuch mit anderer ID ist (Doppelter Versuch)
            if (devices[existingIndex].id !== newDevice.id) {
                console.warn(`⚠️  Asset-Nummer ${newDevice.assetNumber} existiert bereits mit ID ${devices[existingIndex].id}`);
                console.warn(`⚠️  Neuer Versuch mit ID ${newDevice.id}. Gerät wird nicht hinzugefügt!`);
                return res.status(409).json({ 
                    error: 'Asset-Nummer existiert bereits', 
                    message: 'Ein Gerät mit dieser Asset-Nummer existiert bereits. Bitte eine andere Nummer verwenden.',
                    existingDevice: {
                        assetNumber: devices[existingIndex].assetNumber,
                        hostname: devices[existingIndex].hostname,
                        manufacturer: devices[existingIndex].manufacturer
                    }
                });
            }

            const oldDevice = devices[existingIndex];
            
            // WICHTIG: Laufwerksdaten zusammenführen
            const mergedDrives = {
                localDrives: newDevice.drives?.localDrives || [],
                otherDrives: newDevice.drives?.otherDrives || [],
                networkDrives: newDevice.drives?.networkDrives || []
            };
            
            devices[existingIndex] = {
                ...oldDevice,
                ...newDevice,
                id: oldDevice.id,
                drives: mergedDrives,
                lastModified: new Date().toISOString(),
                modifiedBy: 'system'
            };
            
            console.log(`Gerät aktualisiert: ${newDevice.assetNumber || newDevice.hostname}`);
            console.log(`Netzlaufwerke gespeichert: ${mergedDrives.networkDrives.length}`);
            
            // Backup vor dem Speichern erstellen
            await backupDevicesFile();
            
            // Speichern mit atomarem Write für Linux
            await safeWriteFile(devicesFile, JSON.stringify(devices, null, 2));
            console.log('✅ devices.json erfolgreich aktualisiert.');
            
            res.status(200).json({ message: 'Gerät erfolgreich aktualisiert', device: devices[existingIndex] });
        } else {
            // Prüfe auf Duplikate nach Seriennummer (optional, aber hilfreich)
            if (newDevice.serialNumber) {
                const serialDuplicate = devices.findIndex(d => 
                    d.serialNumber && d.serialNumber === newDevice.serialNumber
                );
                if (serialDuplicate > -1) {
                    console.warn(`⚠️  Seriennummer ${newDevice.serialNumber} existiert bereits bei Asset ${devices[serialDuplicate].assetNumber}`);
                }
            }

            devices.push(newDevice);
            console.log(`✅ Neues Gerät hinzugefügt: ${newDevice.assetNumber || newDevice.hostname}`);
            console.log(`   Manufacturer: ${newDevice.manufacturer}`);
            console.log(`   Model: ${newDevice.model}`);
            console.log(`   User: ${newDevice.user}`);
            console.log(`   ID: ${newDevice.id}`);
            
            // Backup vor dem Speichern erstellen
            await backupDevicesFile();
            
            // Speichern mit atomarem Write für Linux
            await safeWriteFile(devicesFile, JSON.stringify(devices, null, 2));
            console.log('✅ devices.json erfolgreich gespeichert.');
            
            res.status(201).json({ message: 'Gerät erfolgreich hinzugefügt', device: newDevice });
        }

    } catch (error) {
        console.error('❌ Fehler beim Verarbeiten der Gerätedaten:', error);
        res.status(500).json({ error: 'Serverfehler beim Speichern der Gerätedaten: ' + error.message });
    }
});

// PUT /api/devices/:assetNumber - Aktualisiert ein Gerät
app.put('/api/devices/:assetNumber', async (req, res) => {
    try {
        const assetNumber = req.params.assetNumber;
        console.log(`📝 PUT /api/devices/${assetNumber}`);
        
        let devices = JSON.parse(await fs.promises.readFile(devicesFile, 'utf8'));
        
        const deviceIndex = devices.findIndex(d => d.assetNumber === assetNumber);
        
        if (deviceIndex === -1) {
            console.error(`❌ Gerät nicht gefunden: ${assetNumber}`);
            return res.status(404).json({ error: 'Gerät nicht gefunden' });
        }
        
        devices[deviceIndex] = {
            ...devices[deviceIndex],
            ...req.body,
            lastModified: new Date().toISOString(),
            modifiedBy: 'system'
        };
        
        // Backup vor dem Speichern
        await backupDevicesFile();
        
        // Speichern mit atomarem Write für Linux
        await safeWriteFile(devicesFile, JSON.stringify(devices, null, 2));
        console.log(`✅ Gerät aktualisiert (PUT): ${assetNumber}`);
        
        res.status(200).json({ message: 'Gerät erfolgreich aktualisiert', device: devices[deviceIndex] });
    } catch (error) {
        console.error('❌ Fehler beim Aktualisieren des Geräts (PUT):', error);
        res.status(500).json({ error: 'Serverfehler beim Aktualisieren des Geräts' });
    }
});

// DELETE /api/devices/:assetNumber - Löscht ein Gerät
app.delete('/api/devices/:assetNumber', async (req, res) => {
    try {
        const assetNumber = req.params.assetNumber;
        console.log(`🗑️  DELETE /api/devices/${assetNumber}`);
        
        let devices = JSON.parse(await fs.promises.readFile(devicesFile, 'utf8'));
        const initialLength = devices.length;

        devices = devices.filter(device => device.assetNumber !== assetNumber);

        if (devices.length < initialLength) {
            // Backup vor dem Speichern
            await backupDevicesFile();
            
            // Speichern mit atomarem Write für Linux
            await safeWriteFile(devicesFile, JSON.stringify(devices, null, 2));
            console.log(`✅ Gerät gelöscht: ${assetNumber}`);
            res.status(200).json({ message: 'Gerät erfolgreich gelöscht' });
        } else {
            console.error(`❌ Gerät zum Löschen nicht gefunden: ${assetNumber}`);
            res.status(404).json({ error: 'Gerät nicht gefunden' });
        }
    } catch (error) {
        console.error('❌ Fehler beim Löschen des Geräts:', error);
        res.status(500).json({ error: 'Serverfehler beim Löschen des Geräts' });
    }
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

// Diagnose-Endpunkt
app.get('/api/diagnose', async (req, res) => {
    const diagnosis = {
        timestamp: new Date().toISOString(),
        platform: process.platform,
        nodeVersion: process.version,
        workingDirectory: process.cwd(),
        serverDirectory: __dirname,
        devicesFile: devicesFile,
        fileSystem: {}
    };
    
    // Prüfe devices.json
    try {
        const stats = await fs.promises.stat(devicesFile);
        diagnosis.fileSystem.devicesFile = {
            exists: true,
            size: stats.size,
            mode: stats.mode.toString(8),
            uid: stats.uid,
            gid: stats.gid,
            canRead: true,
            canWrite: true
        };
        
        // Prüfe Leserechte
        try {
            await fs.promises.access(devicesFile, fs.constants.R_OK);
            diagnosis.fileSystem.devicesFile.canRead = true;
        } catch (e) {
            diagnosis.fileSystem.devicesFile.canRead = false;
            diagnosis.fileSystem.devicesFile.readError = e.message;
        }
        
        // Prüfe Schreibrechte
        try {
            await fs.promises.access(devicesFile, fs.constants.W_OK);
            diagnosis.fileSystem.devicesFile.canWrite = true;
        } catch (e) {
            diagnosis.fileSystem.devicesFile.canWrite = false;
            diagnosis.fileSystem.devicesFile.writeError = e.message;
        }
        
        // Prüfe JSON-Validität
        try {
            const data = await fs.promises.readFile(devicesFile, 'utf8');
            const devices = JSON.parse(data);
            diagnosis.fileSystem.devicesFile.validJson = true;
            diagnosis.fileSystem.devicesFile.deviceCount = devices.length;
        } catch (e) {
            diagnosis.fileSystem.devicesFile.validJson = false;
            diagnosis.fileSystem.devicesFile.jsonError = e.message;
        }
        
    } catch (e) {
        diagnosis.fileSystem.devicesFile = {
            exists: false,
            error: e.message
        };
    }
    
    // Prüfe Backup-Verzeichnis
    try {
        const backupDir = path.join(__dirname, 'backups');
        const stats = await fs.promises.stat(backupDir);
        const files = await fs.promises.readdir(backupDir);
        const backupFiles = files.filter(f => f.startsWith('devices-backup-') && f.endsWith('.json'));
        
        diagnosis.fileSystem.backups = {
            exists: true,
            mode: stats.mode.toString(8),
            backupCount: backupFiles.length
        };
    } catch (e) {
        diagnosis.fileSystem.backups = {
            exists: false,
            error: e.message
        };
    }
    
    res.json(diagnosis);
});

// Reparatur-Endpunkt
app.post('/api/repair', async (req, res) => {
    if (process.platform === 'win32') {
        return res.status(400).json({ 
            error: 'Diese Funktion ist nur für Linux/Ubuntu verfügbar',
            message: 'Auf Windows sind keine Berechtigungs-Reparaturen nötig'
        });
    }
    
    try {
        await repairFilePermissions();
        res.json({ 
            success: true,
            message: 'Berechtigungen erfolgreich repariert'
        });
    } catch (error) {
        res.status(500).json({ 
            error: 'Reparatur fehlgeschlagen', 
            message: error.message 
        });
    }
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

// Funktion zum Reparieren der Dateiberechtigungen (nur Linux)
async function repairFilePermissions() {
    if (process.platform === 'win32') {
        console.log('ℹ️  Windows erkannt, kein Berechtigungs-Check nötig');
        return;
    }
    
    try {
        console.log('🔧 Prüfe und repariere Dateiberechtigungen...');
        
        // Stelle sicher, dass das public Verzeichnis die richtigen Berechtigungen hat
        const publicDir = path.join(__dirname, 'public');
        await fs.promises.chmod(publicDir, 0o755);
        console.log('✅ public/ Verzeichnis: 755');
        
        // Prüfe ob devices.json existiert
        try {
            await fs.promises.access(devicesFile);
            // Setze Berechtigungen auf 666 (rw-rw-rw-)
            await fs.promises.chmod(devicesFile, 0o666);
            console.log('✅ devices.json: 666');
        } catch (error) {
            console.log('📄 devices.json existiert noch nicht, wird bei Bedarf erstellt');
        }
        
        // Backup-Verzeichnis
        const backupDir = path.join(__dirname, 'backups');
        await fs.promises.chmod(backupDir, 0o755);
        console.log('✅ backups/ Verzeichnis: 755');
        
        console.log('✅ Berechtigungen erfolgreich repariert');
    } catch (error) {
        console.error('❌ Fehler beim Reparieren der Berechtigungen:', error);
        console.error('💡 Versuche: sudo chmod -R 755 public && sudo chmod 666 public/devices.json');
    }
}

// Funktion zur Initialisierung der devices.json-Datei
async function initializeDevicesFile() {
    try {
        await fs.promises.access(devicesFile);
        console.log('✅ devices.json gefunden.');
        
        // Prüfe ob die Datei gültiges JSON enthält
        const data = await fs.promises.readFile(devicesFile, 'utf8');
        JSON.parse(data);
        console.log('✅ devices.json enthält gültiges JSON.');
        
        // Prüfe Berechtigungen auf Linux
        checkFilePermissions();
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('📄 devices.json nicht gefunden. Erstelle neue Datei...');
            await safeWriteFile(devicesFile, JSON.stringify([], null, 2));
            console.log('✅ devices.json erfolgreich erstellt.');
        } else {
            console.error('❌ devices.json ist beschädigt oder enthält ungültiges JSON:', error.message);
            
            // Versuche Backup wiederherzustellen
            const backupDir = path.join(__dirname, 'backups');
            try {
                const files = await fs.promises.readdir(backupDir);
                const backupFiles = files
                    .filter(f => f.startsWith('devices-backup-') && f.endsWith('.json'))
                    .map(f => ({ name: f, path: path.join(backupDir, f) }))
                    .sort((a, b) => b.name.localeCompare(a.name));
                
                if (backupFiles.length > 0) {
                    console.log(`🔄 Versuche Backup wiederherzustellen: ${backupFiles[0].name}`);
                    await fs.promises.copyFile(backupFiles[0].path, devicesFile);
                    console.log('✅ Backup erfolgreich wiederhergestellt!');
                } else {
                    console.log('⚠️  Kein Backup gefunden. Erstelle neue leere Datei...');
                    await safeWriteFile(devicesFile, JSON.stringify([], null, 2));
                }
            } catch (backupError) {
                console.error('❌ Konnte Backup nicht wiederherstellen:', backupError.message);
                console.log('📄 Erstelle neue leere devices.json...');
                await safeWriteFile(devicesFile, JSON.stringify([], null, 2));
            }
        }
    }
    
    // Backup-Verzeichnis erstellen
    const backupDir = path.join(__dirname, 'backups');
    await fs.promises.mkdir(backupDir, { recursive: true });
    console.log('✅ Backup-Verzeichnis vorhanden.');
}

// ==================== Server-Start ====================

async function startServer() {
    await checkSSLCertificates();
    await initializeDevicesFile();
    
    // Auf Linux: Prüfe und repariere Berechtigungen
    if (process.platform !== 'win32') {
        console.log('🔧 Linux/Ubuntu erkannt - prüfe Berechtigungen...');
        await repairFilePermissions();
    }
    
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

// Globaler Fehler-Handler für Express
app.use((err, req, res, next) => {
    console.error('❌ Unerwarteter Fehler:', err);
    res.status(500).json({ 
        error: 'Interner Serverfehler', 
        message: err.message 
    });
});
}

// Starte den Server
startServer().catch(console.error);