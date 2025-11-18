const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { Dropbox } = require('dropbox');
const multer = require('multer');

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
console.log(`🚀 Advanced Face & Image Mapper Domain: ${SHORT_DOMAIN}`);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Configure multer for image uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = 'uploads';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir);
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = `face_${Date.now()}_${Math.random().toString(36).substr(2, 9)}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'));
        }
    }
});

// Global variables
let dbx = null;
let isDropboxInitialized = false;

// Face detection session storage
let faceSessions = new Map();
let sessionCounter = 1;
let uploadedImages = new Map();

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
                timeout: 10000
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
        const response = await axios.get(pingUrl, { timeout: 5000 });
        
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
    
    setTimeout(selfPing, 10000);
    setInterval(selfPing, 5 * 60 * 1000);
}

// ==================== ENHANCED FACE & IMAGE MAPPING ROUTES ====================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Image upload endpoint
app.post('/upload-face', upload.single('faceImage'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'No image file uploaded'
            });
        }

        const imageId = `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const imageData = {
            id: imageId,
            filename: req.file.filename,
            originalName: req.file.originalname,
            path: `/uploads/${req.file.filename}`,
            uploadTime: Date.now(),
            size: req.file.size,
            mimetype: req.file.mimetype
        };

        uploadedImages.set(imageId, imageData);
        
        console.log(`🖼️ Image uploaded: ${imageData.originalName} (${imageId})`);
        
        res.json({
            success: true,
            imageId: imageId,
            imageUrl: imageData.path,
            filename: imageData.originalName,
            message: 'Face image uploaded successfully'
        });
        
    } catch (error) {
        console.error('Image upload error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get uploaded images
app.get('/uploaded-images', (req, res) => {
    const images = Array.from(uploadedImages.values()).map(img => ({
        id: img.id,
        url: img.path,
        filename: img.originalName,
        uploadTime: img.uploadTime
    }));
    
    res.json({
        success: true,
        images: images
    });
});

// Delete uploaded image
app.delete('/image/:imageId', (req, res) => {
    try {
        const { imageId } = req.params;
        const image = uploadedImages.get(imageId);
        
        if (!image) {
            return res.status(404).json({
                success: false,
                error: 'Image not found'
            });
        }

        // Delete file from filesystem
        const filePath = path.join(__dirname, 'uploads', image.filename);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        
        uploadedImages.delete(imageId);
        
        console.log(`🗑️ Image deleted: ${image.originalName}`);
        
        res.json({
            success: true,
            message: 'Image deleted successfully'
        });
        
    } catch (error) {
        console.error('Image delete error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Enhanced session start with image mapping
app.post('/start-session', (req, res) => {
    try {
        const { imageId } = req.body;
        const sessionId = `session_${String(sessionCounter++).padStart(3, '0')}`;
        
        const sessionData = {
            sessionId: sessionId,
            startTime: Date.now(),
            lastActivity: Date.now(),
            expressions: [],
            speechEvents: [],
            mappedImageId: imageId || null,
            status: 'active'
        };
        
        faceSessions.set(sessionId, sessionData);
        
        console.log(`🎭 New Face Mapping session: ${sessionId}${imageId ? ` with image ${imageId}` : ''}`);
        
        res.json({
            success: true,
            sessionId: sessionId,
            mappedImageId: imageId,
            message: 'Face mapping session started',
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

// Enhanced expression detection with image mapping data
app.post('/detect-expression', (req, res) => {
    try {
        const { sessionId, expression, confidence, landmarks, isSpeaking, mouthOpenness, headPosition, faceTransform } = req.body;
        
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

        const detectionTime = Date.now();
        
        const expressionData = {
            expression: expression,
            confidence: confidence || 0,
            timestamp: detectionTime,
            landmarks: landmarks || null,
            isSpeaking: isSpeaking || false,
            mouthOpenness: mouthOpenness || 0,
            headPosition: headPosition || 'center',
            faceTransform: faceTransform || null
        };
        
        session.expressions.push(expressionData);
        
        if (isSpeaking) {
            session.speechEvents.push({
                timestamp: detectionTime,
                mouthOpenness: mouthOpenness,
                duration: 0
            });
        }
        
        session.lastActivity = detectionTime;
        
        res.json({
            success: true,
            expression: expression,
            confidence: confidence,
            isSpeaking: isSpeaking,
            headPosition: headPosition,
            faceTransform: faceTransform,
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

// Get enhanced session data
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

        const speechStats = {
            totalEvents: session.speechEvents.length,
            averageMouthOpenness: session.speechEvents.reduce((sum, event) => sum + event.mouthOpenness, 0) / session.speechEvents.length || 0,
            lastSpeech: session.speechEvents[session.speechEvents.length - 1] || null
        };

        res.json({
            success: true,
            sessionId: sessionId,
            startTime: session.startTime,
            lastActivity: session.lastActivity,
            totalExpressions: session.expressions.length,
            mappedImageId: session.mappedImageId,
            speechStats: speechStats,
            expressions: session.expressions.slice(-5),
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

// Enhanced session end
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
        
        const speechPercentage = session.expressions.length > 0 
            ? (session.expressions.filter(e => e.isSpeaking).length / session.expressions.length * 100).toFixed(1)
            : 0;
            
        console.log(`📊 Session ${sessionId} ended: ${session.expressions.length} expressions, ${speechPercentage}% speaking`);
        
        res.json({
            success: true,
            sessionId: sessionId,
            totalExpressions: session.expressions.length,
            speechPercentage: speechPercentage,
            mappedImageId: session.mappedImageId,
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
        server: 'advanced-face-image-mapper',
        domain: SHORT_DOMAIN,
        activeSessions: Array.from(faceSessions.values()).filter(s => s.status === 'active').length,
        uploadedImages: uploadedImages.size,
        time: Date.now()
    });
});

// Enhanced server status
app.get('/status', (req, res) => {
    const activeSessions = Array.from(faceSessions.values()).filter(s => s.status === 'active').length;
    const totalSpeechEvents = Array.from(faceSessions.values()).reduce((sum, session) => sum + session.speechEvents.length, 0);
    
    res.json({
        status: '⚡ Advanced Face & Image Mapper Running',
        domain: SHORT_DOMAIN,
        activeSessions: activeSessions,
        totalSessions: faceSessions.size,
        uploadedImages: uploadedImages.size,
        totalSpeechEvents: totalSpeechEvents,
        render: IS_RENDER,
        serverUptime: Math.floor(process.uptime()),
        timestamp: Date.now()
    });
});

// Faster cleanup (every 5 minutes)
function cleanupInactiveSessions() {
    const now = Date.now();
    const inactiveThreshold = 15 * 60 * 1000;
    
    let cleaned = 0;
    for (const [sessionId, session] of faceSessions.entries()) {
        if (now - session.lastActivity > inactiveThreshold && session.status === 'active') {
            session.status = 'timeout';
            session.endTime = now;
            cleaned++;
        }
    }
    
    if (cleaned > 0) {
        console.log(`🧹 Cleaned ${cleaned} inactive sessions`);
    }
}

// Cleanup old uploaded images (older than 24 hours)
function cleanupOldImages() {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    
    let cleaned = 0;
    for (const [imageId, image] of uploadedImages.entries()) {
        if (now - image.uploadTime > maxAge) {
            const filePath = path.join(__dirname, 'uploads', image.filename);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            uploadedImages.delete(imageId);
            cleaned++;
        }
    }
    
    if (cleaned > 0) {
        console.log(`🧹 Cleaned ${cleaned} old uploaded images`);
    }
}

setInterval(cleanupInactiveSessions, 5 * 60 * 1000);
setInterval(cleanupOldImages, 60 * 60 * 1000); // Cleanup every hour

// ==================== SERVER STARTUP ====================

app.listen(PORT, '0.0.0.0', async () => {
    console.log(`⚡ Advanced Face & Image Mapper running on port ${PORT}`);
    console.log(`🌐 Domain: ${SHORT_DOMAIN}`);
    console.log(`🏠 Render: ${IS_RENDER}`);
    console.log(`🎭 Face Detection: Enhanced with Image Mapping`);
    console.log(`🖼️ Image Upload: Enabled with facial movement mapping`);
    
    // Create uploads directory if it doesn't exist
    if (!fs.existsSync('uploads')) {
        fs.mkdirSync('uploads');
    }
    
    initializeDropbox().then(() => {
        console.log('✅ Dropbox ready for enhanced sessions');
    });
    
    startAutoPing();
    
    console.log(`✅ Server initialized - FACE MAPPING & IMAGE UPLOAD READY`);
    console.log(`🔗 Access at: ${RENDER_DOMAIN}`);
});
