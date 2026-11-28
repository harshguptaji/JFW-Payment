
// ============================================
// IMPORTS
// ============================================

import "dotenv/config";
import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { timingSafeEqual } from "node:crypto";

// ============================================
// CONFIGURATION
// ============================================

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;

const origins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  ...(process.env.CLIENT_ORIGIN || "").split(","),
]
  .map((origin) => origin.trim().replace(/\/+$/, ""))
  .filter(Boolean);

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

const app = express();
const server = createServer(app);

const corsOptions = {
  origin: origins,
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Management-Key",
  ],
  credentials: true,
};

const io = new Server(server, {
  cors: corsOptions,
});

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================
// MULTER
// ============================================

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

    if (!allowedTypes.includes(file.mimetype)) {
      return cb(
        Object.assign(new Error("Invalid image format"), {
          status: 400,
        })
      );
    }

    cb(null, true);
  },
});

// ============================================
// HELPERS
// ============================================

const DAY = 86400000;
const IST_OFFSET = 19800000;

const objectId = mongoose.Schema.Types.ObjectId;

const bad = (message, status = 400) =>
  Object.assign(new Error(message), { status });

const route = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const r = route;

function oid(value) {
  if (!mongoose.isValidObjectId(value)) {
    throw bad("Invalid ID");
  }

  return value;
}

function integer(value) {
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < 0
  ) {
    throw bad("Invalid nonnegative integer");
  }

  return Number(value);
}

function money(value) {
  if (!/^\d+(\.\d{1,2})?$/.test(String(value))) {
    throw bad("Invalid amount");
  }

  return integer(Math.round(Number(value) * 100));
}

function local(value = Date.now()) {
  return new Date(Number(value) + IST_OFFSET)
    .toISOString()
    .slice(0, 10);
}

function day(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) {
    throw bad("Invalid date");
  }

  const date = new Date(`${value}T00:00:00+05:30`);

  if (!Number.isFinite(+date) || local(date) !== value) {
    throw bad("Invalid date");
  }

  return +date;
}

function changed() {
  io.emit("performance:changed");
}

function notify(event) {
  io.emit(event);
  changed();
}

// ============================================
// MANAGEMENT AUTHENTICATION
// ============================================

function auth(req, res, next) {
  const expected = Buffer.from(
    process.env.MANAGEMENT_KEY || ""
  );

  const provided = Buffer.from(
    req.get("X-Management-Key") || ""
  );

  if (
    !expected.length ||
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    return res.status(401).json({
      success: false,
      message: "Invalid management key",
    });
  }

  next();
}

// ============================================
// CLOUDINARY UPLOAD
// ============================================

async function uploadPhoto(file, folder) {
  if (!file) return null;

  const result = await new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        {
          folder,
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
          if (error) reject(error);
          else resolve(result);
        }
      )
      .end(file.buffer);
  });

  return {
    url: result.secure_url,
    publicId: result.public_id,
  };
}

// ============================================
// EVENT MODEL
// ============================================

const eventSchema = new mongoose.Schema(
  {
    eventName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },

    eventCity: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },

    eventDate: {
      type: Date,
      required: true,
    },

    currentRegistration: {
      type: Number,
      default: 0,
      min: 0,
      validate: Number.isSafeInteger,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

const Event = mongoose.model("Event", eventSchema);

// ============================================
// EMPLOYEE MODEL
// ============================================

const employeeSchema = new mongoose.Schema(
  {
    employeeCode: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },

    employeeName: {
      type: String,
      required: true,
      trim: true,
    },

    employeeEmail: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    employeeMobile: String,

    employeePhoto: {
      url: String,
      publicId: String,
    },

    designation: {
      type: String,
      default: "Sales Executive",
    },

    department: {
      type: String,
      default: "Sales",
    },

    monthlySalaryPaise: {
      type: Number,
      required: true,
      min: 0,
      select: false,
      validate: Number.isSafeInteger,
    },

    joiningDate: {
      type: Date,
      default: Date.now,
    },

    leavingDate: {
      type: Date,
      default: null,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },

    deletedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

const Employee = mongoose.model(
  "Employee",
  employeeSchema
);

// ============================================
// SALARY HISTORY MODEL
// ============================================

const salarySchema = new mongoose.Schema(
  {
    employeeId: {
      type: objectId,
      ref: "Employee",
      required: true,
    },

    monthlySalaryPaise: {
      type: Number,
      required: true,
      min: 0,
      validate: Number.isSafeInteger,
    },

    effectiveFrom: {
      type: Date,
      required: true,
    },

    remarks: String,
  },
  { timestamps: true }
);

salarySchema.index(
  {
    employeeId: 1,
    effectiveFrom: 1,
  },
  { unique: true }
);

const Salary = mongoose.model(
  "SalaryHistory",
  salarySchema
);

// ============================================
// WEEK MODEL
// ============================================

const weekSchema = new mongoose.Schema(
  {
    year: {
      type: Number,
      required: true,
    },

    month: {
      type: Number,
      required: true,
      min: 1,
      max: 12,
    },

    weekNumber: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },

    weekName: {
      type: String,
      required: true,
    },

    startDate: {
      type: Date,
      required: true,
    },

    endDate: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true }
);

weekSchema.index(
  {
    year: 1,
    month: 1,
    weekNumber: 1,
  },
  { unique: true }
);

const Week = mongoose.model("Week", weekSchema);

// ============================================
// EMPLOYEE TARGET MODEL
// ============================================

const targetSchema = new mongoose.Schema(
  {
    employeeId: {
      type: objectId,
      ref: "Employee",
      required: true,
    },

    weekId: {
      type: objectId,
      ref: "Week",
    },

    targetType: {
      type: String,
      default: "WEEKLY",
    },

    startDate: Date,

    endDate: Date,

    targetAmountPaise: {
      type: Number,
      default: null,
      min: 0,
    },

    targetRegistrations: {
      type: Number,
      default: null,
      min: 0,
    },

    achievementBasis: {
      type: String,
      enum: ["AMOUNT", "REGISTRATION"],
      default: "AMOUNT",
    },

    manualAchievement: {
      enabled: {
        type: Boolean,
        default: false,
      },

      achievedAmountPaise: {
        type: Number,
        default: null,
      },

      achievedRegistrations: {
        type: Number,
        default: null,
      },

      baselineAmountPaise: { type: Number, default: null, min: 0 },
      baselineRegistrations: { type: Number, default: null, min: 0 },

      reason: String,

      updatedAt: Date,
    },

    isCancelled: {
      type: Boolean,
      default: false,
    },

    remarks: String,
  },
  { timestamps: true }
);

targetSchema.index(
  {
    employeeId: 1,
    weekId: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      weekId: {
        $type: "objectId",
      },
    },
  }
);

