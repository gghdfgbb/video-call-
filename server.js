const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { Dropbox } = require('dropbox');
const multer = require('multer');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

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
    if (!IS_RENDER) return 'face-animator-local';
    
    let domain = RENDER_DOMAIN.replace(/^https?:\/\//, '');
    domain = domain.replace(/\.render\.com$/, '');
    domain = domain.replace(/\.onrender\.com$/, '');
    domain = domain.split('.')[0];
    
    return domain || 'face-animator';
}

const SHORT_DOMAIN = getShortDomainName();
console.log(`🎭 Advanced Face Animator Domain: ${SHORT_DOMAIN}`);

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
app.use('/generated', express.static('generated'));

// Configure multer for image uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = 'uploads';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
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
        fileSize: 20 * 1024 * 1024 // 20MB limit
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

// Create necessary directories
const directories = ['uploads', 'generated', 'temp'];
directories.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Global variables
let dbx = null;
let isDropboxInitialized = false;

// Face animation session storage
let faceSessions = new Map();
let sessionCounter = 1;
let uploadedImages = new Map();
let animationSessions = new Map();

// ==================== FACE ANIMATION ENGINE ====================

class FaceAnimationEngine {
    constructor() {
        this.animations = new Map();
        this.frameCounter = 0;
    }

    // Generate transformation data for face reenactment
    generateFaceTransform(sourceLandmarks, targetLandmarks) {
        if (!sourceLandmarks || !targetLandmarks) {
            return this.getDefaultTransform();
        }

        try {
            // Calculate head rotation
            const headRotation = this.calculateHeadRotation(sourceLandmarks);
            
            // Calculate mouth movement
            const mouthMovement = this.calculateMouthMovement(sourceLandmarks);
            
            // Calculate eye movements
            const eyeMovements = this.calculateEyeMovements(sourceLandmarks);
            
            // Calculate facial expression
            const expression = this.calculateFacialExpression(sourceLandmarks);
            
            return {
                head: {
                    rotationX: headRotation.x,
                    rotationY: headRotation.y,
                    rotationZ: headRotation.z,
                    positionX: headRotation.positionX || 0,
                    positionY: headRotation.positionY || 0
                },
                mouth: {
                    openness: mouthMovement.openness,
                    smile: mouthMovement.smile,
                    shape: mouthMovement.shape
                },
                eyes: {
                    left: {
                        openness: eyeMovements.left.openness,
                        positionX: eyeMovements.left.positionX,
                        positionY: eyeMovements.left.positionY
                    },
                    right: {
                        openness: eyeMovements.right.openness,
                        positionX: eyeMovements.right.positionX,
                        positionY: eyeMovements.right.positionY
                    },
                    blink: eyeMovements.blink
                },
                expression: expression,
                timestamp: Date.now(),
                frameId: this.frameCounter++
            };
        } catch (error) {
            console.error('Error generating face transform:', error);
            return this.getDefaultTransform();
        }
    }

    calculateHeadRotation(landmarks) {
        // Simplified head rotation calculation based on key facial points
        const nose = landmarks[1] || [0, 0, 0];
        const leftEye = landmarks[33] || [0, 0, 0];
        const rightEye = landmarks[263] || [0, 0, 0];
        const chin = landmarks[152] || [0, 0, 0];
        
        // Calculate rotation angles (simplified)
        const eyeCenterX = (leftEye[0] + rightEye[0]) / 2;
        const rotationY = (nose[0] - eyeCenterX) * 2; // Horizontal rotation
        const rotationX = (nose[1] - chin[1]) * 0.5; // Vertical rotation
        
        return {
            x: Math.max(-15, Math.min(15, rotationX)),
            y: Math.max(-20, Math.min(20, rotationY)),
            z: 0,
            positionX: rotationY * 0.5,
            positionY: rotationX * 0.3
        };
    }

    calculateMouthMovement(landmarks) {
        const mouthTop = landmarks[13] || [0, 0, 0];
        const mouthBottom = landmarks[14] || [0, 0, 0];
        const mouthLeft = landmarks[61] || [0, 0, 0];
        const mouthRight = landmarks[291] || [0, 0, 0];
        
        const mouthHeight = Math.abs(mouthBottom[1] - mouthTop[1]);
        const mouthWidth = Math.abs(mouthRight[0] - mouthLeft[0]);
        
        // Calculate mouth openness (normalized)
        const openness = Math.min(1, mouthHeight / (mouthWidth * 0.8));
        
        // Calculate smile intensity
        const smileLeft = landmarks[61] && landmarks[91] ? Math.abs(landmarks[61][1] - landmarks[91][1]) : 0;
        const smileRight = landmarks[291] && landmarks[321] ? Math.abs(landmarks[291][1] - landmarks[321][1]) : 0;
        const smile = Math.min(1, (smileLeft + smileRight) / 20);
        
        return {
            openness: Math.max(0, Math.min(1, openness)),
            smile: Math.max(0, Math.min(1, smile)),
            shape: openness > 0.3 ? 'open' : smile > 0.4 ? 'smile' : 'neutral'
        };
    }

