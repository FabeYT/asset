const express = require('express');
const https = require('https');
const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
require('dotenv').config();
const mysql = require('mysql2/promise');

const app = express();
const PORT_HTTP = process.env.PORT || 2000;
const PORT_HTTP_80 = 80;
const PORT_HTTPS = 443;
const clients = [];

// MySQL Datenbank-Konfiguration
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'asset_management',
    port: process.env.DB_PORT || 3306
};

let dbPool;

// Pfad zur devices.json Datei (für Migration)
const devicesFile = path.join(__dirname, 'public', 'devices.json');

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

// Funktion zum Erstellen der Datenbankverbindung
async function createDbConnection() {
    try {
        dbPool = mysql.createPool({
            ...dbConfig,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
        });
        console.log('✅ MySQL Verbindung erfolgreich hergestellt');
        return true;
    } catch (error) {
        console.error('❌ Fehler bei der MySQL Verbindung:', error);
        return false;
    }
}

// Funktion zum Erstellen der devices Tabelle
async function createDevicesTable() {
    try {
        const createTableQuery = `
            CREATE TABLE IF NOT EXISTS devices (
                id INT AUTO_INCREMENT PRIMARY KEY,
                assetNumber VARCHAR(50) UNIQUE NOT NULL,
                manufacturer VARCHAR(100),
                model VARCHAR(100),
                serialNumber VARCHAR(100),
                hostname VARCHAR(100),
                os VARCHAR(100),
                osVersion VARCHAR(50),
                osArch VARCHAR(50),
                cpu TEXT,
                ramGB DECIMAL(10,2),
                cores INT,
                logicalProc INT,
                gpu JSON,
                biosVersion VARCHAR(100),
                network JSON,
                drives JSON,
                user VARCHAR(100),
                location VARCHAR(255),
                notes TEXT,
                status VARCHAR(50) DEFAULT 'in Betrieb',
                timestamp DATETIME,
                lastModified DATETIME,
                modifiedBy VARCHAR(50),
                INDEX idx_assetNumber (assetNumber),
                INDEX idx_hostname (hostname)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `;
        
        await dbPool.execute(createTableQuery);
        console.log('✅ Tabelle "devices" erfolgreich erstellt');
    } catch (error) {
        console.error('❌ Fehler beim Erstellen der Tabelle:', error);
        throw error;
    }
}

// Datenbankinitialisierung
async function initializeDatabase() {
    try {
        const connected = await createDbConnection();
        if (!connected) {
            return false;
        }
        
        await createDevicesTable();
        
        // Migration von devices.json wenn vorhanden
        await migrateFromJson();
        
        return true;
    } catch (error) {
        console.error('❌ Fehler bei der Datenbankinitialisierung:', error);
        return false;
    }
}

// Migration von devices.json zur MySQL Datenbank
async function migrateFromJson() {
    try {
        const data = await fs.readFile(devicesFile, 'utf8');
        const devices = JSON.parse(data);
        
        if (devices.length === 0) {
            console.log('📄 devices.json ist leer, keine Migration nötig');
            return;
        }
        
        console.log(`🔄 Beginne Migration von ${devices.length} Geräten...`);
        
        for (const device of devices) {
            const insertQuery = `
                INSERT INTO devices (
                    id, assetNumber, manufacturer, model, serialNumber, hostname, 
                    os, osVersion, osArch, cpu, ramGB, cores, logicalProc, gpu, 
                    biosVersion, network, drives, user, location, notes, 
                    status, timestamp, lastModified, modifiedBy
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    manufacturer = VALUES(manufacturer),
                    model = VALUES(model),
                    serialNumber = VALUES(serialNumber),
                    hostname = VALUES(hostname),
                    os = VALUES(os),
                    osVersion = VALUES(osVersion),
                    osArch = VALUES(osArch),
                    cpu = VALUES(cpu),
                    ramGB = VALUES(ramGB),
                    cores = VALUES(cores),
                    logicalProc = VALUES(logicalProc),
                    gpu = VALUES(gpu),
                    biosVersion = VALUES(biosVersion),
                    network = VALUES(network),
                    drives = VALUES(drives),
                    user = VALUES(user),
                    location = VALUES(location),
                    notes = VALUES(notes),
                    status = VALUES(status),
                    timestamp = VALUES(timestamp),
                    lastModified = VALUES(lastModified),
                    modifiedBy = VALUES(modifiedBy)
            `;
            
            await dbPool.execute(insertQuery, [
                device.id || null,
                device.assetNumber,
                device.manufacturer || null,
                device.model || null,
                device.serialNumber || null,
                device.hostname || null,
                device.os || null,
                device.osVersion || null,
                device.osArch || null,
                device.cpu || null,
                device.ramGB || null,
                device.cores || null,
                device.logicalProc || null,
                JSON.stringify(device.gpu || []),
                device.biosVersion || null,
                JSON.stringify(device.network || {}),
                JSON.stringify(device.drives || { localDrives: [], otherDrives: [], networkDrives: [] }),
                device.user || null,
                device.location || null,
                device.notes || null,
                device.status || 'in Betrieb',
                device.timestamp || null,
                device.lastModified || null,
                device.modifiedBy || 'system'
            ]);
        }
        
        console.log('✅ Migration erfolgreich abgeschlossen');
        console.log('💡 devices.json kann jetzt gelöscht werden');
    } catch (error) {
        console.log('📄 devices.json nicht gefunden oder leer, keine Migration nötig');
    }
}

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
        const [rows] = await dbPool.execute('SELECT * FROM devices ORDER BY timestamp DESC');
        const devices = rows.map(device => ({
            ...device,
            gpu: device.gpu ? JSON.parse(device.gpu) : [],
            network: device.network ? JSON.parse(device.network) : {},
            drives: device.drives ? JSON.parse(device.drives) : { localDrives: [], otherDrives: [], networkDrives: [] }
        }));
        res.json(devices);
    } catch (error) {
        console.error('Fehler beim Abrufen der Geräte:', error);
        res.json([]);
    }
});

