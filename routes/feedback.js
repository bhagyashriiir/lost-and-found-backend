const express = require("express");
const { getDB } = require("../config/db");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();


// GET all feedback (everyone can see)
router.get("/", async (req, res) => {
  try {
    const db = getDB();

    const feedbacks = await db
      .collection("feedback")
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    res.json(feedbacks);

  } catch (error) {
    res.status(500).json({
      message: "Failed to load feedback"
    });
  }
});


// POST feedback (logged-in users only)
router.post("/", authMiddleware, async (req, res) => {
  try {
    const db = getDB();

    const { message } = req.body;

    if (!message) {
      return res.status(400).json({
        message: "Feedback message required"
      });
    }

    const feedback = {
      userId: req.user.id,
      name: req.user.name,
      message,
      createdAt: new Date()
    };

    await db.collection("feedback").insertOne(feedback);

// ADD THESE 3 LINES
const io = req.app.get("io");
io.emit("feedbackCreated", {
  message: "New feedback submitted"
});

res.status(201).json({
  message: "Feedback submitted"
});

  } catch (error) {
    res.status(500).json({
      message: "Failed to submit feedback"
    });
  }
});

module.exports = router;