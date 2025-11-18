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
console.log(`🚀 Ultra-Fast Face Detector Domain: ${SHORT_DOMAIN}`);

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
                timeout: 10000  // Reduced timeout for faster initialization
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
        const response = await axios.get(pingUrl, { timeout: 5000 }); // Faster timeout
        
        console.log(`💓 Self-ping successful: ${response.data.status}`);
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
    
    setTimeout(selfPing, 10000); // Faster initial ping
    setInterval(selfPing, 5 * 60 * 1000);
}

// ==================== OPTIMIZED FACE DETECTION ROUTES ====================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Optimized session start
app.post('/start-session', (req, res) => {
    try {
        const sessionId = `session_${String(sessionCounter++).padStart(3, '0')}`;
        const sessionData = {
            sessionId: sessionId,
            startTime: Date.now(), // Use timestamp for faster processing
            lastActivity: Date.now(),
            expressions: [],
            status: 'active'
        };
        
        faceSessions.set(sessionId, sessionData);
        
        console.log(`🎭 New ULTRA-FAST face detection session: ${sessionId}`);
        
        res.json({
            success: true,
            sessionId: sessionId,
            message: 'Ultra-fast face detection started',
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

// Optimized expression detection endpoint
app.post('/detect-expression', (req, res) => {
    try {
        const { sessionId, expression, confidence, landmarks } = req.body;
        
        if (!sessionId || !expression) {
            return res.status(400).json({
                success: false,
                error: 'sessionId and expression are required'
            });
        }

        const session = faceSessions.get(sessionId);
        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }

        // Fast timestamp
        const detectionTime = Date.now();
        
        const expressionData = {
            expression: expression,
            confidence: confidence || 0,
            timestamp: detectionTime,
            landmarks: landmarks || null
        };
        
        session.expressions.push(expressionData);
        session.lastActivity = detectionTime;
        
        // Fast response without waiting for processing
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

// Get session data (optimized)
app.get('/session/:sessionId', (req, res) => {
    try {
        const { sessionId } = req.params;
        const session = faceSessions.get(sessionId);
        
        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }

        res.json({
            success: true,
            sessionId: sessionId,
            startTime: session.startTime,
            lastActivity: session.lastActivity,
            totalExpressions: session.expressions.length,
            expressions: session.expressions.slice(-5), // Only last 5 for speed
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

// Optimized session end
app.post('/end-session', (req, res) => {
    try {
        const { sessionId } = req.body;
        const session = faceSessions.get(sessionId);
        
        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }

        session.status = 'ended';
        session.endTime = Date.now();
        
        console.log(`📊 Session ${sessionId} ended with ${session.expressions.length} expressions`);
        
        res.json({
            success: true,
            sessionId: sessionId,
            totalExpressions: session.expressions.length,
            startTime: session.startTime,
            endTime: session.endTime,
            duration: session.endTime - session.startTime
        });
        
    } catch (error) {
        console.error('Session end error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Fast ping endpoint
app.get('/ping', (req, res) => {
    res.json({
        status: 'pong',
        server: 'ultra-fast-face-detector',
        domain: SHORT_DOMAIN,
        activeSessions: Array.from(faceSessions.values()).filter(s => s.status === 'active').length,
        time: Date.now()
    });
});

// Optimized server status
app.get('/status', (req, res) => {
    const activeSessions = Array.from(faceSessions.values()).filter(s => s.status === 'active').length;
    
    res.json({
        status: '⚡ Ultra-Fast Face Detector Running',
        domain: SHORT_DOMAIN,
        activeSessions: activeSessions,
        totalSessions: faceSessions.size,
        render: IS_RENDER,
        serverUptime: Math.floor(process.uptime()),
        timestamp: Date.now()
    });
});

// Faster cleanup (every 5 minutes)
function cleanupInactiveSessions() {
    const now = Date.now();
    const inactiveThreshold = 15 * 60 * 1000; // 15 minutes (reduced)
    
    let cleaned = 0;
    for (const [sessionId, session] of faceSessions.entries()) {
        if (now - session.lastActivity > inactiveThreshold && session.status === 'active') {
            session.status = 'timeout';
            session.endTime = now;
            cleaned++;
        }
    }
    
    if (cleaned > 0) {
        console.log(`🧹 Fast cleanup: ${cleaned} inactive sessions`);
    }
}

// Faster cleanup interval
setInterval(cleanupInactiveSessions, 5 * 60 * 1000);

// ==================== SERVER STARTUP ====================

app.listen(PORT, '0.0.0.0', async () => {
    console.log(`⚡ ULTRA-FAST Phistar Face Detector running on port ${PORT}`);
    console.log(`🌐 Domain: ${SHORT_DOMAIN}`);
    console.log(`🏠 Render: ${IS_RENDER}`);
    console.log(`🎭 Face Detection: ULTRA-FAST MODE`);
    
    // Initialize Dropbox in background (non-blocking)
    initializeDropbox().then(() => {
        console.log('✅ Dropbox ready for fast sessions');
    });
    
    // Start auto-ping
    startAutoPing();
    
    console.log(`✅ Server initialized - ULTRA FAST DETECTION READY`);
    console.log(`🔗 Access at: ${RENDER_DOMAIN}`);
});