    calculateEyeMovements(landmarks) {
        // Left eye points
        const leftEyeTop = landmarks[159] || [0, 0, 0];
        const leftEyeBottom = landmarks[145] || [0, 0, 0];
        const leftEyeLeft = landmarks[33] || [0, 0, 0];
        const leftEyeRight = landmarks[133] || [0, 0, 0];
        
        // Right eye points
        const rightEyeTop = landmarks[386] || [0, 0, 0];
        const rightEyeBottom = landmarks[374] || [0, 0, 0];
        const rightEyeLeft = landmarks[362] || [0, 0, 0];
        const rightEyeRight = landmarks[263] || [0, 0, 0];
        
        // Calculate eye openness
        const leftOpenness = Math.abs(leftEyeBottom[1] - leftEyeTop[1]);
        const rightOpenness = Math.abs(rightEyeBottom[1] - rightEyeTop[1]);
        
        // Calculate eye positions
        const leftPositionX = ((leftEyeLeft[0] + leftEyeRight[0]) / 2) - leftEyeLeft[0];
        const leftPositionY = ((leftEyeTop[1] + leftEyeBottom[1]) / 2) - leftEyeTop[1];
        
        const rightPositionX = ((rightEyeLeft[0] + rightEyeRight[0]) / 2) - rightEyeLeft[0];
        const rightPositionY = ((rightEyeTop[1] + rightEyeBottom[1]) / 2) - rightEyeTop[1];
        
        // Detect blink
        const blink = (leftOpenness < 2 && rightOpenness < 2) ? true : false;
        
        return {
            left: {
                openness: Math.max(0, Math.min(1, leftOpenness / 10)),
                positionX: Math.max(-1, Math.min(1, leftPositionX * 2)),
                positionY: Math.max(-1, Math.min(1, leftPositionY * 2))
            },
            right: {
                openness: Math.max(0, Math.min(1, rightOpenness / 10)),
                positionX: Math.max(-1, Math.min(1, rightPositionX * 2)),
                positionY: Math.max(-1, Math.min(1, rightPositionY * 2))
            },
            blink: blink
        };
    }

    calculateFacialExpression(landmarks) {
        const mouthMovement = this.calculateMouthMovement(landmarks);
        const eyeMovements = this.calculateEyeMovements(landmarks);
        
        if (mouthMovement.openness > 0.6) {
            return 'surprised';
        } else if (mouthMovement.smile > 0.5) {
            return 'happy';
        } else if (mouthMovement.smile < 0.2 && eyeMovements.blink) {
            return 'neutral';
        } else if (mouthMovement.openness < 0.1) {
            return 'neutral';
        } else {
            return 'talking';
        }
    }

    getDefaultTransform() {
        return {
            head: { rotationX: 0, rotationY: 0, rotationZ: 0, positionX: 0, positionY: 0 },
            mouth: { openness: 0, smile: 0, shape: 'neutral' },
            eyes: {
                left: { openness: 1, positionX: 0, positionY: 0 },
                right: { openness: 1, positionX: 0, positionY: 0 },
                blink: false
            },
            expression: 'neutral',
            timestamp: Date.now(),
            frameId: this.frameCounter++
        };
    }

    // Generate CSS transform for the animated image
    generateCSSTransform(transformData) {
        const head = transformData.head;
        
        return {
            transform: `
                translate(${head.positionX}px, ${head.positionY}px)
                rotateX(${head.rotationX}deg)
                rotateY(${head.rotationY}deg)
                rotateZ(${head.rotationZ}deg)
            `,
            filter: `
                brightness(${transformData.expression === 'happy' ? '1.1' : '1'})
                contrast(${transformData.expression === 'surprised' ? '1.05' : '1'})
            `,
            clipPath: this.generateMouthClipPath(transformData.mouth)
        };
    }

    generateMouthClipPath(mouthData) {
        if (mouthData.openness < 0.1) {
            return 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)';
        }
        
        const openness = mouthData.openness * 30;
        const smile = mouthData.smile * 10;
        
        return `
            polygon(
                0% 0%, 100% 0%, 100% 100%, 0% 100%,
                40% ${70 - openness + smile}%,
                60% ${70 - openness - smile}%,
                40% ${70 - openness + smile}%
            )
        `;
    }
}

// Initialize face animation engine
const animationEngine = new FaceAnimationEngine();

