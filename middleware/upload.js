// Import Multer middleware to handle file uploads
const multer = require("multer");

// Import path module to manage file paths and extensions
const path = require("path");

// Configure storage settings for uploaded images
const storage = multer.diskStorage({
  destination: (req, file, cb) => {  
    cb(null, "uploads/");
  },

  filename: (req, file, cb) => {  // Generate a unique filename using timestamp to prevent duplicate file names
    const uniqueName =
      Date.now() + "-" + file.originalname;
    cb(null, uniqueName);
  }
});

const fileFilter = (req, file, cb) => {  // Filter uploaded files to allow only image formats
  const allowedTypes = ["image/jpeg", "image/png", "image/jpg"];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Only images allowed"), false);
  }
};

// Initialize Multer middleware using storage and file validation settings
const upload = multer({
  storage,
  fileFilter
});

// Export upload middleware to be used in routes for handling image uploads
module.exports = upload;