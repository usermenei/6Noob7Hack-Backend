// api/index.js
const dotenv = require("dotenv");
dotenv.config({ path: "./config/config.env" });

const connectDB = require("../config/db");
const app = require("../app");

// Connect on every cold start before handling requests
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    res.status(500).json({ success: false, message: "DB connection failed" });
  }
});

module.exports = app; // export app, NOT app.listen()