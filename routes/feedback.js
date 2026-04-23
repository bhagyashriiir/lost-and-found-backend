/*
=============================================================
Project: Lost & Found Web Application
Module: CST3990 Undergraduate Individual Project
File Name: feedback.js

Author: Bhagyashri Roopesh
Student ID: M00975809
University: Middlesex University Dubai

Date Created: 20 March 2026
Last Modified: 23 April 2026

Description:
This route handles user feedback submission and retrieval.
It allows authenticated users to submit feedback messages
and enables the system to display feedback to other users.
It also triggers real-time updates when new feedback is added.

Version: 1.0

GitHub Repository:
https://github.com/bhagyashriiir/lost-and-found-backend

Modifications:
-------------------------------------------------------------
20/03/2026  Bhagyashri Roopesh   Implemented feedback submission
05/04/2026  Bhagyashri Roopesh   Added feedback retrieval API
18/04/2026  Bhagyashri Roopesh   Integrated real-time feedback updates
23/04/2026  Bhagyashri Roopesh   Final testing
=============================================================
*/

// Import required modules for routing, database connection and authentication
const express = require("express");
const { getDB } = require("../config/db");
const authMiddleware = require("../middleware/authMiddleware");

// Create router instance to handle feedback-related API requests
const router = express.Router();


// Route to retrieve all feedback messages from the database
router.get("/", async (req, res) => {
  try {
    const db = getDB();

    const feedbacks = await db  // Fetch feedback records sorted by newest first
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


// Route to allow logged-in users to submit feedback
router.post("/", authMiddleware, async (req, res) => {
  try {
    const db = getDB();

    const { message } = req.body;

    if (!message) {  // Validate that feedback message is provided before saving to database
      return res.status(400).json({
        message: "Feedback message required"
      });
    }

    const feedback = {  // Create feedback object containing user details and message
      userId: req.user.id,
      name: req.user.name,
      message,
      createdAt: new Date()
    };

    await db.collection("feedback").insertOne(feedback);  // Insert feedback record into MongoDB collection

// Emit real-time event to notify connected users that new feedback was submitted  
const io = req.app.get("io");
io.emit("feedbackCreated", {
  message: "New feedback submitted"
});

// Send success response after feedback is successfully stored
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