// ==================== SOCKET.IO FOR REAL-TIME ANIMATION ====================

io.on('connection', (socket) => {
    console.log(`🔗 Client connected: ${socket.id}`);
    
    socket.on('start-animation', (data) => {
        const { sessionId, imageId } = data;
        animationSessions.set(socket.id, { sessionId, imageId });
        console.log(`🎬 Animation started for session: ${sessionId}`);
    });
    
    socket.on('face-landmarks', (data) => {
        const session = animationSessions.get(socket.id);
        if (session) {
            // Process face landmarks and generate animation data
            const transformData = animationEngine.generateFaceTransform(data.landmarks);
            const cssTransform = animationEngine.generateCSSTransform(transformData);
            
            // Send animation data back to client
            socket.emit('animation-update', {
                transform: cssTransform,
                expression: transformData.expression,
                timestamp: Date.now()
            });
            
            // Broadcast to other clients in the same session if needed
            socket.to(session.sessionId).emit('animation-update', {
                transform: cssTransform,
                expression: transformData.expression,
                timestamp: Date.now()
            });
        }
    });
    
    socket.on('stop-animation', () => {
        animationSessions.delete(socket.id);
        console.log(`🛑 Animation stopped for: ${socket.id}`);
    });
    
    socket.on('disconnect', () => {
        animationSessions.delete(socket.id);
        console.log(`🔌 Client disconnected: ${socket.id}`);
    });
});

// ==================== ROUTES ====================

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

// Start animation session
app.post('/start-animation-session', (req, res) => {
    try {
        const { imageId } = req.body;
        const sessionId = `anim_${String(sessionCounter++).padStart(3, '0')}`;
        
        const sessionData = {
            sessionId: sessionId,
            startTime: Date.now(),
            lastActivity: Date.now(),
            imageId: imageId,
            status: 'animating',
            transforms: []
        };
        
        faceSessions.set(sessionId, sessionData);
        
        console.log(`🎬 Animation session started: ${sessionId} with image ${imageId}`);
        
        res.json({
            success: true,
            sessionId: sessionId,
            imageId: imageId,
            message: 'Face animation session started',
            timestamp: sessionData.startTime
        });
        
    } catch (error) {
        console.error('Animation session start error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get animation data
app.post('/generate-animation', (req, res) => {
    try {
        const { landmarks, imageId } = req.body;
        
        if (!landmarks) {
            return res.status(400).json({
                success: false,
                error: 'Face landmarks are required'
            });
        }

        const transformData = animationEngine.generateFaceTransform(landmarks);
        const cssTransform = animationEngine.generateCSSTransform(transformData);
        
        res.json({
            success: true,
            transform: cssTransform,
            expression: transformData.expression,
            detailedData: transformData,
            timestamp: Date.now()
        });
        
    } catch (error) {
        console.error('Animation generation error:', error);
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

// Ping endpoint
app.get('/ping', (req, res) => {
    res.json({
        status: 'pong',
        server: 'advanced-face-animator',
        domain: SHORT_DOMAIN,
        activeSessions: Array.from(faceSessions.values()).filter(s => s.status === 'animating').length,
        activeConnections: io.engine.clientsCount,
        uploadedImages: uploadedImages.size,
        time: Date.now()
    });
});

// Server status
app.get('/status', (req, res) => {
    const activeSessions = Array.from(faceSessions.values()).filter(s => s.status === 'animating').length;
    
    res.json({
        status: '🎭 Advanced Face Animator Running',
        domain: SHORT_DOMAIN,
        activeSessions: activeSessions,
        activeConnections: io.engine.clientsCount,
        uploadedImages: uploadedImages.size,
        render: IS_RENDER,
        serverUptime: Math.floor(process.uptime()),
        features: [
            'Real-time Face Reenactment',
            'Image Animation',
            'Live Expression Transfer',
            'WebSocket Streaming'
        ],
        timestamp: Date.now()
    });
});

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

// ==================== SERVER STARTUP ====================

server.listen(PORT, '0.0.0.0', async () => {
    console.log(`🎭 Advanced Face Animator running on port ${PORT}`);
    console.log(`🌐 Domain: ${SHORT_DOMAIN}`);
    console.log(`🏠 Render: ${IS_RENDER}`);
    console.log(`🔗 WebSocket: Enabled for real-time animation`);
    console.log(`🎬 Face Reenactment: ACTIVE`);
    console.log(`🖼️ Image Animation: READY`);
    
    startAutoPing();
    
    console.log(`✅ Server initialized - FACE REENACTMENT SYSTEM READY`);
    console.log(`🔗 Access at: ${RENDER_DOMAIN}`);
});

module.exports = app;