// POST /api/devices - Fügt ein neues Gerät hinzu oder aktualisiert ein bestehendes
app.post('/api/devices', async (req, res) => {
    try {
        console.log('Empfangene Gerätedaten:', req.body);
        const newDevice = {
            ...req.body,
            timestamp: new Date().toISOString()
        };

        const existingQuery = 'SELECT * FROM devices WHERE assetNumber = ?';
        const [existingRows] = await dbPool.execute(existingQuery, [newDevice.assetNumber]);

        let mergedDrives;
        
        if (existingRows.length > 0) {
            const oldDevice = existingRows[0];
            const oldDrives = oldDevice.drives ? JSON.parse(oldDevice.drives) : { localDrives: [], otherDrives: [], networkDrives: [] };
            
            mergedDrives = {
                localDrives: newDevice.drives?.localDrives || [],
                otherDrives: newDevice.drives?.otherDrives || [],
                networkDrives: newDevice.drives?.networkDrives || []
            };
            
            const updateQuery = `
                UPDATE devices SET
                    manufacturer = ?,
                    model = ?,
                    serialNumber = ?,
                    hostname = ?,
                    os = ?,
                    osVersion = ?,
                    osArch = ?,
                    cpu = ?,
                    ramGB = ?,
                    cores = ?,
                    logicalProc = ?,
                    gpu = ?,
                    biosVersion = ?,
                    network = ?,
                    drives = ?,
                    user = ?,
                    location = ?,
                    notes = ?,
                    status = ?,
                    lastModified = ?,
                    modifiedBy = ?
                WHERE assetNumber = ?
            `;
            
            await dbPool.execute(updateQuery, [
                newDevice.manufacturer || null,
                newDevice.model || null,
                newDevice.serialNumber || null,
                newDevice.hostname || null,
                newDevice.os || null,
                newDevice.osVersion || null,
                newDevice.osArch || null,
                newDevice.cpu || null,
                newDevice.ramGB || null,
                newDevice.cores || null,
                newDevice.logicalProc || null,
                JSON.stringify(newDevice.gpu || []),
                newDevice.biosVersion || null,
                JSON.stringify(newDevice.network || {}),
                JSON.stringify(mergedDrives),
                newDevice.user || null,
                oldDevice.location || null,
                oldDevice.notes || null,
                oldDevice.status || 'in Betrieb',
                new Date().toISOString(),
                'system',
                newDevice.assetNumber
            ]);
            
            console.log(`Gerät aktualisiert: ${newDevice.assetNumber || newDevice.hostname}`);
            console.log(`Netzlaufwerke gespeichert: ${mergedDrives.networkDrives.length}`);
            res.status(200).json({ message: 'Gerät erfolgreich aktualisiert', assetNumber: newDevice.assetNumber });
        } else {
            if (!newDevice.drives) {
                newDevice.drives = {
                    localDrives: [],
                    otherDrives: [],
                    networkDrives: []
                };
            }
            mergedDrives = newDevice.drives;
            
            const insertQuery = `
                INSERT INTO devices (
                    assetNumber, manufacturer, model, serialNumber, hostname, 
                    os, osVersion, osArch, cpu, ramGB, cores, logicalProc, gpu, 
                    biosVersion, network, drives, user, location, notes, 
                    status, timestamp, lastModified, modifiedBy
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            
            await dbPool.execute(insertQuery, [
                newDevice.assetNumber,
                newDevice.manufacturer || null,
                newDevice.model || null,
                newDevice.serialNumber || null,
                newDevice.hostname || null,
                newDevice.os || null,
                newDevice.osVersion || null,
                newDevice.osArch || null,
                newDevice.cpu || null,
                newDevice.ramGB || null,
                newDevice.cores || null,
                newDevice.logicalProc || null,
                JSON.stringify(newDevice.gpu || []),
                newDevice.biosVersion || null,
                JSON.stringify(newDevice.network || {}),
                JSON.stringify(mergedDrives),
                newDevice.user || null,
                newDevice.location || null,
                newDevice.notes || null,
                newDevice.status || 'in Betrieb',
                newDevice.timestamp,
                new Date().toISOString(),
                'system'
            ]);
            
            console.log(`Neues Gerät hinzugefügt: ${newDevice.assetNumber || newDevice.hostname}`);
            console.log(`Netzlaufwerke gespeichert: ${mergedDrives.networkDrives.length}`);
            res.status(201).json({ message: 'Gerät erfolgreich hinzugefügt', assetNumber: newDevice.assetNumber });
        }

    } catch (error) {
        console.error('Fehler beim Verarbeiten der Gerätedaten:', error);
        res.status(500).json({ error: 'Serverfehler beim Speichern der Gerätedaten' });
    }
});

// PUT /api/devices/:assetNumber - Aktualisiert ein Gerät
app.put('/api/devices/:assetNumber', async (req, res) => {
    try {
        const assetNumber = req.params.assetNumber;
        
        const [rows] = await dbPool.execute('SELECT * FROM devices WHERE assetNumber = ?', [assetNumber]);
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Gerät nicht gefunden' });
        }
        
        const existingDevice = rows[0];
        const updateData = { ...req.body };
        
        const updateQuery = `
            UPDATE devices SET
                manufacturer = ?,
                model = ?,
                serialNumber = ?,
                hostname = ?,
                os = ?,
                osVersion = ?,
                osArch = ?,
                cpu = ?,
                ramGB = ?,
                cores = ?,
                logicalProc = ?,
                gpu = ?,
                biosVersion = ?,
                network = ?,
                drives = ?,
                user = ?,
                location = ?,
                notes = ?,
                status = ?,
                lastModified = ?,
                modifiedBy = ?
            WHERE assetNumber = ?
        `;
        
        await dbPool.execute(updateQuery, [
            updateData.manufacturer !== undefined ? updateData.manufacturer : existingDevice.manufacturer,
            updateData.model !== undefined ? updateData.model : existingDevice.model,
            updateData.serialNumber !== undefined ? updateData.serialNumber : existingDevice.serialNumber,
            updateData.hostname !== undefined ? updateData.hostname : existingDevice.hostname,
            updateData.os !== undefined ? updateData.os : existingDevice.os,
            updateData.osVersion !== undefined ? updateData.osVersion : existingDevice.osVersion,
            updateData.osArch !== undefined ? updateData.osArch : existingDevice.osArch,
            updateData.cpu !== undefined ? updateData.cpu : existingDevice.cpu,
            updateData.ramGB !== undefined ? updateData.ramGB : existingDevice.ramGB,
            updateData.cores !== undefined ? updateData.cores : existingDevice.cores,
            updateData.logicalProc !== undefined ? updateData.logicalProc : existingDevice.logicalProc,
            updateData.gpu !== undefined ? JSON.stringify(updateData.gpu) : existingDevice.gpu,
            updateData.biosVersion !== undefined ? updateData.biosVersion : existingDevice.biosVersion,
            updateData.network !== undefined ? JSON.stringify(updateData.network) : existingDevice.network,
            updateData.drives !== undefined ? JSON.stringify(updateData.drives) : existingDevice.drives,
            updateData.user !== undefined ? updateData.user : existingDevice.user,
            updateData.location !== undefined ? updateData.location : existingDevice.location,
            updateData.notes !== undefined ? updateData.notes : existingDevice.notes,
            updateData.status !== undefined ? updateData.status : existingDevice.status,
            new Date().toISOString(),
            'system',
            assetNumber
        ]);
        
        console.log(`Gerät aktualisiert (PUT): ${assetNumber}`);
        res.status(200).json({ message: 'Gerät erfolgreich aktualisiert', assetNumber });
    } catch (error) {
        console.error('Fehler beim Aktualisieren des Geräts (PUT):', error);
        res.status(500).json({ error: 'Serverfehler beim Aktualisieren des Geräts' });
    }
});

// DELETE /api/devices/:assetNumber - Löscht ein Gerät
app.delete('/api/devices/:assetNumber', async (req, res) => {
    try {
        const assetNumber = req.params.assetNumber;
        
        const [result] = await dbPool.execute('DELETE FROM devices WHERE assetNumber = ?', [assetNumber]);
        
        if (result.affectedRows > 0) {
            console.log(`Gerät gelöscht: ${assetNumber}`);
            res.status(200).json({ message: 'Gerät erfolgreich gelöscht' });
        } else {
            res.status(404).json({ error: 'Gerät nicht gefunden' });
        }
    } catch (error) {
        console.error('Fehler beim Löschen des Geräts:', error);
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

// Hilfsfunktion zum Finden aller lokalen IPv4-Adressen

// ==================== Server-Start ====================

async function startServer() {
    await checkSSLCertificates();
    
    const dbInitialized = await initializeDatabase();
    if (!dbInitialized) {
        console.error('❌ Datenbank konnte nicht initialisiert werden. Server wird nicht gestartet.');
        process.exit(1);
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
}

// Starte den Server
startServer().catch(console.error);