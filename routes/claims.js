/*
=============================================================
Project: Lost & Found Web Application
Module: CST3990 Undergraduate Individual Project
File Name: claims.js

Author: Bhagyashri Roopesh
Student ID: M00975809
University: Middlesex University Dubai

Date Created: 05 March 2026
Last Modified: 23 April 2026

Description:
This route manages the claim process for lost items. It
verifies user responses to ownership questions, updates
report status to resolved and initiates secure messaging
between users after successful verification.

Version: 1.0

GitHub Repository:
https://github.com/bhagyashriiir/lost-and-found-backend

Modifications:
-------------------------------------------------------------
05/03/2026  Bhagyashri Roopesh   Created claim verification logic
15/03/2026  Bhagyashri Roopesh   Added report status update
10/04/2026  Bhagyashri Roopesh   Integrated secure chat creation
23/04/2026  Bhagyashri Roopesh   Final testing
=============================================================
*/

console.log("CLAIMS ROUTE LOADED");

// Import required modules for handling claims, database operations and authentication
const express = require("express");
const { ObjectId } = require("mongodb");

// Import database connection and authentication middleware
const { getDB } = require("../config/db");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

// Function to normalize text by converting to lowercase,
// removing special characters and trimming spaces
// This improves accuracy when comparing user verification answers
function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Used to compare keywords between expected and user-provided answers
function getTokens(value) {
  return normalizeText(value).split(" ").filter(Boolean);
}

// Function to compare expected verification answers with user input
function compareAnswer(expected, actual) {
  const expectedText = normalizeText(expected);
  const actualText = normalizeText(actual);

  if (!expectedText || !actualText) return false;
  if (expectedText === actualText) return true;

  const expectedTokens = getTokens(expectedText);
  const actualTokens = getTokens(actualText);

  if (!expectedTokens.length || !actualTokens.length) return false;

  const actualTokenSet = new Set(actualTokens);
  const commonCount = expectedTokens.filter((token) => actualTokenSet.has(token)).length;

  // pass if at least one strong keyword matches for short answers
  if (expectedTokens.length <= 2 && commonCount >= 1) {
    return true;
  }

  // pass if most of the expected words appear in the user's answer
  const coverage = commonCount / expectedTokens.length;
  return coverage >= 0.5;
}

// Function to retrieve verification questions from the report
function getVerificationChecks(report) {
  const checks = [];

  if (report?.verificationQuestion1?.trim()) {
    checks.push({
      label: "verification detail 1",
      expected: report.verificationQuestion1.trim()
    });
  }

  if (report?.verificationQuestion2?.trim()) {
    checks.push({
      label: "verification detail 2",
      expected: report.verificationQuestion2.trim()
    });
  }

  return checks;
}

// Route to submit a claim for a lost or found item
router.post("/", authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { reportId, answer1, answer2 } = req.body;

    if (!reportId || !ObjectId.isValid(reportId)) {
      return res.status(400).json({ message: "Invalid report selected" });
    }

    const report = await db.collection("reports").findOne({
      _id: new ObjectId(reportId)
    });

    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }

    if (report.ownerUserId === req.user.id) {  // Prevent users from claiming their own reported items
      return res.status(400).json({ message: "You cannot claim your own item" });
    }

    if (report.status === "Resolved") {  // Check if the item has already been resolved
      return res.status(400).json({ message: "This item is already closed" });
    }

    const verificationChecks = getVerificationChecks(report);

    if (!verificationChecks.length) {
      return res.status(400).json({
        message: "This item does not have verification details set up yet"
      });
    }

    const providedAnswers = [String(answer1 || "").trim(), String(answer2 || "").trim()];

    if (!providedAnswers[0] || (verificationChecks[1] && !providedAnswers[1])) {
      return res.status(400).json({
        message: verificationChecks[1]
          ? "Please answer both verification questions"
          : "Please answer the verification question"
      });
    }

    const verificationResults = verificationChecks.map((check, index) => ({
      label: check.label,
      matched: compareAnswer(check.expected, providedAnswers[index] || "")
    }));

    const isVerified = verificationResults.every((result) => result.matched);

    // Create a new claim record in the database
    const claim = {
      reportId,
      ownerUserId: report.ownerUserId,
      claimedByUserId: req.user.id,
      answer1: providedAnswers[0],
      answer2: providedAnswers[1] || "",
      status: "Pending",
      verificationResults,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection("claims").insertOne(claim);

    const io = req.app.get("io");

// notify the item owner
const ownerUserId = report.ownerUserId;

console.log("CLAIM NOTIFICATION SENT TO:", ownerUserId);

// Send notification to item owner when a claim is submitted
await db.collection("notifications").insertOne({
  userId: ownerUserId,
  type: "claim",
  message: "Someone has submitted a claim for your item",
  reportId: report._id.toString(),
  isRead: false,
  createdAt: new Date()
});

// Emit real-time notification using Socket.IO
io.to(`user:${ownerUserId}`).emit(
  "newNotification",
  {
    type: "claim",
    text: "Someone has submitted a claim for your item",
    reportId: report._id.toString()
  }
);

    if (!isVerified) {  // Notify claimant if verification answers do not match
      await db.collection("notifications").insertOne({
        userId: req.user.id,
        type: "claim",
        message: `Claim rejected for ${report.itemName}. Verification answers did not match.`,
        relatedClaimId: result.insertedId.toString(),
        isRead: false,
        createdAt: new Date()
      });

      io.to(`user:${req.user.id}`).emit(
        "newNotification",
        {
          type: "claim",
          text: `Claim rejected for ${report.itemName}. Verification answers did not match.`,
          reportId: report._id.toString()
        }
      );

      return res.status(400).json({
        message: "Verification failed. The item stays open in the feed.",
        verified: false
      });
    }

    await db.collection("reports").updateOne(  // Update item status to resolved after successful claim verification
  { _id: new ObjectId(reportId) },
  {
    $set: {
      status: "Resolved",
      claimStatus: "Approved",
      updatedAt: new Date()
    }
  }
);

    // Create secure chat between item owner and claimant
    let existingChat = await db.collection("messages").findOne({
      type: "chat",   // ✅ ADD THIS
      reportId,
      ownerUserId: report.ownerUserId,
      claimantUserId: req.user.id
    });

if (!existingChat) {
  const chatResult = await db.collection("messages").insertOne({
    type: "chat",
    reportId,
    ownerUserId: report.ownerUserId,
    claimantUserId: req.user.id,
    claimId: result.insertedId.toString(),
    contactUnlocked: true,  // Unlock contact details after claim approval
    lastMessage: "",
    lastMessageAt: null,
    createdAt: new Date(),
    updatedAt: new Date()
  });

  existingChat = await db.collection("messages").findOne({ _id: chatResult.insertedId });
} else {
  await db.collection("messages").updateOne(
    { _id: existingChat._id },
    {
      $set: {
        claimId: result.insertedId.toString(),
        contactUnlocked: true,
        updatedAt: new Date()
      }
    }
  );
}
    
    // Notify claimant that the claim has been successfully verified
    await db.collection("notifications").insertOne({
      userId: req.user.id,
      type: "claim",
      message: `Claim verified for ${report.itemName}. The item is now closed.`,
      relatedClaimId: result.insertedId.toString(),
      isRead: false,
      createdAt: new Date()
    });

    io.to(`user:${req.user.id}`).emit(
      "newNotification",
      {
        type: "claim",
        text: `Claim verified for ${report.itemName}. The item is now closed.`,
        reportId: report._id.toString()
      }
    );

    res.status(201).json({
      message: "Claim verified successfully. The item is now closed.",
      verified: true
    });
  } catch (error) {
    console.error("Create claim error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Route to retrieve pending claims for the item owner
router.get("/pending", authMiddleware, async (req, res) => {
  try {
    const db = getDB();

    const claims = await db
      .collection("claims")
      .find({
        ownerUserId: req.user.id,
        status: "Pending"
      })
      .sort({ createdAt: -1 })
      .toArray();

    res.json(claims);

  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Failed to fetch claims"
    });
  }
});

