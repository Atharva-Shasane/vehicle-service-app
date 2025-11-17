const express = require("express");
const fs = require("fs").promises; // Use promises for async/await
const path = require("path");
const cors = require("cors");
const jwt = require("jsonwebtoken");
// const bcrypt = require('bcryptjs'); // --- NO LONGER NEEDED ---
const { randomUUID } = require("crypto");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const DB_PATH = path.join(__dirname, "db.json");

// --- MIDDLEWARE SETUP ---
app.use(cors()); // Enable Cross-Origin Resource Sharing
app.use(express.json()); // Parse incoming JSON payloads
app.use(express.static(path.join(__dirname, "public"))); // Serve static files from 'public'

// --- DB HELPER FUNCTIONS ---

/**
 * Reads the entire JSON database file.
 * @returns {Promise<object>} The parsed database object.
 */
async function readDB() {
  try {
    const data = await fs.readFile(DB_PATH, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Error reading database:", error);
    throw new Error("Could not read from database.");
  }
}

/**
 * Writes an object back to the JSON database file.
 * @param {object} data - The complete database object to write.
 * @returns {Promise<void>}
 */
async function writeDB(data) {
  try {
    await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2), "utf-8");
  } catch (error) {
    console.error("Error writing to database:", error);
    throw new Error("Could not write to database.");
  }
}

// --- AUTHENTICATION & RBAC MIDDLEWARE ---

/**
 * Middleware to verify the JWT token.
 * Attaches user payload to req.user if valid.
 */
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res
      .status(401)
      .json({ message: "Access denied. No token provided." });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // Adds { userId, username, role } to the request
    next();
  } catch (ex) {
    res.status(400).json({ message: "Invalid token." });
  }
};

/**
 * Middleware generator to check for specific roles.
 * Use after authMiddleware.
 * @param {Array<string>} roles - Array of roles that are allowed (e.g., ['admin'])
 */
const checkRole = (roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res
        .status(403)
        .json({
          message: "Forbidden. You do not have the required permissions.",
        });
    }
    next();
  };
};

// --- API ROUTES & CONTROLLERS ---

// --- 1. Auth Routes (Public) ---

/**
 * POST /api/auth/login
 * Logs in any user (admin, mechanic, customer) and returns a JWT.
 */
