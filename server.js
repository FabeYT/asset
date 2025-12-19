const express = require('express');
const https = require('https');
const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const cluster = require('cluster');
const numCPUs = require('os').cpus().length;

// Cluster für Skalierung
if (cluster.isMaster && process.env.NODE_ENV !== 'development') {
  console.log(`🏗️  Master ${process.pid} is running`);
  
  // Fork workers
  for (let i = 0; i < Math.min(numCPUs, 4); i++) {
    cluster.fork();
  }
  
  cluster.on('exit', (worker, code, signal) => {
    console.log(`❌ Worker ${worker.process.pid} died. Forking new worker...`);
    cluster.fork();
  });
  
  return;
}

const app = express();
const PORT_HTTP = 2000;
const PORT_HTTPS = 2001;
const clients = [];

// Pfad zur devices.json Datei im öffentlichen Verzeichnis
const devicesFile = path.join(__dirname, 'public', 'devices.json');

// Pfade für SSL Zertifikate (falls vorhanden)
const sslOptions = {
  key: null,
  cert: null,
  isHttpsAvailable: false
};

// Prüfe ob SSL Zertifikate vorhanden sind
async function checkSSLCertificates() {
  try {
    const keyPath = path.join(__dirname, 'ssl', 'key.pem');
    const certPath = path.join(__dirname, 'ssl', 'cert.pem');
    
    sslOptions.key = await fs.readFile(keyPath);
    sslOptions.cert = await fs.readFile(certPath);
    sslOptions.isHttpsAvailable = true;
    console.log('✅ SSL Zertifikate gefunden. HTTPS wird aktiviert.');
  } catch (error) {
    console.log('⚠️  SSL Zertifikate nicht gefunden. Nur HTTP wird verfügbar sein.');
    console.log('   Um HTTPS zu aktivieren:');
    console.log('   1. Erstelle ein Verzeichnis "ssl" im Projektroot');
    console.log('   2. Platziere key.pem und cert.pem darin');
    console.log('   3. Oder generiere selbstsignierte Zertifikate mit:');
    console.log('      openssl req -nodes -new -x509 -keyout ssl/key.pem -out ssl/cert.pem');
  }
}

// Erweiterte Middleware
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  etag: false
}));

