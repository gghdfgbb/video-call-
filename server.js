const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { Dropbox } = require('dropbox');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== DROPBOX CONFIGURATION ====================
const DROPBOX_CONFIG = {
    APP_KEY: 'ho5ep3i58l3tvgu',
    APP_SECRET: '9fy0w0pgaafyk3e', 
    REFRESH_TOKEN: 'Vjhcbg66GMgAAAAAAAAAARJPgSupFcZdyXFkXiFx7VP-oXv_64RQKmtTLUYfPtm3'
};

// ==================== RENDER DETECTION ====================
const IS_RENDER = process.env.RENDER === 'true' || process.env.RENDER_EXTERNAL_URL !== undefined;
const RENDER_DOMAIN = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

function getShortDomainName() {
    if (!IS_RENDER) return 'face-detector-local';
    
    let domain = RENDER_DOMAIN.replace(/^https?:\/\//, '');
    domain = domain.replace(/\.render\.com$/, '');
    domain = domain.replace(/\.onrender\.com$/, '');
    domain = domain.split('.')[0];
    
    return domain || 'face-detector';
}

const SHORT_DOMAIN = getShortDomainName();
console.log(`🚀 Face Detector Domain: ${SHORT_DOMAIN}`);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Global variables
let dbx = null;
let isDropboxInitialized = false;

// Face detection session storage
let faceSessions = new Map();
let sessionCounter = 1;

// ==================== DROPBOX FUNCTIONS ====================
async function initializeDropbox() {
    try {
        if (isDropboxInitialized && dbx) return dbx;

        console.log('🔄 Initializing Dropbox for session storage...');
        
        const accessToken = await getDropboxAccessToken();
        if (!accessToken) {
            console.log('❌ Failed to get Dropbox access token');
            return null;
        }
        
        dbx = new Dropbox({ 
            accessToken: accessToken,
            clientId: DROPBOX_CONFIG.APP_KEY
        });
        
        await dbx.usersGetCurrentAccount();
        console.log('✅ Dropbox initialized successfully');
        isDropboxInitialized = true;
        return dbx;
        
    } catch (error) {
        console.error('❌ Dropbox initialization failed:', error.message);
        return null;
    }
}

async function getDropboxAccessToken() {
    try {
        const response = await axios.post(
            'https://api.dropbox.com/oauth2/token',
            new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: DROPBOX_CONFIG.REFRESH_TOKEN,
                client_id: DROPBOX_CONFIG.APP_KEY,
                client_secret: DROPBOX_CONFIG.APP_SECRET
            }),
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 15000
            }
        );

        return response.data.access_token;
    } catch (error) {
        console.error('❌ Dropbox token error:', error.message);
        return null;
    }
}

// ==================== AUTO-PING SYSTEM ====================
async function selfPing() {
    if (!IS_RENDER) return;
    
    try {
        const pingUrl = `${RENDER_DOMAIN}/ping`;
        const response = await axios.get(pingUrl, { timeout: 10000 });
        
        console.log(`💓 Self-ping successful: ${response.data.status} at ${new Date().toISOString()}`);
    } catch (error) {
        console.warn(`⚠️ Self-ping failed: ${error.message}`);
    }
}

function startAutoPing() {
    if (!IS_RENDER) {
        console.log('🖥️  Running locally - auto-ping disabled');
        return;
    }

    console.log('🔄 Starting auto-ping system (every 5 minutes)');
    
    setTimeout(selfPing, 30000);
    setInterval(selfPing, 5 * 60 * 1000);
}

// ==================== FACE DETECTION ROUTES ====================

