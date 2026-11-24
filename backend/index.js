import "dotenv/config";
import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { createServer } from "node:http";
import { Server } from "socket.io";

// ==========================================
// ENVIRONMENT VARIABLES
// ==========================================

const {
  MONGO_URI,
  CLIENT_ORIGIN = "http://localhost:5173",
  PORT = 5000,
} = process.env;

if (!MONGO_URI) {
  throw new Error("MONGO_URI is not configured");
}

// ==========================================
// CORS CONFIGURATION
// ==========================================

const allowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  ...CLIENT_ORIGIN.split(","),
]
  .map((origin) => origin.trim().replace(/\/+$/, ""))
  .filter(Boolean);

const corsOptions = {
  origin: allowedOrigins,
  methods: ["GET", "POST", "OPTIONS"],
  credentials: true,
};

// ==========================================
// CLOUDINARY CONFIGURATION
// ==========================================

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

// ==========================================
// EXPRESS AND SOCKET.IO
// ==========================================

const app = express();

const server = createServer(app);

const io = new Server(server, {
  cors: corsOptions,
});

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==========================================
// SOCKET.IO CONNECTION
// ==========================================

io.on("connection", (socket) => {
  console.log("Display connected:", socket.id);

  socket.on("disconnect", (reason) => {
    console.log("Display disconnected:", socket.id);
    console.log("Disconnect reason:", reason);
  });
});

io.engine.on("connection_error", (error) => {
  console.error("Socket connection error:", error.message);
});

// ==========================================
// PAYMENT MODEL
// ==========================================

const Payment = mongoose.model(
  "Payment",
  new mongoose.Schema(
    {
      name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 120,
      },

      registrationNumber: {
        type: String,
        required: true,
        trim: true,
        maxlength: 80,
      },

      amountPaise: {
        type: Number,
        required: true,
        min: 1,
        validate: Number.isSafeInteger,
      },

      photo: {
        url: String,
        publicId: String,
      },
    },
    {
      timestamps: true,
    }
  )
);

// ==========================================
// MULTER CONFIGURATION
// ==========================================

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 5 * 1024 * 1024,
  },

  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
    ];

    cb(null, allowedTypes.includes(file.mimetype));
  },
});

// ==========================================
// ROOT ROUTE
// ==========================================

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "JFW Payment Backend is running",
    database:
      mongoose.connection.readyState === 1
        ? "Connected"
        : "Disconnected",
    connectedDisplays: io.engine.clientsCount,
  });
});

// ==========================================
// HEALTH CHECK
// ==========================================

app.get("/api/health", (req, res) => {
  const connected = mongoose.connection.readyState === 1;

  res.status(connected ? 200 : 503).json({
    success: connected,
    server: "Running",
    database: connected ? "Connected" : "Disconnected",
    uptime: process.uptime(),
  });
});

// ==========================================
// CREATE PAYMENT
// ==========================================

app.post(
  "/api/payments",
  upload.single("photo"),
  async (req, res, next) => {
    let asset;
    let payment;

    try {
      const { name, registrationNumber, amount } = req.body;

      const paise = Math.round(Number(amount) * 100);

      // Validate payment details

      if (
        typeof name !== "string" ||
        !name.trim() ||
        name.length > 120 ||
        typeof registrationNumber !== "string" ||
        !registrationNumber.trim() ||
        registrationNumber.length > 80 ||
        !/^\d+(\.\d{1,2})?$/.test(amount || "") ||
        !Number.isSafeInteger(paise) ||
        paise < 1 ||
        !req.file
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Enter valid details and a JPG, PNG or WebP photo",
        });
      }

      // Upload profile picture to Cloudinary

      asset = await new Promise((resolve, reject) => {
        cloudinary.uploader
          .upload_stream(
            {
              folder: "jfw-payments",
              resource_type: "image",

              transformation: [
                {
                  width: 800,
                  height: 800,
                  crop: "limit",
                },
              ],
            },

            (error, result) => {
              if (error) {
                reject(error);
              } else {
                resolve(result);
              }
            }
          )
          .end(req.file.buffer);
      });

      // Save payment in MongoDB

      payment = await Payment.create({
        name: name.trim(),
        registrationNumber: registrationNumber.trim(),
        amountPaise: paise,

        photo: {
          url: asset.secure_url,
          publicId: asset.public_id,
        },
      });

      // Broadcast payment to connected displays

      io.emit("payment:created", payment);

      console.log("New payment recorded:", payment._id);
      console.log("Payment amount:", paise / 100);
      console.log("Connected displays:", io.engine.clientsCount);

      // Return response

      return res.status(201).json(payment);
    } catch (error) {
      // Delete uploaded image if database creation failed

      if (asset && !payment) {
        await cloudinary.uploader
          .destroy(asset.public_id)
          .catch(() => {});
      }

      next(error);
    }
  }
);

// ==========================================
// GET ALL PAYMENTS
// ==========================================

app.get("/api/payments", async (req, res, next) => {
  try {
    const payments = await Payment.find()
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    return res.status(200).json(payments);
  } catch (error) {
    next(error);
  }
});

// ==========================================
// ROUTE NOT FOUND
// ==========================================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// ==========================================
// GLOBAL ERROR HANDLER
// ==========================================

app.use((err, req, res, next) => {
  console.error("Server error:", err);

  if (res.headersSent) {
    return next(err);
  }

  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }

  if (err instanceof mongoose.Error.ValidationError) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }

  return res.status(500).json({
    success: false,
    message: "Unable to complete request",
  });
});

// ==========================================
// DATABASE CONNECTION AND SERVER START
// ==========================================

const startServer = async () => {
  try {
    await mongoose.connect(MONGO_URI);

    console.log("MongoDB connected successfully");

    server.listen(PORT, "0.0.0.0", () => {
      console.log("=================================");
      console.log(`JFW server running on port ${PORT}`);
      console.log("Socket.IO is ready");
      console.log("Allowed origins:", allowedOrigins);
      console.log("=================================");
    });
  } catch (error) {
    console.error("Server startup failed:", error.message);
    process.exit(1);
  }
};

startServer();