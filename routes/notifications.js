// Import required modules for handling notifications and database operations
const express = require("express");
const { ObjectId } = require("mongodb");

// Import database connection and authentication middleware
const { getDB } = require("../config/db");
const authMiddleware = require("../middleware/authMiddleware");

// Create router instance to manage notification-related API requests
const router = express.Router();

// Route to retrieve notifications for the logged-in user
router.get("/mine", authMiddleware, async (req, res) => {
  try {
    const db = getDB();

    const notifications = await db.collection("notifications").find({
      userId: new ObjectId(req.user.id)
    }).sort({ createdAt: -1 }).toArray();  

    res.json(notifications);
  } catch (error) {
    console.error("Get notifications error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Route to update notification status when a user views or reads it
router.patch("/:id/read", authMiddleware, async (req, res) => {
  try {
    const db = getDB();

    const result = await db.collection("notifications").updateOne(  // Update notification record to mark it as read
      {
        _id: new ObjectId(req.params.id),
        userId: new ObjectId(req.user.id)
      },
      { $set: { isRead: true } }
    );

    if (result.matchedCount === 0) {  // Check if notification exists before updating
  return res.status(404).json({
    message: "Notification not found"
  });
}

    res.json({ message: "Notification marked as read" });  // Send confirmation response after notification is successfully updated
  } catch (error) {
    console.error("Read notification error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;