app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res
        .status(400)
        .json({ message: "Username and password are required." });
    }

    const db = await readDB();
    const user = db.users.find((u) => u.username === username);

    if (!user) {
      return res.status(401).json({ message: "Invalid credentials." });
    }

    // --- MODIFIED LOGIN ---
    // Simple string comparison. NOT SECURE!
    const isMatch = user.password === password;
    // --- END MODIFICATION ---

    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials." });
    }

    // Create token
    const token = jwt.sign(
      {
        userId: user.id,
        username: user.username,
        role: user.role,
        fullName: user.fullName,
      },
      JWT_SECRET,
      { expiresIn: "8h" }
    );

    res.json({
      message: "Login successful!",
      token: token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        fullName: user.fullName,
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// --- 2. Admin Routes ---

/**
 * POST /api/auth/register (Admin-only)
 * Admin registers a new user (mechanic or customer).
 */
app.post(
  "/api/auth/register",
  authMiddleware,
  checkRole(["admin"]),
  async (req, res) => {
    try {
      const { username, password, fullName, mobile, role } = req.body;
      if (!username || !password || !fullName || !role || !mobile) {
        return res.status(400).json({ message: "Missing required fields." });
      }
      if (role === "admin") {
        return res.status(403).json({ message: "Cannot register new admins." });
      }

      const db = await readDB();
      const userExists = db.users.find((u) => u.username === username);
      if (userExists) {
        return res.status(409).json({ message: "Username already exists." });
      }

      // --- MODIFIED REGISTRATION ---
      // No hashing. Storing plain text password. NOT SECURE!
      const newUser = {
        id: randomUUID(),
        username,
        password: password, // <-- Storing plain text
        fullName,
        mobile,
        role, // 'mechanic' or 'customer'
      };
      // --- END MODIFICATION ---

      db.users.push(newUser);
      await writeDB(db);

      res
        .status(201)
        .json({ message: "User registered successfully.", userId: newUser.id });
    } catch (error) {
      res.status(500).json({ message: "Server error", error: error.message });
    }
  }
);

/**
 * GET /api/admin/dashboard-data (Admin-only)
 * Gets all jobs, mechanics, and parts for the admin dashboard.
 */
app.get(
  "/api/admin/dashboard-data",
  authMiddleware,
  checkRole(["admin"]),
  async (req, res) => {
    try {
      const db = await readDB();

      const mechanics = db.users
        .filter((u) => u.role === "mechanic")
        .map((m) => ({ id: m.id, fullName: m.fullName }));
      const parts = db.parts;

      // Add mechanic and customer names to job cards for display
      const jobCards = db.jobCards.map((job) => {
        const customer = db.users.find((u) => u.id === job.customerId);
        const mechanic = db.users.find((u) => u.id === job.assignedMechanicId);
        return {
          ...job,
          customerName: customer ? customer.fullName : "N/A",
          mechanicName: mechanic ? mechanic.fullName : "N/A",
        };
      });

      res.json({ jobCards, mechanics, parts });
    } catch (error) {
      res.status(500).json({ message: "Server error", error: error.message });
    }
  }
);

/**
 * PUT /api/admin/jobcards/:id/assign (Admin-only)
 * Admin assigns a mechanic to a job card.
 */
app.put(
  "/api/admin/jobcards/:id/assign",
  authMiddleware,
  checkRole(["admin"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { mechanicId } = req.body;

      const db = await readDB();
      const job = db.jobCards.find((j) => j.id === id);
      if (!job) {
        return res.status(404).json({ message: "Job card not found." });
      }

      const mechanic = db.users.find(
        (u) => u.id === mechanicId && u.role === "mechanic"
      );
      if (!mechanic) {
        return res.status(404).json({ message: "Mechanic not found." });
      }

      job.assignedMechanicId = mechanicId;
      job.status = "Assigned";
      await writeDB(db);

      // Return the updated job with mechanic name
      const updatedJob = {
        ...job,
        customerName:
          db.users.find((u) => u.id === job.customerId)?.fullName || "N/A",
        mechanicName: mechanic.fullName,
      };
      res.json({
        message: "Mechanic assigned successfully.",
        jobCard: updatedJob,
      });
    } catch (error) {
      res.status(500).json({ message: "Server error", error: error.message });
    }
  }
);

// --- 3. Mechanic Routes ---

/**
 * GET /api/inventory/parts (Mechanic/Admin)
 * Gets a list of all available parts from inventory.
 */
app.get(
  "/api/inventory/parts",
  authMiddleware,
  checkRole(["mechanic", "admin"]),
  async (req, res) => {
    try {
      const db = await readDB();
      res.json(db.parts);
    } catch (error) {
      res.status(500).json({ message: "Server error", error: error.message });
    }
  }
);

/**
 * GET /api/mechanic/jobs (Mechanic-only)
 * Mechanic views all job cards assigned to them.
 */
app.get(
  "/api/mechanic/jobs",
  authMiddleware,
  checkRole(["mechanic"]),
  async (req, res) => {
    try {
      const db = await readDB();
      const myJobs = db.jobCards
        .filter((j) => j.assignedMechanicId === req.user.userId)
        .map((job) => {
          // Add customer info to the job
          const customer = db.users.find((u) => u.id === job.customerId);
          return {
            ...job,
            customerName: customer ? customer.fullName : "N/A",
            customerMobile: customer ? customer.mobile : "N/A",
          };
        });
      res.json(myJobs);
    } catch (error) {
      res.status(500).json({ message: "Server error", error: error.message });
    }
  }
);

/**
 * PUT /api/mechanic/jobs/:id/log-part (Mechanic-only)
 * Mechanic logs a part used for a job. This decreases stock.
 */
app.put(
  "/api/mechanic/jobs/:id/log-part",
  authMiddleware,
  checkRole(["mechanic"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { partId, quantityUsed } = req.body;
      const qty = parseInt(quantityUsed, 10);

      if (!partId || !qty || qty <= 0) {
        return res
          .status(400)
          .json({
            message: "Valid Part ID and positive quantity are required.",
          });
      }

      const db = await readDB();
      const job = db.jobCards.find((j) => j.id === id);

      if (!job) {
        return res.status(404).json({ message: "Job card not found." });
      }
      // Security check: Is this job assigned to me?
      if (job.assignedMechanicId !== req.user.userId) {
        return res
          .status(403)
          .json({ message: "You are not assigned to this job." });
      }

      const part = db.parts.find((p) => p.id === partId);
      if (!part) {
        return res
          .status(404)
          .json({ message: "Part not found in inventory." });
      }
      if (part.quantity < qty) {
        return res
          .status(400)
          .json({
            message: `Not enough stock for ${part.partName}. Only ${part.quantity} left.`,
          });
      }

      // Decrease stock
      part.quantity -= qty;

      // Log part usage in job card
      const existingPartLog = job.partsUsed.find((p) => p.partId === partId);
      if (existingPartLog) {
        existingPartLog.quantity += qty;
      } else {
        job.partsUsed.push({ partId, partName: part.partName, quantity: qty });
      }

      await writeDB(db);
      res.json({ message: "Part logged successfully.", jobCard: job });
    } catch (error) {
      res.status(500).json({ message: "Server error", error: error.message });
    }
  }
);

/**
 * PUT /api/mechanic/jobs/:id/status (Mechanic-only)
 * Mechanic updates the status of their job (e.g., "In Progress", "Ready for Dispatch").
 */
app.put(
  "/api/mechanic/jobs/:id/status",
  authMiddleware,
  checkRole(["mechanic"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const validStatuses = ["In Progress", "Ready for Dispatch", "Dispatched"];

      if (!status || !validStatuses.includes(status)) {
        return res.status(400).json({ message: "Invalid or missing status." });
      }

      const db = await readDB();
      const job = db.jobCards.find((j) => j.id === id);

      if (!job) {
        return res.status(404).json({ message: "Job card not found." });
      }
      if (job.assignedMechanicId !== req.user.userId) {
        return res
          .status(403)
          .json({ message: "You are not assigned to this job." });
      }

      job.status = status;
      if (status === "Dispatched") {
        job.dispatchedDate = new Date().toISOString();
      }

      await writeDB(db);
      res.json({ message: "Status updated.", jobCard: job });
    } catch (error) {
      res.status(500).json({ message: "Server error", error: error.message });
    }
  }
);

// --- 4. Customer Routes ---

/**
 * POST /api/customer/request-service (Customer-only)
 * Customer fills out a form to create a new job card.
 */
app.post(
  "/api/customer/request-service",
  authMiddleware,
  checkRole(["customer"]),
  async (req, res) => {
    try {
      const { vehicleNumberPlate, issueDescription } = req.body;
      if (!vehicleNumberPlate || !issueDescription) {
        return res
          .status(400)
          .json({
            message: "Vehicle number plate and issue description are required.",
          });
      }

      const db = await readDB();

      const newJobCard = {
        id: randomUUID(),
        customerId: req.user.userId, // From the logged-in user's token
        vehicleNumberPlate,
        issueDescription,
        status: "Pending", // Initial status, needs admin assignment
        assignedMechanicId: null,
        partsUsed: [],
        createdDate: new Date().toISOString(),
      };

      db.jobCards.push(newJobCard);
      await writeDB(db);

      res
        .status(201)
        .json({
          message: "Service request submitted successfully.",
          jobCard: newJobCard,
        });
    } catch (error) {
      res.status(500).json({ message: "Server error", error: error.message });
    }
  }
);

/**
 * GET /api/customer/status (Customer-only)
 * Customer views the status of all their job cards.
 */
app.get(
  "/api/customer/status",
  authMiddleware,
  checkRole(["customer"]),
  async (req, res) => {
    try {
      const db = await readDB();
      // Find all jobs belonging to the logged-in customer
      const myJobs = db.jobCards.filter(
        (j) => j.customerId === req.user.userId
      );

      if (myJobs.length === 0) {
        return res.json([]); // Return empty array
      }

      // Return only the data a customer needs to see
      const jobStatuses = myJobs.map((job) => ({
        jobId: job.id,
        vehicle: job.vehicleNumberPlate,
        issue: job.issueDescription,
        status: job.status,
        created: job.createdDate,
      }));

      res.json(jobStatuses);
    } catch (error) {
      res.status(500).json({ message: "Server error", error: error.message });
    }
  }
);

// --- ROOT & SERVER STARTUP ---
app.get("/api", (req, res) => {
  res.json({ message: "Welcome to the Vehicle Service Center API!" });
});

// Fallback middleware for SPA (Single Page Application)
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ message: "API endpoint not found." });
  }
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