const Target = mongoose.model(
  "EmployeeTarget",
  targetSchema
);

// ============================================
// PAYMENT MODEL
// ============================================

const paymentSchema = new mongoose.Schema(
  {
    employeeId: {
      type: objectId,
      ref: "Employee",
      index: true,
    },

    employeeName: String,

    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },

    registrationNumber: String,

    eventId: {
      type: objectId,
      ref: "Event",
      required: true,
    },

    eventCity: {
      type: String,
      required: true,
    },

    eventName: String,

    eventDate: Date,

    registrationCount: {
      type: Number,
      required: true,
      min: 1,
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
  { timestamps: true }
);

paymentSchema.index({
  employeeId: 1,
  createdAt: 1,
});

const Payment = mongoose.model(
  "Payment",
  paymentSchema
);

// ============================================
// WEEKLY EXPENSE MODEL
// ============================================

const expenseSchema = new mongoose.Schema(
  {
    employeeId: {
      type: objectId,
      ref: "Employee",
      required: true,
    },

    weekId: {
      type: objectId,
      ref: "Week",
    },

    month: {
      type: String,
      required: true,
      match: /^\d{4}-(0[1-9]|1[0-2])$/,
    },

    weekNumber: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },

    weekStart: {
      type: Date,
      required: true,
    },

    weekEnd: {
      type: Date,
      required: true,
    },

    leadCount: {
      type: Number,
      default: 0,
      min: 0,
      validate: Number.isSafeInteger,
    },

    leadCostPaise: {
      type: Number,
      default: 0,
      min: 0,
      validate: Number.isSafeInteger,
    },

    miscellaneousExpenses: [
      {
        expenseName: {
          type: String,
          required: true,
        },

        amountPaise: {
          type: Number,
          required: true,
          min: 0,
          validate: Number.isSafeInteger,
        },

        expenseDate: {
          type: Date,
          required: true,
        },

        remarks: String,
      },
    ],

    isFinalized: {
      type: Boolean,
      default: false,
    },

    remarks: String,
  },
  { timestamps: true }
);

expenseSchema.index(
  {
    employeeId: 1,
    month: 1,
    weekNumber: 1,
  },
  { unique: true }
);

const Expense = mongoose.model(
  "WeeklyExpense",
  expenseSchema
);

// ============================================
// EMERGENCY MODEL
// ============================================

const emergencySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },

    reason: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },

    photo: {
      url: String,
      publicId: String,
    },

    photoExpiresAt: Date,

    photoDeletedAt: {
      type: Date,
      default: null,
    },

    status: {
      type: String,
      enum: ["Active", "Resolved"],
      default: "Active",
    },

    resolvedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

const Emergency = mongoose.model(
  "Emergency",
  emergencySchema
);

// ============================================
// HEALTH AND MANAGEMENT ROUTES
// ============================================

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "JFW backend running",
  });
});

app.get("/api/health", (req, res) => {
  const connected =
    mongoose.connection.readyState === 1;

  res.status(connected ? 200 : 503).json({
    success: connected,
    database: connected
      ? "Connected"
      : "Disconnected",
  });
});

app.get("/api/management/verify", auth, (req, res) => {
  res.json({
    success: true,
    message: "Management access verified",
  });
});

// ============================================
// GET ALL EMPLOYEES
// ============================================

app.get(
  "/api/employees",
  r(async (req, res) => {
    const filter = {
      isDeleted: { $ne: true },
    };

    if (req.query.all !== "1") {
      filter.isActive = true;
    }

    const employees = await Employee.find(filter)
      .select(
        "employeeName employeeCode employeePhoto designation department isActive"
      )
      .sort({ employeeName: 1 })
      .lean();

    res.json(employees);
  })
);

// ============================================
// GET SINGLE EMPLOYEE
// ============================================

app.get(
  "/api/employees/:id",
  auth,
  r(async (req, res) => {
    const employee = await Employee.findOne({
      _id: oid(req.params.id),
      isDeleted: { $ne: true },
    }).select("+monthlySalaryPaise");

    if (!employee) {
      throw bad("Employee not found", 404);
    }

    const salaryHistory = await Salary.find({
      employeeId: employee._id,
    })
      .sort({ effectiveFrom: -1 })
      .lean();

    res.json({
      ...employee.toObject(),

      monthlySalary:
        (employee.monthlySalaryPaise || 0) / 100,

      salaryHistory,
    });
  })
);

// ============================================
// CREATE / UPDATE EMPLOYEE
// ============================================

async function saveEmployee(req, res) {
  const body = req.body;
  const id = req.params.id;

  const asset = await uploadPhoto(
    req.file,
    "jfw-employees"
  );

  let employee;
  let oldPhoto;

  try {
    await mongoose.connection.transaction(
      async (session) => {
        employee = id
          ? await Employee.findOne({
              _id: oid(id),
              isDeleted: { $ne: true },
            })
              .select("+monthlySalaryPaise")
              .session(session)
          : new Employee();

        if (!employee) {
          throw bad("Employee not found", 404);
        }

        const fields = [
          "employeeName",
          "employeeCode",
          "employeeEmail",
          "employeeMobile",
          "designation",
          "department",
        ];

        for (const field of fields) {
          if (field in body) {
            employee[field] = body[field];
          }
        }

        if (!id) {
          employee.joiningDate = new Date(
            day(body.joiningDate || local())
          );
        }

        if ("isActive" in body) {
          employee.isActive =
            String(body.isActive) === "true";

          if (employee.isActive) {
            employee.leavingDate = null;
          } else if (body.leavingDate) {
            employee.leavingDate = new Date(
              day(body.leavingDate)
            );
          } else if (!employee.leavingDate) {
            employee.leavingDate = new Date();
          }
        }

        if (asset) {
          oldPhoto = employee.employeePhoto?.publicId;
          employee.employeePhoto = asset;
        }

        const hasSalary =
          body.monthlySalary !== undefined &&
          body.monthlySalary !== "";

        if (!id && !hasSalary) {
          throw bad("Monthly salary is required");
        }

        if (hasSalary) {
          const salaryPaise = money(body.monthlySalary);

          const effectiveFrom = new Date(
            day(
              body.effectiveFrom ||
                (!id
                  ? local(employee.joiningDate)
                  : local())
            )
          );

          if (
            +effectiveFrom <
              day(local(employee.joiningDate)) ||
            +effectiveFrom > day(local())
          ) {
            throw bad("Invalid salary effective date");
          }

          employee.monthlySalaryPaise = salaryPaise;

          await employee.save({ session });

          await Salary.findOneAndUpdate(
            {
              employeeId: employee._id,
              effectiveFrom,
            },
            {
              $set: {
                monthlySalaryPaise: salaryPaise,
                remarks: body.salaryRemarks || "",
              },
            },
            {
              upsert: true,
              new: true,
              session,
              runValidators: true,
            }
          );

          const latestSalary = await Salary.findOne({
            employeeId: employee._id,
          })
            .sort({ effectiveFrom: -1 })
            .session(session);

          employee.monthlySalaryPaise =
            latestSalary.monthlySalaryPaise;
        }

        await employee.save({ session });
      }
    );
  } catch (error) {
    if (
      asset &&
      !error.hasErrorLabel?.(
        "UnknownTransactionCommitResult"
      )
    ) {
      await cloudinary.uploader
        .destroy(asset.publicId)
        .catch(console.error);
    }

    throw error;
  }

  if (oldPhoto) {
    await cloudinary.uploader
      .destroy(oldPhoto)
      .catch(console.error);
  }

  notify("employees:changed");

  res.status(id ? 200 : 201).json({
    ...employee.toObject(),

    monthlySalary:
      employee.monthlySalaryPaise / 100,
  });
}

