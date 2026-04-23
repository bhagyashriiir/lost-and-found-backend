// Import JSON Web Token library to handle user authentication and token verification
const jwt = require("jsonwebtoken");

// Middleware function to authenticate users before allowing access to protected routes
function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;  

    if (!authHeader || !authHeader.startsWith("Bearer ")) {  
      return res.status(401).json({ message: "Unauthorized" });
    }

    const token = authHeader.split(" ")[1];  // Extract token value from the Authorization header
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid or expired token" });  // Return error response if token is invalid or expired
  }
}

module.exports = authMiddleware;