app.use(express.json({ 
  limit: '100mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

app.use(express.urlencoded({ 
  extended: true, 
  limit: '100mb' 
}));

// Memory Management
const activeConnections = new Map();
let currentMemoryUsage = 0;

const MEMORY_LIMITS = {
    MAX_MEMORY_USAGE: 500 * 1024 * 1024, // 500MB Hard Limit
    WARNING_THRESHOLD: 400 * 1024 * 1024, // 400MB Warning
    CHUNK_SIZE: 20 * 1024 * 1024,
    MAX_CONCURRENT_TRANSFERS: 5
};

function updateMemoryUsage(delta) {
  currentMemoryUsage += delta;
  
  if (currentMemoryUsage > MEMORY_LIMITS.MAX_MEMORY_USAGE) {
    cleanupMemory();
  }
}

function cleanupMemory() {
  const now = Date.now();
  const connectionTimeout = 5 * 60 * 1000;
  
  // Bereinige inaktive SSE-Verbindungen
  activeConnections.forEach((info, res) => {
    if (now - info.lastActivity > connectionTimeout) {
      if (!res.headersSent) {
        res.end();
      }
      activeConnections.delete(res);
    }
  });
  
  console.log(`🧹 Memory bereinigt. Aktuelle Nutzung: ${formatFileSize(currentMemoryUsage)}`);
}

function checkMemoryUsage() {
    const usage = process.memoryUsage();
    const realUsage = usage.heapUsed + usage.external;
    
    if (realUsage > MEMORY_LIMITS.MAX_MEMORY_USAGE) {
        console.error('🚨 CRITICAL: Memory limit exceeded');
        return false;
    }
    
    if (realUsage > MEMORY_LIMITS.WARNING_THRESHOLD) {
        console.warn('⚠️ WARNING: High memory usage -', formatFileSize(realUsage));
        cleanupMemory();
    }
    
    return true;
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// SSE Endpunkt für Echtzeit-Kommunikation
app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    // Speichere Client mit Metadaten
    activeConnections.set(res, {
        connectedAt: Date.now(),
        lastActivity: Date.now(),
        ip: req.socket.remoteAddress,
        userAgent: req.headers['user-agent'] || 'Unbekannt'
    });
    
    clients.push(res);
    
    // Heartbeat für die Verbindung
    const heartbeatInterval = setInterval(() => {
        if (activeConnections.has(res)) {
            try {
                res.write(': heartbeat\n\n');
                activeConnections.get(res).lastActivity = Date.now();
            } catch (error) {
                console.log('⚠️ Heartbeat fehlgeschlagen');
                clearInterval(heartbeatInterval);
            }
        } else {
            clearInterval(heartbeatInterval);
        }
    }, 30000);
    
    req.on('close', () => {
        clearInterval(heartbeatInterval);
        activeConnections.delete(res);
        const index = clients.indexOf(res);
        if (index > -1) {
            clients.splice(index, 1);
        }
    });
    
    // Sofortige Willkommensnachricht
    res.write(`data: ${JSON.stringify({
        type: 'connected',
        message: 'SSE Verbindung hergestellt',
        timestamp: new Date().toISOString()
    })}\n\n`);
});

// Funktion zum Senden von Events an alle verbundenen Clients
function sendEventToClients(data) {
    const now = Date.now();
    activeConnections.forEach((info, client) => {
        try {
            client.write(`data: ${JSON.stringify(data)}\n\n`);
            info.lastActivity = now;
        } catch (error) {
            console.log('⚠️ Fehler beim Senden an Client:', error.message);
            activeConnections.delete(client);
            const index = clients.indexOf(client);
            if (index > -1) {
                clients.splice(index, 1);
            }
        }
    });
}

// Middleware für CORS
app.use((req, res, next) => {
  const userAgent = req.headers['user-agent'] || '';
  const isSafari = userAgent.includes('Safari') && !userAgent.includes('Chrome');
  
  if (isSafari) {
    // Erweiterte CORS-Header für Safari
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');
  } else {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  }
  
  if ('OPTIONS' == req.method) {
    res.sendStatus(200);
  } else {
    next();
  }
});

// ==================== API-Endpunkte ====================

// GET /api/devices - Ruft alle Geräte ab
app.get('/api/devices', async (req, res) => {
    try {
        const data = await fs.readFile(devicesFile, 'utf8');
        res.json(JSON.parse(data));
    } catch (error) {
        console.error('Fehler beim Lesen von devices.json:', error);
        res.json([]);
    }
});

// POST /api/devices - Fügt ein neues Gerät hinzu oder aktualisiert ein bestehendes
app.post('/api/devices', async (req, res) => {
    try {
        console.log('Empfangene Gerätedaten:', req.body);
        const newDevice = {
            ...req.body,
            id: Date.now(),
            timestamp: new Date().toISOString()
        };

        let devices = [];
        try {
            const data = await fs.readFile(devicesFile, 'utf8');
            devices = JSON.parse(data);
        } catch (error) {
            console.log('Konnte devices.json nicht lesen, erstelle eine neue Liste.');
            devices = [];
        }

        // Finde ein bestehendes Gerät anhand der eindeutigen Asset-Nummer
        const existingIndex = devices.findIndex(d => d.assetNumber === newDevice.assetNumber);

        if (existingIndex > -1) {
            const oldDevice = devices[existingIndex];
            
            // Behalte bestimmte Felder aus dem alten Gerät bei
            const preservedFields = {
                location: oldDevice.location, // Standort beibehalten
                notes: oldDevice.notes,       // Notizen beibehalten
                status: oldDevice.status,      // Status beibehalten
            };
            
            devices[existingIndex] = {
                ...newDevice,
                ...preservedFields,
                id: oldDevice.id,
                lastModified: new Date().toISOString(),
                modifiedBy: 'system'
            };
            
            console.log(`Gerät aktualisiert: ${newDevice.assetNumber || newDevice.hostname}`);
            sendEventToClients({
                type: 'device-updated',
                message: `Gerät ${newDevice.assetNumber} wurde aktualisiert`,
                device: devices[existingIndex]
            });
            res.status(200).json({ message: 'Gerät erfolgreich aktualisiert', device: devices[existingIndex] });
        } else {
            devices.push(newDevice);
            console.log(`Neues Gerät hinzugefügt: ${newDevice.assetNumber || newDevice.hostname}`);
            sendEventToClients({
                type: 'device-added',
                message: `Neues Gerät ${newDevice.assetNumber} wurde hinzugefügt`,
                device: newDevice
            });
            res.status(201).json({ message: 'Gerät erfolgreich hinzugefügt', device: newDevice });
        }

        await fs.writeFile(devicesFile, JSON.stringify(devices, null, 2));
        console.log('devices.json erfolgreich gespeichert.');

    } catch (error) {
        console.error('Fehler beim Verarbeiten der Gerätedaten:', error);
        res.status(500).json({ error: 'Serverfehler beim Speichern der Gerätedaten' });
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
        
        sendEventToClients({
            type: 'device-updated',
            message: `Gerät ${assetNumber} wurde aktualisiert`,
            device: devices[deviceIndex]
        });
        
        res.status(200).json({ message: 'Gerät erfolgreich aktualisiert', device: devices[deviceIndex] });
    } catch (error) {
        console.error('Fehler beim Aktualisieren des Geräts (PUT):', error);
        res.status(500).json({ error: 'Serverfehler beim Aktualisieren des Geräts' });
    }
});

// DELETE /api/devices/:assetNumber - Löscht ein Gerät
app.delete('/api/devices/:assetNumber', async (req, res) => {
    try {
        const assetNumber = req.params.assetNumber;
        let devices = JSON.parse(await fs.readFile(devicesFile, 'utf8'));
        const initialLength = devices.length;

        devices = devices.filter(device => device.assetNumber !== assetNumber);

        if (devices.length < initialLength) {
            await fs.writeFile(devicesFile, JSON.stringify(devices, null, 2));
            console.log(`Gerät gelöscht: ${assetNumber}`);
            sendEventToClients({
                type: 'device-deleted',
                message: `Gerät ${assetNumber} wurde gelöscht`,
                assetNumber: assetNumber
            });
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
    const memoryUsage = process.memoryUsage();
    res.json({
        status: 'online',
        connections: activeConnections.size,
        memory: {
            used: formatFileSize(memoryUsage.heapUsed),
            total: formatFileSize(memoryUsage.heapTotal),
            rss: formatFileSize(memoryUsage.rss)
        },
        uptime: process.uptime(),
        worker: process.pid
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
        await fs.access(devicesFile);
        console.log('✅ devices.json gefunden.');
    } catch {
        console.log('📄 devices.json nicht gefunden. Erstelle neue Datei...');
        await fs.writeFile(devicesFile, JSON.stringify([], null, 2));
        console.log('✅ devices.json erfolgreich erstellt.');
    }
}

// Regelmäßige Bereinigung
function setupCleanupIntervals() {
    // Bereinige inaktive Verbindungen jede Minute
    setInterval(() => {
        const now = Date.now();
        const connectionTimeout = 5 * 60 * 1000; // 5 Minuten
        
        activeConnections.forEach((info, res) => {
            if (now - info.lastActivity > connectionTimeout) {
                console.log(`🧹 Inaktive Verbindung bereinigt: ${info.ip}`);
                if (!res.headersSent) {
                    res.end();
                }
                activeConnections.delete(res);
                const index = clients.indexOf(res);
                if (index > -1) {
                    clients.splice(index, 1);
                }
            }
        });
        
        checkMemoryUsage();
    }, 60000);
}

// ==================== Server-Start ====================

async function startServer() {
    await checkSSLCertificates();
    await initializeDevicesFile();
    setupCleanupIntervals();
    
    const localIps = getAllLocalIps();
    
    // HTTP Server starten
    const httpServer = http.createServer(app);
    httpServer.listen(PORT_HTTP, () => {
        console.log('==================================================');
        console.log(`🚀 ETK Asset Management Server`);
        console.log(`👷 Worker ${process.pid} gestartet`);
        console.log('==================================================');
        console.log(`🌐 HTTP Server läuft auf Port ${PORT_HTTP}`);
        console.log('--------------------------------------------------');
        console.log(`📍 Lokal:            http://localhost:${PORT_HTTP}`);
        if (localIps.length) {
            localIps.forEach(ip => console.log(`   http://${ip}:${PORT_HTTP}`));
        }
        console.log('==================================================');
    });
    
    // HTTPS Server starten (falls Zertifikate vorhanden)
    if (sslOptions.isHttpsAvailable) {
        const httpsServer = https.createServer(sslOptions, app);
        httpsServer.listen(PORT_HTTPS, () => {
            console.log(`🔒 HTTPS Server läuft auf Port ${PORT_HTTPS}`);
            console.log('--------------------------------------------------');
            console.log(`📍 Lokal:            https://localhost:${PORT_HTTPS}`);
            if (localIps.length) {
                localIps.forEach(ip => console.log(`   https://${ip}:${PORT_HTTPS}`));
            }
            console.log('==================================================');
            console.log(`📊 API-Endpunkte:`);
            console.log(`   GET    /api/devices`);
            console.log(`   POST   /api/devices`);
            console.log(`   PUT    /api/devices/:assetNumber`);
            console.log(`   DELETE /api/devices/:assetNumber`);
            console.log(`   Events /events`);
            console.log(`   Status /api/server-info`);
            console.log('==================================================');
        });
    }
    
    // Graceful Shutdown
    process.on('SIGINT', () => {
        console.log('\n==================================================');
        console.log('🛑 Server wird heruntergefahren...');
        
        sendEventToClients({
            type: 'server-status',
            message: 'Server wird heruntergefahren. Verbindung wird getrennt.',
            timestamp: new Date().toISOString()
        });
        
        // Schließe alle SSE-Verbindungen
        activeConnections.forEach((info, client) => {
            if (!client.headersSent) {
                client.end();
            }
        });
        
        setTimeout(() => {
            console.log('✅ Server erfolgreich heruntergefahren.');
            console.log('==================================================');
            process.exit(0);
        }, 1000);
    });
}

startServer().catch(console.error);