router.get("/mine", authMiddleware, async (req, res) => {
  try {
    const db = getDB();

    const claims = await db.collection("claims").find({
      ownerUserId: req.user.id
    }).sort({ createdAt: -1 }).toArray();

    res.json(claims);
  } catch (error) {
    console.error("Get claims error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Route to approve or reject a claim submitted by another user
router.patch("/:id/decision", authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { decision } = req.body;
    const claimId = req.params.id;

    const claim = await db.collection("claims").findOne({
      _id: new ObjectId(claimId)
    });

    if (!claim) {
      return res.status(404).json({ message: "Claim not found" });
    }

    if (claim.ownerUserId !== req.user.id) {
      return res.status(403).json({ message: "Not allowed" });
    }

    const nextStatus = decision === "approve" ? "Approved" : "Rejected";  // Determine claim status based on owner's decision

    await db.collection("claims").updateOne(
      { _id: new ObjectId(claimId) },
      { $set: { status: nextStatus, updatedAt: new Date() } }
    );

    if (decision === "approve") {
  await db.collection("reports").updateOne(
    { _id: new ObjectId(claim.reportId) },
    {
      $set: {
        status: "Resolved",
        claimStatus: "Approved",
        updatedAt: new Date()
      }
    }
  );

  const existingChat = await db.collection("messages").findOne({
    type: "chat",
    reportId: claim.reportId,
    ownerUserId: claim.ownerUserId,
    claimantUserId: claim.claimedByUserId
  });

  if (!existingChat) {
    await db.collection("messages").insertOne({
      reportId: claim.reportId,
      type: "chat", 
      ownerUserId: claim.ownerUserId,
      claimantUserId: claim.claimedByUserId,
      claimId: claim._id.toString(),
      contactUnlocked: true,
      lastMessage: "",
      lastMessageAt: null,
      createdAt: new Date(),
      updatedAt: new Date()
    });
  } else {
    await db.collection("messages").updateOne(
      { _id: existingChat._id },
      {
        $set: {
          claimId: claim._id.toString(),
          contactUnlocked: true,
          updatedAt: new Date()
        }
      }
    );
  }
}

    await db.collection("notifications").insertOne({
      userId: claim.claimedByUserId,
      type: "claim-response",
      message: `Your claim was ${nextStatus.toLowerCase()}`,
      relatedClaimId: claimId,
      isRead: false,
      createdAt: new Date()
    });

    const io = req.app.get("io");

io.to(`user:${claim.claimedByUserId}`).emit(
  "newNotification",
  {
    type: "claim-response",
    text: `Your claim was ${nextStatus.toLowerCase()}`,
    relatedClaimId: claimId
  }
);

    res.json({ message: `Claim ${nextStatus.toLowerCase()} successfully` });
  } catch (error) {
    console.error("Claim decision error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
