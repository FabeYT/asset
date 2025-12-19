const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const app = express();
const PORT = 2000;
const clients = [];

// Pfad zur devices.json Datei im öffentlichen Verzeichnis
const devicesFile = path.join(__dirname, 'public', 'devices.json');

// SSE Endpunkt für Echtzeit-Kommunikation mit dem Frontend (z.B. für Console-Updates)
app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    clients.push(res);
    req.on('close', () => {
        clients.splice(clients.indexOf(res), 1);
    });
});

// Funktion zum Senden von Events an alle verbundenen Clients
function sendEventToClients(data) {
    clients.forEach(client => {
        client.write(`data: ${JSON.stringify(data)}\n\n`);
    });
}

// Funktion zum Senden einer Server-Startnachricht
function sendServerStartMessage() {
    const startMessage = {
        type: 'server-status',
        message: 'Server gestartet und bereit für Verbindungen',
        timestamp: new Date().toISOString()
    };
    sendEventToClients(startMessage);
    console.log('Server-Startnachricht an alle SSE-Clients gesendet.');
}

// Middleware für CORS (Cross-Origin Resource Sharing)
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if ('OPTIONS' == req.method) {
        res.sendStatus(200);
    } else {
        next();
    }
});

// Middleware zum Parsen von JSON-Request-Bodies
app.use(express.json());

// Statische Dateien aus dem 'public'-Verzeichnis bereitstellen
app.use(express.static('public'));

// Funktion zur Initialisierung der devices.json-Datei
async function initializeDevicesFile() {
    try {
        await fs.access(devicesFile);
        console.log('devices.json gefunden.');
    } catch {
        console.log('devices.json nicht gefunden. Erstelle neue Datei...');
        await fs.writeFile(devicesFile, JSON.stringify([], null, 2));
        console.log('devices.json erfolgreich erstellt.');
    }
}

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
                // Weitere Felder können hier hinzugefügt werden, die beibehalten werden sollen
            };
            
            devices[existingIndex] = {
                ...newDevice,
                ...preservedFields, // Überschreibe die neuen Daten mit den beibehaltenen Feldern
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

// ==================== Server-Start ====================

async function startServer() {
    await initializeDevicesFile();
    const server = app.listen(PORT, () => {
        const localIps = getAllLocalIps();
        console.log('==================================================');
        console.log(`🚀 ETK Asset Management Server läuft auf Port ${PORT}`);
        console.log('==================================================');
        console.log(`📍 Lokal:            http://localhost:${PORT}`);
        if (localIps.length) {
            console.log(`🌐 Im Netzwerk erreichbar unter:`);
            localIps.forEach(ip => console.log(`   http://${ip}:${PORT}`));
        } else {
            console.log('⚠️  Keine Netzwerk-IP gefunden.');
        }
        console.log('==================================================');
        console.log(`📊 API-Endpunkte:`);
        console.log(`   GET    http://localhost:${PORT}/api/devices`);
        console.log(`   POST   http://localhost:${PORT}/api/devices`);
        console.log(`   PUT    http://localhost:${PORT}/api/devices/:assetNumber`);
        console.log(`   DELETE http://localhost:${PORT}/api/devices/:assetNumber`);
        console.log(`   Events http://localhost:${PORT}/events`);
        console.log('==================================================');
        sendServerStartMessage();
    });

    process.on('SIGINT', () => {
        console.log('\n==================================================');
        console.log('🛑 Server wird heruntergefahren...');
        sendEventToClients({
            type: 'server-status',
            message: 'Server wird heruntergefahren. Verbindung wird getrennt.',
            timestamp: new Date().toISOString()
        });
        clients.forEach(client => client.end());
        server.close(() => {
            console.log('✅ Server erfolgreich heruntergefahren.');
            console.log('==================================================');
            process.exit(0);
        });
    });
}

startServer().catch(console.error);