app.post(
  "/api/employees",
  auth,
  upload.single("photo"),
  r(saveEmployee)
);

app.patch(
  "/api/employees/:id",
  auth,
  upload.single("photo"),
  r(saveEmployee)
);

// ============================================
// DELETE EMPLOYEE - UPDATED
// ============================================

app.delete(
  "/api/employees/:id",
  auth,
  r(async (req, res) => {
    const employee = await Employee.findOne({
      _id: oid(req.params.id),
      isDeleted: { $ne: true },
    });

    if (!employee) {
      throw bad("Employee not found", 404);
    }

    employee.isDeleted = true;
    employee.isActive = false;
    employee.deletedAt = new Date();

    if (!employee.leavingDate) {
      employee.leavingDate = new Date();
    }

    await employee.save({
      validateModifiedOnly: true,
    });

    // Refresh employee list and live dashboard.
    notify("employees:changed");

    res.json({
      success: true,
      message: "Employee deleted successfully",
      employeeId: employee._id,
    });
  })
);

// ============================================
// WEEK HELPERS
// ============================================

async function getWeek(id) {
  const week = await Week.findById(oid(id));

  if (!week) {
    throw bad("Week not found", 404);
  }

  return week;
}

// ============================================
// GET ALL WEEKS
// ============================================

app.get(
  "/api/weeks",
  r(async (req, res) => {
    const filter = {};

    if (req.query.year) {
      filter.year = integer(req.query.year);
    }

    if (req.query.month) {
      filter.month = integer(req.query.month);
    }

    const weeks = await Week.find(filter)
      .sort({ startDate: 1 })
      .lean();

    res.json(weeks);
  })
);

// ============================================
// CREATE / UPDATE WEEK
// ============================================

async function saveWeek(req, res) {
  const body = req.body;
  const id = req.params.id;

  const start = day(body.startDate);
  const end = day(body.endDate) + DAY;

  const year = integer(body.year);
  const month = integer(body.month);
  const weekNumber = integer(body.weekNumber);

  const selectedMonth =
    `${year}-${String(month).padStart(2, "0")}`;

  if (
    year < 1900 ||
    year > 9998 ||
    month < 1 ||
    month > 12 ||
    weekNumber < 1 ||
    weekNumber > 5 ||
    end <= start ||
    local(start).slice(0, 7) !== selectedMonth ||
    local(end - DAY).slice(0, 7) !== selectedMonth
  ) {
    throw bad(
      "Week dates must be within the selected month"
    );
  }

  const overlapFilter = {
    startDate: { $lt: new Date(end) },
    endDate: { $gt: new Date(start) },
  };

  if (id) {
    overlapFilter._id = {
      $ne: oid(id),
    };
  }

  if (await Week.exists(overlapFilter)) {
    throw bad("Week overlaps an existing week", 409);
  }

  if (
    id &&
    (
      (await Target.exists({ weekId: id })) ||
      (await Expense.exists({ weekId: id }))
    )
  ) {
    throw bad(
      "Week is already assigned and cannot be changed",
      409
    );
  }

  const fields = {
    year,
    month,
    weekNumber,

    weekName:
      body.weekName || `Week ${weekNumber}`,

    startDate: new Date(start),
    endDate: new Date(end),
  };

  const week = id
    ? await Week.findByIdAndUpdate(id, fields, {
        new: true,
        runValidators: true,
      })
    : await Week.create(fields);

  if (!week) {
    throw bad("Week not found", 404);
  }

  notify("weeks:changed");

  res.status(id ? 200 : 201).json(week);
}

app.post("/api/weeks", auth, r(saveWeek));

app.patch("/api/weeks/:id", auth, r(saveWeek));

// ============================================
// DELETE WEEK
// ============================================

app.delete(
  "/api/weeks/:id",
  auth,
  r(async (req, res) => {
    const id = oid(req.params.id);

    if (
      (await Target.exists({ weekId: id })) ||
      (await Expense.exists({ weekId: id }))
    ) {
      throw bad(
        "Cannot delete a week with targets or expenses",
        409
      );
    }

    const week = await Week.findByIdAndDelete(id);

    if (!week) {
      throw bad("Week not found", 404);
    }

    notify("weeks:changed");

    res.json({
      success: true,
      message: "Week deleted successfully",
    });
  })
);

// ============================================
// GET TARGETS
// ============================================

app.get(
  "/api/targets",
  auth,
  r(async (req, res) => {
    const filter = {
      isCancelled: { $ne: true },
    };

    if (req.query.employeeId) {
      filter.employeeId = oid(req.query.employeeId);
    }

    if (req.query.weekId) {
      filter.weekId = oid(req.query.weekId);
    }

    const targets = await Target.find(filter)
      .populate(
        "employeeId",
        "employeeName employeeCode"
      )
      .populate("weekId")
      .sort({ startDate: -1 })
      .lean();

    res.json(await Promise.all(targets.map(async target => ({
      ...target,
      performance: await targetResult(target),
    }))));
  })
);

// ============================================
// CREATE / UPDATE TARGET
// ============================================

