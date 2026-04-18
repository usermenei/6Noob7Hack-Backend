// api/index.js
const dotenv = require("dotenv");
dotenv.config({ path: "./config/config.env" });

const connectDB = require("../config/db");
const app = require("../app");

let isConnected = false;

module.exports = async (req, res) => {
  try {
    if (!isConnected) {
      await connectDB();
      isConnected = true;
      console.log("MongoDB connected");
    }

    return app(req, res);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "DB connection failed",
    });
  }
};