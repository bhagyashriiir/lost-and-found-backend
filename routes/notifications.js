const express = require("express");
const { ObjectId } = require("mongodb");

const { getDB } = require("../config/db");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/mine", authMiddleware, async (req, res) => {
  try {
    const db = getDB();

    const notifications = await db.collection("notifications").find({
      userId: new ObjectId(req.user.id)
    }).sort({ createdAt: -1 }).toArray();  //improved notification sorting logic

    res.json(notifications);
  } catch (error) {
    console.error("Get notifications error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.patch("/:id/read", authMiddleware, async (req, res) => {
  try {
    const db = getDB();

    const result = await db.collection("notifications").updateOne(
      {
        _id: new ObjectId(req.params.id),
        userId: new ObjectId(req.user.id)
      },
      { $set: { isRead: true } }
    );

    if (result.matchedCount === 0) {
  return res.status(404).json({
    message: "Notification not found"
  });
}

    res.json({ message: "Notification marked as read" });
  } catch (error) {
    console.error("Read notification error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;