async function saveTarget(req, res) {
  const body = req.body;
  const id = req.params.id;

  const old = id
    ? await Target.findById(oid(id))
    : null;

  if (id && !old) {
    throw bad("Target not found", 404);
  }

  const employeeId = oid(
    body.employeeId || old?.employeeId
  );

  const week = await getWeek(
    body.weekId || old?.weekId
  );

  const employee = await Employee.findOne({
    _id: employeeId,
    isActive: true,
    isDeleted: { $ne: true },
  });

  if (!employee) {
    throw bad("Employee unavailable", 404);
  }

  const basis = body.achievementBasis;

  if (!["AMOUNT", "REGISTRATION"].includes(basis)) {
    throw bad("Invalid achievement basis");
  }

  const targetAmountPaise =
    basis === "AMOUNT"
      ? money(body.targetAmount)
      : null;

  const targetRegistrations =
    body.targetRegistrations === undefined ||
    body.targetRegistrations === null ||
    body.targetRegistrations === ""
      ? null
      : integer(body.targetRegistrations);

  if (
    basis === "AMOUNT" &&
    !(targetAmountPaise > 0)
  ) {
    throw bad("Target amount must be greater than zero");
  }

  if (
    basis === "REGISTRATION" &&
    !(targetRegistrations > 0)
  ) {
    throw bad(
      "Target registrations must be greater than zero"
    );
  }

  const manual = body.manualAchievement || {};

  const enabled = manual.enabled === true;

  const same = old && String(old.employeeId) === String(employeeId) && String(old.weekId) === String(week._id);
  const stats = await actual(employeeId, week.startDate, week.endDate);
  const manualAchievement = { enabled, reason: enabled ? String(manual.reason || "").trim() : "", updatedAt: new Date() };
  if (enabled && !manualAchievement.reason) throw bad("Manual achievement reason is required");
  for (const [input, field, baseline, changed, actualValue, parse] of [
    ["achievedAmount", "achievedAmountPaise", "baselineAmountPaise", "amountChanged", stats.revenue, money],
    ["achievedRegistrations", "achievedRegistrations", "baselineRegistrations", "registrationChanged", stats.count, integer],
  ]) {
    if (enabled && same && old.manualAchievement?.enabled && manual[changed] === false) {
      manualAchievement[field] = old.manualAchievement[field] ?? null;
      manualAchievement[baseline] = old.manualAchievement[baseline] ?? null;
    } else {
      manualAchievement[field] = enabled && manual[input] != null && manual[input] !== "" ? parse(manual[input]) : null;
      manualAchievement[baseline] = manualAchievement[field] == null ? null : actualValue;
    }
  }

  const fields = {
    employeeId,
    weekId: week._id,

    startDate: week.startDate,
    endDate: week.endDate,

    targetType: "WEEKLY",

    achievementBasis: basis,

    targetAmountPaise,
    targetRegistrations,

    manualAchievement,

    remarks: body.remarks || "",

    isCancelled: false,
  };

  const duplicateFilter = {
    employeeId,
    weekId: week._id,
  };

  if (id) {
    duplicateFilter._id = { $ne: id };
  }

  if (await Target.exists(duplicateFilter)) {
    throw bad(
      "Employee already has a target for this week",
      409
    );
  }

  const target = id
    ? await Target.findByIdAndUpdate(id, fields, {
        new: true,
        runValidators: true,
      })
    : await Target.create(fields);

  notify("targets:changed");

  res.status(id ? 200 : 201).json(target);
}

app.post("/api/targets", auth, r(saveTarget));

app.patch(
  "/api/targets/:id",
  auth,
  r(saveTarget)
);

app.patch("/api/targets/:id/reset-achievement", auth, r(async (req,res) => {
  const target = await Target.findByIdAndUpdate(oid(req.params.id), { $set: { manualAchievement: { enabled: false } } }, { new: true });
  if (!target) throw bad("Target not found", 404);
  notify("targets:changed");
  res.json(target);
}));

// ============================================
// DELETE TARGET
// ============================================

app.delete(
  "/api/targets/:id",
  auth,
  r(async (req, res) => {
    const target = await Target.findByIdAndDelete(
      oid(req.params.id)
    );

    if (!target) {
      throw bad("Target not found", 404);
    }

    notify("targets:changed");

    res.json({
      success: true,
      message: "Target deleted successfully",
    });
  })
);

// ============================================
// GET EXPENSES
// ============================================

app.get(
  "/api/expenses",
  auth,
  r(async (req, res) => {
    const filter = {};

    if (req.query.weekId) {
      filter.weekId = oid(req.query.weekId);
    }

    if (req.query.employeeId) {
      filter.employeeId = oid(req.query.employeeId);
    }

    const expenses = await Expense.find(filter)
      .sort({ weekStart: -1 })
      .lean();

    res.json(expenses);
  })
);

// ============================================
// CREATE / UPDATE EXPENSES
// ============================================

app.post(
  "/api/expenses",
  auth,
  r(async (req, res) => {
    const body = req.body;

    const week = await getWeek(body.weekId);

    const employeeId = oid(body.employeeId);

    if (
      !(await Employee.exists({
        _id: employeeId,
      }))
    ) {
      throw bad("Employee not found", 404);
    }

    const month =
      `${week.year}-${String(week.month).padStart(2, "0")}`;

    const filter = {
      employeeId,
      month,
      weekNumber: week.weekNumber,
    };

    const existing = await Expense.findOne(filter);

    if (existing?.isFinalized) {
      throw bad("Expense record is finalized", 409);
    }

    const miscellaneousExpenses = (
      body.miscellaneousExpenses || []
    ).map((item) => {
      const expenseDate = day(item.expenseDate);

      if (
        expenseDate < +week.startDate ||
        expenseDate >= +week.endDate
      ) {
        throw bad(
          "Expense date must be within the selected week"
        );
      }

      if (!String(item.expenseName || "").trim()) {
        throw bad("Expense name is required");
      }

      return {
        expenseName: item.expenseName,
        amountPaise: money(item.amount),
        expenseDate: new Date(expenseDate),
        remarks: item.remarks || "",
      };
    });

    const expense = await Expense.findOneAndUpdate(
      {
        ...filter,
        isFinalized: false,
      },
      {
        $set: {
          weekId: week._id,

          weekStart: week.startDate,
          weekEnd: week.endDate,

          leadCount: integer(body.leadCount),
          leadCostPaise: money(body.leadCost),

          miscellaneousExpenses,

          remarks: body.remarks || "",
        },
      },
      {
        upsert: true,
        new: true,
        runValidators: true,
      }
    );

    changed();

    res.json(expense);
  })
);

// ============================================
// REPORT DATE RANGE
// ============================================

