const multer = require("multer");
const path = require("path");
const express = require("express");
const { ObjectId } = require("mongodb");

const { getDB } = require("../config/db");
const authMiddleware = require("../middleware/authMiddleware");

// Import intelligent matching functions for category detection,
// duplicate detection and possible match suggestions
const {
  detectCategory,
  findPossibleMatches,
  isDuplicate
} = require("../utils/matching");

const router = express.Router();

// Normalize venue type input to maintain consistent values
function normalizeVenueType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized.includes("mall")) return "Mall";
  if (normalized.includes("metro")) return "Metro station";
  if (normalized.includes("airport")) return "Airport";
  return value || "";
}

// Configure storage settings for uploaded report images
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },

  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  }
});

const upload = multer({ storage });

// Route to retrieve all open reports with optional filtering
router.get("/", async (req, res) => {
  try {
    const db = getDB();
    const { venueType, category, location, cityArea, q } = req.query;

    const filter = { status: "Open" };  

    if (venueType) filter.venueType = normalizeVenueType(venueType);
    if (category) filter.category = category;
    if (location) filter.location = { $regex: location, $options: "i" };
    if (cityArea) filter.cityArea = { $regex: cityArea, $options: "i" };

    if (q) {
      filter.$or = [
        { itemName: { $regex: q, $options: "i" } },
        { description: { $regex: q, $options: "i" } },
        { category: { $regex: q, $options: "i" } }
      ];
    }

    const reports = await db
      .collection("reports")
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();

    res.json(reports);
  } catch (error) {
    console.error("Get reports error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Route to retrieve reports created by the logged-in user
router.get("/mine", authMiddleware, async (req, res) => {
  try {
    const db = getDB();   

    const reports = await db
      .collection("reports")
      .find({ ownerUserId: req.user.id })
      .sort({ createdAt: -1 })
      .toArray();

    res.json(reports);

  } catch (err) {
    console.error("Fetch my reports error:", err);

    res.status(500).json({
      message: "Failed to fetch reports"
    });
  }
});

// Route to submit a new lost or found report
router.post(
  "/",
  authMiddleware,
  upload.single("image"),
  async (req, res) => {
    try {

      const db = getDB();

      const {
        type,
        userName,
        email,
        phone,
        itemName,
        category,
        location,
        venueType,
        cityArea,
        date,
        time,
        description,
        verificationQuestion1,
        verificationQuestion2
      } = req.body;

      // Automatically determine item category using intelligent keyword detection
      const autoCategory = detectCategory(
        itemName,
        description,
        category
      );

      // Store image path if file was uploaded
      const imagePath = req.file
        ? `/uploads/${req.file.filename}`
        : null;

        // Create report object containing item details and verification questions
      const baseReport = {
        type,
        userName,
        email,
        phone,
        itemName,
        category: autoCategory,
        location,
        venueType: normalizeVenueType(venueType),
        cityArea,
        date,
        time,
        description,
        verificationQuestion1,
        verificationQuestion2,
        image: imagePath,
        status: "Open",
        ownerUserId: req.user.id,
        createdAt: new Date()
      };

      const existingReports = await db
        .collection("reports")
        .find({})
        .toArray();

        // Check if the new report is a duplicate of an existing report
      baseReport.duplicateFlag = isDuplicate(
        baseReport,
        existingReports
      );

      // Find possible matching reports based on similarity scoring
      const possibleMatches = findPossibleMatches(
        baseReport,
        existingReports
      );

      baseReport.possibleMatches = possibleMatches;

      // Insert new report into database collection
      const result = await db
        .collection("reports")
        .insertOne(baseReport);

        // Emit real-time event to notify users about new report creation
      const io = req.app.get("io");

      io.emit("reportCreated", {
        message: "New report created"
      });

      res.status(201).json({
        message: baseReport.duplicateFlag
          ? "Report submitted, but a possible duplicate was detected"
          : "Report submitted successfully",
        reportId: result.insertedId,
        autoCategory,
        possibleMatches
      });

    } catch (error) {

      console.error("Create report error:", error);

      res.status(500).json({
        message: "Server error"
      });

    }
  }
);

// Route to update report status (e.g., mark item as resolved)
router.patch("/:id/status", authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { status } = req.body;
    const reportId = req.params.id;

    const report = await db.collection("reports").findOne({
      _id: new ObjectId(reportId)
    });

    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }

    if (report.ownerUserId !== req.user.id) {  // Ensure only the report owner can update the report status
      return res.status(403).json({ message: "Not allowed" });
    }

    await db.collection("reports").updateOne(  // Update report status in database
      { _id: new ObjectId(reportId) },
      {
        $set: {
          status,
          updatedAt: new Date()
        }
      }
    );

    res.json({ message: "Status updated successfully" });
  } catch (error) {
    console.error("Update status error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/all", async (req, res) => {
  const db = getDB();

  const reports = await db
    .collection("reports")
    .find({})
    .toArray();

  res.json(reports);
});

module.exports = router;