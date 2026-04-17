// server.js — correct order
const dotenv = require("dotenv");
dotenv.config({ path: "./config/config.env" }); // ← MUST be first

const { setServers } = require("node:dns/promises");
setServers(["1.1.1.1", "8.8.8.8"]);

const connectDB = require("./config/db");
const app = require("./app");

const PORT = process.env.PORT || 5000;
let server;

// =====================================================
// Connect DB then start server
// =====================================================
connectDB()
  .then(() => {
    server = app.listen(PORT, () =>
      console.log(
        `🚀 Server running in ${process.env.NODE_ENV} mode on port ${PORT}`
      )
    );
  })
  .catch((err) => {
    console.error("❌ Database connection failed:", err.message);
    process.exit(1);
  });

// =====================================================
// Handle unhandled promise rejections
// =====================================================
process.on("unhandledRejection", (err) => {
  console.log(`❌ Error: ${err.message}`);

  if (server) {
    server.close(() => process.exit(1));
  } else {
    process.exit(1);
  }
});