async function reportRange(query = {}) {
  const today = local();

  const duration = query.duration || "today";

  if (query.weekId) {
    const week = await getWeek(query.weekId);

    return [
      +week.startDate,
      +week.endDate,
    ];
  }

  if (duration === "today") {
    const start = day(today);

    return [start, start + DAY];
  }

  if (duration === "weekly") {
    const now = new Date();

    const week = await Week.findOne({
      startDate: { $lte: now },
      endDate: { $gt: now },
    });

    if (!week) {
      throw bad("No current saved week", 404);
    }

    return [
      +week.startDate,
      +week.endDate,
    ];
  }

  if (duration === "monthly") {
    const month =
      query.month || today.slice(0, 7);

    const start = day(`${month}-01`);

    const date = new Date(start + IST_OFFSET);

    const end =
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth() + 1,
        1
      ) - IST_OFFSET;

    return [start, end];
  }

  if (duration === "yearly") {
    const year = integer(
      query.year || today.slice(0, 4)
    );

    if (year < 1900 || year > 9998) {
      throw bad("Invalid year");
    }

    return [
      day(`${year}-01-01`),
      day(`${year + 1}-01-01`),
    ];
  }

  throw bad("Invalid report duration");
}

// ============================================
// ACTUAL PAYMENT PERFORMANCE
// ============================================

async function actual(employeeId, start, end) {
  const [result] = await Payment.aggregate([
    {
      $match: {
        employeeId: new mongoose.Types.ObjectId(
          employeeId
        ),

        createdAt: {
          $gte: new Date(start),
          $lt: new Date(end),
          $lte: new Date(),
        },
      },
    },

    {
      $group: {
        _id: null,

        revenue: {
          $sum: "$amountPaise",
        },

        count: {
          $sum: 1,
        },
      },
    },
  ]);

  return {
    revenue: result?.revenue || 0,
    count: result?.count || 0,
  };
}

// ============================================
// TARGET ACHIEVEMENT CALCULATION
// ============================================

async function targetResult(target) {
  const week = target.weekId
    ? await Week.findById(target.weekId._id || target.weekId)
    : null;

  const start =
    week?.startDate || target.startDate;

  const end =
    week?.endDate || target.endDate;

  if (!start || !end) {
    return null;
  }

  const payment = await actual(
    target.employeeId._id || target.employeeId,
    start,
    end
  );

  const manual =
    target.manualAchievement || {};

  const basis =
    target.achievementBasis || "AMOUNT";

  const achievedAmount = manual.enabled && manual.achievedAmountPaise != null
    ? Math.max(0, manual.achievedAmountPaise + payment.revenue - (manual.baselineAmountPaise ?? payment.revenue)) : payment.revenue;
  const achievedRegistrations = manual.enabled && manual.achievedRegistrations != null
    ? Math.max(0, manual.achievedRegistrations + payment.count - (manual.baselineRegistrations ?? payment.count)) : payment.count;

  const goal =
    basis === "AMOUNT"
      ? target.targetAmountPaise
      : target.targetRegistrations;

  const achieved =
    basis === "AMOUNT"
      ? achievedAmount
      : achievedRegistrations;

  const achievement =
    goal > 0
      ? (achieved / goal) * 100
      : null;

  return {
    targetId: target._id,

    weekId: target.weekId,

    achievementBasis: basis,

    targetAmount:
      basis === "AMOUNT" ? goal : null,

    targetRegistrations:
      target.targetRegistrations ?? null,

    achievedAmount,
    achievedRegistrations,

    systemAmount: payment.revenue,
    systemRegistrations: payment.count,

    achievement,

    targetAchieved:
      goal > 0 && achieved >= goal,

    manualOverride: Boolean(manual.enabled),

    startDate: start,
    endDate: end,
  };
}

// ============================================
// CURRENT TARGET
// ============================================

async function getCurrentTarget(employeeId) {
  const now = new Date();

  const target = await Target.findOne({
    employeeId,

    isCancelled: {
      $ne: true,
    },

    startDate: {
      $lte: now,
    },

    endDate: {
      $gt: now,
    },
  }).sort({ startDate: -1 });

  return target
    ? await targetResult(target)
    : null;
}

// ============================================
// EXPENSE ALLOCATION
// ============================================

function allocate(
  value,
  start,
  end,
  expenseStart,
  expenseEnd
) {
  const days =
    (+expenseEnd - +expenseStart) / DAY;

  if (days <= 0) {
    return 0;
  }

  const low = Math.max(
    0,
    Math.min(
      days,
      (start - +expenseStart) / DAY
    )
  );

  const high = Math.max(
    0,
    Math.min(
      days,
      (end - +expenseStart) / DAY
    )
  );

  return (
    Math.round((value * high) / days) -
    Math.round((value * low) / days)
  );
}

// ============================================
// PERFORMANCE REPORT - MAIN FIX
// ============================================