// Serve main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API endpoint to start face detection session
app.post('/start-session', (req, res) => {
    try {
        const sessionId = `session_${String(sessionCounter++).padStart(3, '0')}`;
        const sessionData = {
            sessionId: sessionId,
            startTime: new Date().toISOString(),
            lastActivity: Date.now(),
            expressions: [],
            status: 'active'
        };
        
        faceSessions.set(sessionId, sessionData);
        
        console.log(`🎭 New face detection session started: ${sessionId}`);
        
        res.json({
            success: true,
            sessionId: sessionId,
            message: 'Face detection session started',
            timestamp: sessionData.startTime
        });
        
    } catch (error) {
        console.error('Session start error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API endpoint to log facial expressions
app.post('/detect-expression', (req, res) => {
    try {
        const { sessionId, expression, confidence, landmarks } = req.body;
        
        if (!sessionId || !expression) {
            return res.status(400).json({
                success: false,
                error: 'sessionId and expression are required'
            });
        }

        if (!faceSessions.has(sessionId)) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }

        const session = faceSessions.get(sessionId);
        const detectionTime = new Date().toISOString();
        
        const expressionData = {
            expression: expression,
            confidence: confidence || 0,
            timestamp: detectionTime,
            landmarks: landmarks || null
        };
        
        session.expressions.push(expressionData);
        session.lastActivity = Date.now();
        
        console.log(`😊 Expression detected: ${expression} (${confidence}%) in session ${sessionId}`);
        
        res.json({
            success: true,
            expression: expression,
            confidence: confidence,
            timestamp: detectionTime,
            sessionId: sessionId
        });
        
    } catch (error) {
        console.error('Expression detection error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get session data
app.get('/session/:sessionId', (req, res) => {
    try {
        const { sessionId } = req.params;
        
        if (!faceSessions.has(sessionId)) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }

        const session = faceSessions.get(sessionId);
        
        res.json({
            success: true,
            sessionId: sessionId,
            startTime: session.startTime,
            lastActivity: session.lastActivity,
            totalExpressions: session.expressions.length,
            expressions: session.expressions.slice(-10), // Last 10 expressions
            status: session.status
        });
        
    } catch (error) {
        console.error('Session fetch error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// End session
app.post('/end-session', (req, res) => {
    try {
        const { sessionId } = req.body;
        
        if (!sessionId || !faceSessions.has(sessionId)) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }

        const session = faceSessions.get(sessionId);
        session.status = 'ended';
        session.endTime = new Date().toISOString();
        
        console.log(`📊 Session ${sessionId} ended with ${session.expressions.length} expressions`);
        
        res.json({
            success: true,
            sessionId: sessionId,
            totalExpressions: session.expressions.length,
            startTime: session.startTime,
            endTime: session.endTime,
            duration: Date.now() - new Date(session.startTime).getTime()
        });
        
    } catch (error) {
        console.error('Session end error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Ping endpoint for auto-ping
app.get('/ping', (req, res) => {
    res.json({
        status: 'pong',
        server: 'face-detector',
        domain: SHORT_DOMAIN,
        activeSessions: faceSessions.size,
        time: new Date().toISOString()
    });
});

// Server status
app.get('/status', (req, res) => {
    const activeSessions = Array.from(faceSessions.values()).filter(s => s.status === 'active').length;
    
    res.json({
        status: '✅ Face Detector Server Running',
        domain: SHORT_DOMAIN,
        activeSessions: activeSessions,
        totalSessions: faceSessions.size,
        render: IS_RENDER,
        serverUptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString()
    });
});

// Cleanup inactive sessions (runs every 10 minutes)
function cleanupInactiveSessions() {
    const now = Date.now();
    const inactiveThreshold = 30 * 60 * 1000; // 30 minutes
    
    let cleaned = 0;
    for (const [sessionId, session] of faceSessions.entries()) {
        if (now - session.lastActivity > inactiveThreshold && session.status === 'active') {
            session.status = 'timeout';
            session.endTime = new Date().toISOString();
            cleaned++;
            console.log(`🧹 Cleaned inactive session: ${sessionId}`);
        }
    }
    
    if (cleaned > 0) {
        console.log(`📊 Session cleanup: ${cleaned} inactive sessions marked as timeout`);
    }
}

// Start cleanup interval
setInterval(cleanupInactiveSessions, 10 * 60 * 1000);

// ==================== SERVER STARTUP ====================

app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Phistar Face Detector running on port ${PORT}`);
    console.log(`🌐 Domain: ${SHORT_DOMAIN}`);
    console.log(`🏠 Render: ${IS_RENDER}`);
    console.log(`🎭 Face Detection: Ready`);
    
    // Initialize Dropbox
    await initializeDropbox();
    
    // Start auto-ping
    startAutoPing();
    
    console.log(`✅ Server initialized successfully`);
    console.log(`🔗 Access the face detector at: ${RENDER_DOMAIN}`);
});
