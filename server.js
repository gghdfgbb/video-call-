const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
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

// Create uploads directory
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads', { recursive: true });
}

// Store active sessions
let activeSessions = new Map();

// Socket.io for real-time communication
io.on('connection', (socket) => {
  console.log(`🔗 Client connected: ${socket.id}`);
  
  socket.on('start-animation', (data) => {
    activeSessions.set(socket.id, data);
    console.log(`🎬 Animation started: ${socket.id}`);
  });
  
  socket.on('face-movement', (data) => {
    // Broadcast movement data to other clients if needed
    socket.broadcast.emit('face-update', data);
  });
  
  socket.on('disconnect', () => {
    activeSessions.delete(socket.id);
    console.log(`🔌 Client disconnected: ${socket.id}`);
  });
});

// Routes
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

    const imageData = {
      filename: req.file.filename,
      originalName: req.file.originalname,
      url: `/uploads/${req.file.filename}`,
      uploadTime: Date.now()
    };

    console.log(`🖼️ Image uploaded: ${imageData.originalName}`);
    
    res.json({
      success: true,
      imageUrl: imageData.url,
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

// Get server status
app.get('/status', (req, res) => {
  res.json({
    status: '🎭 Face Puppet Animator Running',
    activeSessions: activeSessions.size,
    timestamp: Date.now()
  });
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🎭 Face Puppet Animator running on port ${PORT}`);
  console.log(`🔗 WebSocket: Enabled for real-time animation`);
  console.log(`🖼️ Image Upload: Ready`);
  console.log(`⚡ Access at: http://localhost:${PORT}`);
});