async function report(query, pnl = false) {
  const [start, end] = await reportRange(query);

  const now = new Date();

  const employeeFilter = {
    joiningDate: {
      $lt: new Date(end),
    },

    $or: [
      {
        leavingDate: null,
      },

      {
        leavingDate: {
          $gte: new Date(start),
        },
      },
    ],
  };

  if (query.employeeId) {
    employeeFilter._id = oid(query.employeeId);
  }

  // ==========================================
  // IMPORTANT UPDATE
  //
  // Sales dashboard excludes deleted employees.
  // P&L retains historical financial records.
  // ==========================================

employeeFilter.isDeleted = {
  $ne: true,
};

employeeFilter.isActive = true;

  const employees = await Employee.find(
    employeeFilter
  ).lean();

  const rows = await Promise.all(
    employees.map(async (employee) => {
      const payment = await actual(
        employee._id,
        start,
        end
      );

      const assignedTargets = await Target.find({
        employeeId: employee._id,

        isCancelled: {
          $ne: true,
        },

        startDate: {
          $lt: new Date(end),
        },

        endDate: {
          $gt: new Date(start),
        },
      }).lean();

      const currentTarget =
        employee.isDeleted || !employee.isActive
          ? null
          : await getCurrentTarget(employee._id);

      const targets = (
        await Promise.all(
          assignedTargets.map(targetResult)
        )
      ).filter(Boolean);

      const amounts = targets.filter(t => t.achievementBasis === "AMOUNT");
      const regs = targets.filter(t => t.achievementBasis === "REGISTRATION");
      const sumField = (items, key) => items.reduce((n,t) => n + Number(t[key] || 0), 0);
      const amountTarget = sumField(amounts, "targetAmount");
      const amountAchieved = sumField(amounts, "achievedAmount");
      const registrationTarget = sumField(regs, "targetRegistrations");
      const registrationAchieved = sumField(regs, "achievedRegistrations");
      const single = targets.length === 1 ? targets[0] : null;
      const effective = !pnl && query.duration !== "today";
      const effectiveRevenue = Math.max(0, payment.revenue + (effective ? sumField(targets, "achievedAmount") - sumField(targets, "systemAmount") : 0));
      const effectiveCount = Math.max(0, payment.count + (effective ? sumField(targets, "achievedRegistrations") - sumField(targets, "systemRegistrations") : 0));
      const row = {
        _id: employee._id,

        employeeName: employee.employeeName,

        employeeCode: employee.employeeCode,

        employeePhoto: {
          url: employee.employeePhoto?.url,
        },

        designation: employee.designation,

        isActive: employee.isActive,

        isDeleted: Boolean(employee.isDeleted),

        revenue: effectiveRevenue,
        count: effectiveCount,
        registrations: effectiveCount,
        actualRevenue: payment.revenue,
        actualRegistrations: payment.count,

        targets,
        targetsAssigned: targets.length,
        amountTarget: amounts.length ? amountTarget : null,
        amountAchieved: amounts.length ? amountAchieved : null,
        registrationTarget: regs.length ? registrationTarget : null,
        registrationAchieved: regs.length ? registrationAchieved : null,
        amountAchievement: amountTarget > 0 ? amountAchieved / amountTarget * 100 : null,
        registrationAchievement: registrationTarget > 0 ? registrationAchieved / registrationTarget * 100 : null,
        targetRegistrations: single?.targetRegistrations ?? null,
        achievedRegistrations: single?.achievedRegistrations ?? 0,
        currentTarget,

        targetAchieved: Boolean(
          currentTarget?.targetAchieved
        ),

        currentAchievement:
          currentTarget?.achievement ?? null,

        achievementBasis:
          single?.achievementBasis ?? null,

        currentTargetAmount:
          currentTarget?.targetAmount ?? null,

        currentTargetRegistrations:
          currentTarget?.targetRegistrations ?? null,

        currentAchievedAmount:
          currentTarget?.achievedAmount ?? 0,

        currentAchievedRegistrations:
          currentTarget?.achievedRegistrations ?? 0,
      };

      if (!pnl) {
        return row;
      }

      // ======================================
      // SALARY CALCULATION
      // ======================================

      const history = await Salary.find({
        employeeId: employee._id,

        effectiveFrom: {
          $lt: new Date(end),
        },
      })
        .sort({ effectiveFrom: 1 })
        .lean();

      const expenses = await Expense.find({
        employeeId: employee._id,

        weekStart: {
          $lt: new Date(end),
        },

        weekEnd: {
          $gt: new Date(start),
        },
      }).lean();

      let salary = 0;
      let missingSalary = false;
      let leadCost = 0;
      let leads = 0;
      let miscellaneous = 0;

      const reportEnd = end;

      for (
        let date = start;
        date < reportEnd;
        date += DAY
      ) {
        if (
          date <
          day(local(employee.joiningDate))
        ) {
          continue;
        }

        if (
          employee.leavingDate &&
          date >
            day(local(employee.leavingDate))
        ) {
          continue;
        }

        const applicableSalary = history
          .filter(
            (item) =>
              +item.effectiveFrom <= date
          )
          .at(-1);

        if (!applicableSalary) {
          missingSalary = true;
          continue;
        }

        const currentDate = new Date(
          date + IST_OFFSET
        );

        const daysInMonth = new Date(
          Date.UTC(
            currentDate.getUTCFullYear(),
            currentDate.getUTCMonth() + 1,
            0
          )
        ).getUTCDate();

        const dayNumber =
          currentDate.getUTCDate();

        const monthlySalary =
          applicableSalary.monthlySalaryPaise;

        salary +=
          Math.round(
            (monthlySalary * dayNumber) /
              daysInMonth
          ) -
          Math.round(
            (monthlySalary * (dayNumber - 1)) /
              daysInMonth
          );
      }

      // ======================================
      // LEAD AND MISCELLANEOUS EXPENSES
      // ======================================

      for (const expense of expenses) {
        leadCost += allocate(
          expense.leadCostPaise || 0,
          start,
          end,
          expense.weekStart,
          expense.weekEnd
        );

        leads += allocate(
          expense.leadCount || 0,
          start,
          end,
          expense.weekStart,
          expense.weekEnd
        );

        miscellaneous += (
          expense.miscellaneousExpenses || []
        )
          .filter(
            (item) =>
              +item.expenseDate >= start &&
              +item.expenseDate < end
          )
          .reduce(
            (total, item) =>
              total + item.amountPaise,
            0
          );
      }

      const company = salary + miscellaneous;

      const total = company + leadCost;

      return {
        ...row,

        company,

        leads,

        leadCost,

        total,

        profit: payment.revenue - total,

        estimated: expenses.some(
          (item) =>
            start > +item.weekStart ||
            end < +item.weekEnd
        ),

        salaryHistoryMissing: missingSalary,
      };
    })
  );

  // Additional protection against displaying
  // deleted or inactive employees in sales reports.

 const visibleRows = rows.filter(
  (employee) =>
    !employee.isDeleted &&
    employee.isActive
);

  return visibleRows.sort((a, b) => {
    if (pnl) {
      return b.profit - a.profit;
    }

    return (
      Number(b.targetAchieved) -
        Number(a.targetAchieved) ||
      (b.currentAchievement ?? -1) -
        (a.currentAchievement ?? -1)
    );
  });
}

// ============================================
// PERFORMANCE ROUTES
// ============================================

app.get(
  "/api/performance",
  r(async (req, res) => {
    const rows = await report(req.query);

    res.json(rows);
  })
);

app.get(
  "/api/pnl",
  auth,
  r(async (req, res) => {
    const rows = await report(req.query, true);

    res.json(rows);
  })
);

// ============================================
// CURRENT EMPLOYEE TARGET ROUTE
// ============================================

app.get(
  "/api/employees/:id/current-target",
  r(async (req, res) => {
    const employee = await Employee.findOne({
      _id: oid(req.params.id),

      isActive: true,

      isDeleted: {
        $ne: true,
      },
    }).select(
      "employeeName employeeCode employeePhoto"
    );

    if (!employee) {
      throw bad("Employee unavailable", 404);
    }

    const target = await getCurrentTarget(
      employee._id
    );

    res.json({
      employeeId: employee._id,

      employeeName: employee.employeeName,

      employeeCode: employee.employeeCode,

      employeePhoto: employee.employeePhoto,

      currentTarget: target,

      targetAchieved: Boolean(
        target?.targetAchieved
      ),

      currentAchievement:
        target?.achievement ?? null,

      achievementBasis:
        target?.achievementBasis ?? null,

      currentTargetAmount:
        target?.targetAmount ?? null,

      currentTargetRegistrations:
        target?.targetRegistrations ?? null,

      currentAchievedAmount:
        target?.achievedAmount ?? 0,

      currentAchievedRegistrations:
        target?.achievedRegistrations ?? 0,
    });
  })
);

