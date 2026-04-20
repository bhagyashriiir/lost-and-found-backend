console.log("CLAIMS ROUTE LOADED");

const express = require("express");
const { ObjectId } = require("mongodb");

const { getDB } = require("../config/db");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getTokens(value) {
  return normalizeText(value).split(" ").filter(Boolean);
}

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

    if (report.ownerUserId === req.user.id) {
      return res.status(400).json({ message: "You cannot claim your own item" });
    }

    if (report.status === "Resolved") {
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

await db.collection("notifications").insertOne({
  userId: ownerUserId,
  type: "claim",
  message: "Someone has submitted a claim for your item",
  reportId: report._id.toString(),
  isRead: false,
  createdAt: new Date()
});

io.to(`user:${ownerUserId}`).emit(
  "newNotification",
  {
    type: "claim",
    text: "Someone has submitted a claim for your item",
    reportId: report._id.toString()
  }
);

    if (!isVerified) {
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

    await db.collection("reports").updateOne(
  { _id: new ObjectId(reportId) },
  {
    $set: {
      status: "Resolved",
      claimStatus: "Approved",
      updatedAt: new Date()
    }
  }
);


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
    contactUnlocked: true,
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

    const nextStatus = decision === "approve" ? "Approved" : "Rejected";

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
