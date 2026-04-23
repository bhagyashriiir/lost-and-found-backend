// Load environment variables from .env file for secure configuration
require("dotenv").config();

// Import required modules to build backend server and enable real-time communication
const express = require("express");
const cors = require("cors");
const http = require("http");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");

// Import database connection and API route modules
const { connectDB } = require("./config/db");
const authRoutes = require("./routes/auth");
const reportRoutes = require("./routes/report");
const claimRoutes = require("./routes/claims");
const messageRoutes = require("./routes/messages");
const notificationRoutes = require("./routes/notifications");
const path = require("path");

// Create Express application and HTTP server instance
const app = express();
const server = http.createServer(app);

// Initialize Socket.IO server to enable real-time messaging and notifications
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Enable Cross-Origin Resource Sharing to allow frontend communication
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Log incoming API requests for monitoring and debugging purposes
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Serve uploaded image files from the uploads directory
app.use(
  "/uploads",
  express.static(path.join(__dirname, "uploads"))
);

// Store Socket.IO instance in Express app for use in other routes
app.set("io", io);

// Register API routes for different system modules
app.use("/api/auth", authRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/claims", claimRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/feedback", require("./routes/feedback"));

app.get("/", (req, res) => {
  res.send("Lost & Found API running");
});

// Health check endpoint to verify server status
app.get("/api/health", (req, res) => {
  res.json({
    status: "healthy"
  });
});

// Authenticate users before allowing Socket.IO connection
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error("Unauthorized"));
    }

    // Verify JWT token to ensure secure real-time communication
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = decoded;
    next();
  } catch (error) {
    next(new Error("Invalid token"));
  }
});

// Handle new user connection to real-time server
io.on("connection", (socket) => {
  const userId = socket.user.id;
  socket.join(`user:${userId}`);

  // Join chat room to receive real-time messages
  socket.on("join-chat", (chatId) => {
    if (!chatId) return;
    socket.join(`chat:${chatId}`);
  });

  socket.on("leave-chat", (chatId) => {
    if (!chatId) return;
    socket.leave(`chat:${chatId}`);
  });

  socket.on("disconnect", () => {
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

const fs = require("fs");

const uploadsDir = path.join(__dirname, "uploads");

// Ensure uploads directory exists before storing files
fs.mkdirSync(uploadsDir, { recursive: true });

// Start server after successful database connection
async function startServer() {
  try {
    await connectDB();
    server.listen(PORT, () => {  // Start listening for incoming requests on defined port
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
  }
}

app.get("/debug/uploads", (req, res) => {
  const fs = require("fs");
  const files = fs.readdirSync(uploadsDir);
  res.json(files);
});

// Handle requests to undefined routes and return error response
app.use((req, res) => {
  res.status(404).json({
    message: "Route not found"
  });
});

startServer();