// ============================================
// MONTHLY BREAKDOWN
// ============================================

for (const mode of ["performance", "pnl"]) {
  const middleware =
    mode === "pnl" ? [auth] : [];

  app.get(
    `/api/${mode}/monthly-breakdown`,

    ...middleware,

    r(async (req, res) => {
      const month =
        req.query.month || local().slice(0, 7);

      day(`${month}-01`);

      const [year, monthNumber] = month
        .split("-")
        .map(Number);

      const weeks = await Week.find({
        year,
        month: monthNumber,
      }).sort({ startDate: 1 });

      const result = await Promise.all(
        weeks.map(async (week) => ({
          weekId: week._id,

          weekNumber: week.weekNumber,

          weekName: week.weekName,

          startDate: week.startDate,

          endDate: week.endDate,

          employees: await report(
            {
              ...req.query,
              weekId: week._id,
            },
            mode === "pnl"
          ),
        }))
      );

      res.json({
        month,
        weeks: result,
      });
    })
  );
}

// ============================================
// DAILY PERFORMANCE
// ============================================

app.get(
  "/api/performance/daily",
  r(async (req, res) => {
    const employeeId = oid(
      req.query.employeeId
    );

    const employee = await Employee.findOne({
      _id: employeeId,

      isActive: true,

      isDeleted: {
        $ne: true,
      },
    });

    if (!employee) {
      return res.json([]);
    }

    const [start, end] = await reportRange(
      req.query
    );

    const currentTarget =
      await getCurrentTarget(employeeId);

    const rows = [];

    const firstDay = Math.max(
      start,
      day(local(employee.joiningDate))
    );

    const lastDay = Math.min(
      end,
      day(local()) + DAY
    );

    for (
      let date = firstDay;
      date < lastDay;
      date += DAY
    ) {
      const payment = await actual(
        employeeId,
        date,
        date + DAY
      );

      rows.push({
        date: local(date),

        revenue: payment.revenue,

        count: payment.count,

        registrations: payment.count,

        targetAchieved: Boolean(
          currentTarget?.targetAchieved
        ),
      });
    }

    res.json(rows);
  })
);

// ============================================
// EVENT VALIDATION
// ============================================

function eventFields(body, partial = false) {
  const fields = {};

  for (const key of ["eventName", "eventCity"]) {
    if (!partial || key in body) {
      if (
        typeof body[key] !== "string" ||
        !body[key].trim()
      ) {
        throw bad(`${key} is required`);
      }

      fields[key] = body[key].trim();
    }
  }

  if (!partial || "eventDate" in body) {
    day(body.eventDate);

    fields.eventDate = new Date(
      body.eventDate
    );
  }

  if ("currentRegistration" in body) {
    fields.currentRegistration = integer(
      body.currentRegistration
    );
  }

  if ("isActive" in body) {
    if (typeof body.isActive !== "boolean") {
      throw bad("Invalid event status");
    }

    fields.isActive = body.isActive;
  }

  return fields;
}

// ============================================
// EVENT ROUTES
// ============================================

app.get(
  "/api/events",
  r(async (req, res) => {
    const events = await Event.find()
      .sort({ eventDate: 1 })
      .lean();

    res.json(events);
  })
);

app.get(
  "/api/events/active",
  r(async (req, res) => {
    const events = await Event.find({
      isActive: true,
    })
      .sort({ eventDate: 1 })
      .lean();

    res.json(events);
  })
);

app.get(
  "/api/events/:id",
  r(async (req, res) => {
    const event = await Event.findById(
      oid(req.params.id)
    );

    if (!event) {
      throw bad("Event not found", 404);
    }

    res.json(event);
  })
);

app.post(
  "/api/events",
  r(async (req, res) => {
    const event = await Event.create(
      eventFields(req.body)
    );

    io.emit("events:changed");

    res.status(201).json(event);
  })
);

app.patch(
  "/api/events/:id",
  r(async (req, res) => {
    const event = await Event.findByIdAndUpdate(
      oid(req.params.id),

      {
        $set: eventFields(req.body, true),
      },

      {
        new: true,
        runValidators: true,
      }
    );

    if (!event) {
      throw bad("Event not found", 404);
    }

    io.emit("events:changed");

    res.json(event);
  })
);

// ============================================
// CREATE PAYMENT
// ============================================

app.post(
  "/api/payments",
  r(async (req, res) => {
    const {
      employeeId,
      eventId,
      amount,
    } = req.body;

    oid(employeeId);
    oid(eventId);

    const amountPaise = money(amount);

    if (amountPaise <= 0) {
      throw bad("Payment amount must be positive");
    }

    let payment;
    let event;
    let employee;

    await mongoose.connection.transaction(
      async (session) => {
        // Deleted employees cannot receive payments.

        employee = await Employee.findOneAndUpdate(
          {
            _id: employeeId,

            isActive: true,

            isDeleted: {
              $ne: true,
            },
          },

          {
            $set: {
              updatedAt: new Date(),
            },
          },

          {
            new: true,
            session,
          }
        );

        if (!employee) {
          throw bad("Employee unavailable", 404);
        }

        event = await Event.findOneAndUpdate(
          {
            _id: eventId,
            isActive: true,
          },

          {
            $inc: {
              currentRegistration: 1,
            },
          },

          {
            new: true,
            session,
          }
        );

        if (!event) {
          throw bad("Event unavailable", 404);
        }

        [payment] = await Payment.create(
          [
            {
              employeeId: employee._id,

              employeeName:
                employee.employeeName,

              name: employee.employeeName,

              eventId: event._id,

              eventCity: event.eventCity,

              eventName: event.eventName,

              eventDate: event.eventDate,

              registrationCount:
                event.currentRegistration,

              amountPaise,
            },
          ],
          { session }
        );
      }
    );

    const payload = {
      ...payment.toObject(),

      photo: {
        url: employee.employeePhoto?.url,
      },
    };

    io.emit("payment:created", payload);

    io.emit("event:updated", event);

    changed();

    res.status(201).json(payload);
  })
);

// ============================================
// PAYMENT HISTORY
// ============================================

app.get(
  "/api/payments",
  r(async (req, res) => {
    const filter = {};

    if (req.query.employeeId) {
      filter.employeeId = oid(
        req.query.employeeId
      );
    }

    // Historical payments are retained even
    // after an employee has been deleted.

    const payments = await Payment.find(filter)
      .populate("employeeId", "employeePhoto")
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    res.json(
      payments.map((payment) => ({
        ...payment,

        photo:
          payment.employeeId?.employeePhoto ||
          payment.photo ||
          {},
      }))
    );
  })
);

// ============================================
// EMERGENCY ROUTES
// ============================================

app.get(
  "/api/emergencies/active",
  r(async (req, res) => {
    const emergencies = await Emergency.find({
      status: "Active",
    })
      .sort({ createdAt: 1 })
      .lean();

    res.json(emergencies);
  })
);

app.get(
  "/api/emergencies",
  r(async (req, res) => {
    const emergencies = await Emergency.find()
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    res.json(emergencies);
  })
);

// ============================================
// CREATE EMERGENCY
// ============================================

app.post(
  "/api/emergencies",
  upload.single("photo"),
  r(async (req, res) => {
    const { name, reason } = req.body;

    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 120 ||
      typeof reason !== "string" ||
      !reason.trim() ||
      reason.length > 500 ||
      !req.file
    ) {
      throw bad(
        "Name, reason and photo are required"
      );
    }

    let asset;
    let emergency;

    try {
      asset = await uploadPhoto(
        req.file,
        "jfw-emergencies"
      );

      emergency = await Emergency.create({
        name,

        reason,

        photo: asset,

        photoExpiresAt: new Date(
          Date.now() + 30 * DAY
        ),
      });
    } catch (error) {
      if (asset && !emergency) {
        await cloudinary.uploader
          .destroy(asset.publicId)
          .catch(console.error);
      }

      throw error;
    }

    io.emit("emergency:created", {
      id: emergency._id,
    });

    res.status(201).json(emergency);
  })
);

// ============================================
// RESOLVE EMERGENCY
// ============================================

app.patch(
  "/api/emergencies/:id/resolve",
  r(async (req, res) => {
    const emergency =
      await Emergency.findOneAndUpdate(
        {
          _id: oid(req.params.id),

          status: "Active",
        },

        {
          $set: {
            status: "Resolved",

            resolvedAt: new Date(),
          },
        },

        {
          new: true,
        }
      );

    if (!emergency) {
      throw bad(
        "Active emergency not found",
        404
      );
    }

    io.emit("emergency:resolved", {
      id: emergency._id,
    });

    res.json(emergency);
  })
);

// ============================================
// EMERGENCY PHOTO CLEANUP
// ============================================

async function cleanupPhotos() {
  const cursor = Emergency.find({
    "photo.publicId": {
      $exists: true,
      $ne: null,
    },

    $or: [
      {
        photoExpiresAt: {
          $lte: new Date(),
        },
      },

      {
        photoExpiresAt: {
          $exists: false,
        },

        createdAt: {
          $lte: new Date(
            Date.now() - 30 * DAY
          ),
        },
      },
    ],
  }).cursor();

  for await (const emergency of cursor) {
    try {
      const result =
        await cloudinary.uploader.destroy(
          emergency.photo.publicId,
          {
            invalidate: true,
          }
        );

      if (
        !["ok", "not found"].includes(
          result.result
        )
      ) {
        throw new Error(
          "Cloudinary deletion failed"
        );
      }

      await Emergency.updateOne(
        {
          _id: emergency._id,

          "photo.publicId":
            emergency.photo.publicId,
        },

        {
          $unset: {
            photo: "",
          },

          $set: {
            photoDeletedAt: new Date(),
          },
        }
      );
    } catch (error) {
      console.error(
        "Photo cleanup failed:",
        error
      );

      process.exitCode = 1;
    }
  }
}

// ============================================
// SOCKET.IO
// ============================================

io.on("connection", (socket) => {
  console.log(
    "Display connected:",
    socket.id
  );

  socket.on("disconnect", () => {
    console.log(
      "Display disconnected:",
      socket.id
    );
  });
});

// ============================================
// ROUTE NOT FOUND
// ============================================

app.use((req, res) => {
  res.status(404).json({
    success: false,

    message:
      `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// ============================================
// GLOBAL ERROR HANDLER
// ============================================

app.use((error, req, res, next) => {
  console.error(error);

  if (res.headersSent) {
    return next(error);
  }

  let status = error.status || 500;

  let message =
    error.message || "Internal server error";

  if (error.code === 11000) {
    status = 409;

    const field = Object.keys(
      error.keyPattern || {}
    ).join(", ");

    message = field
      ? `Duplicate record: ${field}`
      : "Duplicate record";
  }

  if (
    error instanceof
      mongoose.Error.ValidationError ||
    error instanceof
      mongoose.Error.CastError ||
    error instanceof multer.MulterError
  ) {
    status = 400;
  }

  res.status(status).json({
    success: false,

    message:
      status === 500
        ? "Unable to complete request"
        : message,
  });
});

// ============================================
// DATABASE CONNECTION
// ============================================

async function connectDB() {
  if (!MONGO_URI) {
    throw new Error(
      "MONGO_URI is required in .env"
    );
  }

  await mongoose.connect(MONGO_URI);

  console.log(
    "MongoDB connected successfully"
  );
}

// ============================================
// START SERVER
// ============================================

async function migrateAchievementBaselines() {
  for await (const target of Target.find({ "manualAchievement.enabled": true }).cursor()) {
    const m = target.manualAchievement;
    const week = target.weekId ? await Week.findById(target.weekId) : null;
    const start = week?.startDate || target.startDate;
    const end = week?.endDate || target.endDate;
    if (!start || !end) throw new Error(`Missing target dates: ${target._id}`);
    const stats = await actual(target.employeeId, start, end);
    for (const [field, baseline, value] of [["achievedAmountPaise", "baselineAmountPaise", stats.revenue], ["achievedRegistrations", "baselineRegistrations", stats.count]]) {
      if (m[field] == null || m[baseline] != null) continue;
      await Target.updateOne({ _id: target._id, [`manualAchievement.${baseline}`]: null }, { $set: { [`manualAchievement.${baseline}`]: value } });
    }
  }
}

async function startServer() {
  try {
    await connectDB();

    if (
      process.argv.includes("--cleanup")
    ) {
      try {
        await cleanupPhotos();

        console.log(
          "Emergency photo cleanup completed"
        );
      } finally {
        await mongoose.disconnect();
      }

      return;
    }

    await Promise.all([
      Event.init(),
      Employee.init(),
      Salary.init(),
      Week.init(),
      Target.init(),
      Payment.init(),
      Expense.init(),
      Emergency.init(),
    ]);

    await migrateAchievementBaselines();

    server.listen(
      PORT,
      "0.0.0.0",
      () => {
        console.log(
          `JFW server running on port ${PORT}`
        );

        console.log(
          "Socket.IO is ready"
        );

        console.log(
          "Allowed origins:",
          origins
        );
      }
    );
  } catch (error) {
    console.error(
      "Server startup failed:",
      error
    );

    process.exit(1);
  }
}

startServer();