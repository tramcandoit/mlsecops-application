const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const crypto = require("crypto");

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE_NAME = process.env.TABLE_NAME || "test-db";

const ddbClient = new DynamoDBClient({ region: REGION });
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

const uuidv4 = () => crypto.randomUUID();

// ==========================================
//  UTILITIES: FEATURE ENGINEERING (SIMULATION)
// ==========================================

// Calculate similarity: simple demo
function calcNameEmailSimilarity(name, email) {
  if (!name || !email) return 0;
  const cleanName = name.toLowerCase().replace(/\s+/g, "");
  const cleanEmail = email.toLowerCase();
  return cleanEmail.includes(cleanName[0])
    ? Math.random() * 0.5 + 0.5
    : Math.random() * 0.4;
}

// Fake risk scoring
function generateRiskScore() {
  return Number((Math.random() * 0.8).toFixed(2));
}

// Fake fraud model output
function generateFraudBool(riskScore) {
  return riskScore > 0.6 ? 1 : 0;
}

// Fake velocity based on history (no DB → random)
function generateVelocity() {
  return Math.floor(Math.random() * 5);
}

// Fake device fingerprint history
function generateDeviceFraudCount() {
  return Math.floor(Math.random() * 2);
}

// ==========================================
//  API: USER REGISTER (8 INPUT FIELDS ONLY)
// ==========================================
app.post("/register", async (req, res) => {
  try {
    const ID = uuidv4();

    // USER INPUT ONLY 8 FIELDS
    const {
      name,
      email,
      phone,
      address,
      date_of_birth,
      employment_status,
      income,
      device_os
    } = req.body;

    if (!name || !email || !phone) {
      return res.status(400).json({ success: false, msg: "Missing required fields" });
    }

    // ===========================
    // BACKEND AUTO GENERATE FEATURES
    // ===========================

    const riskScore = generateRiskScore();
    const fraud_bool = generateFraudBool(riskScore);

    const now = new Date();
    const item = {
      ID,
      event_timestamp: now.toISOString(),

      // USER PROVIDED (8 fields)
      user_name: name,
      user_email: email,
      user_phone: phone,
      user_address: address ?? null,
      user_dob: date_of_birth ?? null,
      employment_status: employment_status ?? null,
      income: income ?? null,
      device_os: device_os ?? null,

      // AUTO GENERATED
      fraud_bool,
      credit_risk_score: riskScore,

      name_email_similarity: calcNameEmailSimilarity(name, email),

      velocity_6h: generateVelocity(),
      velocity_24h: generateVelocity(),
      velocity_4w: generateVelocity(),

      phone_home_valid: true,
      phone_mobile_valid: true,

      email_is_free: email.includes("@gmail.com") || email.includes("@yahoo.com"),

      bank_months_count: Math.floor(Math.random() * 48),
      bank_branch_count_8w: Math.floor(Math.random() * 3),

      date_of_birth_distinct_emails_4w: 0,

      prev_address_months_count: Math.floor(Math.random() * 60),
      current_address_months_count: Math.floor(Math.random() * 60),

      proposed_credit_limit: Math.floor(Math.random() * 20000),
      foreign_request: false,

      has_other_cards: Math.random() > 0.7,
      device_fraud_count: generateDeviceFraudCount(),
      device_distinct_emails_8w: Math.floor(Math.random() * 4),

      session_length_in_minutes: Math.floor(Math.random() * 30),

      source: "web",
      keep_alive_session: false,
      zip_count_4w: Math.floor(Math.random() * 3),

      intended_balcon_amount: Math.floor(Math.random() * 8000),
      payment_type: "online",
      month: now.getMonth() + 1,
    };

    // Save to DynamoDB
    const command = new PutCommand({
      TableName: TABLE_NAME,
      Item: item,
    });

    await ddbDocClient.send(command);

    res.json({
      success: true,
      ID,
      message: "User registration successful",
    });

  } catch (err) {
    console.error("Error saving:", err);
    res.status(500).json({ success: false });
  }
});

// ==========================================
//  ADMIN: GET ALL USERS
// ==========================================
app.get("/admin/users-data", async (req, res) => {
  try {
    const result = await ddbDocClient.send(
      new ScanCommand({ TableName: TABLE_NAME })
    );

    res.json({ items: result.Items || [] });
  } catch (err) {
    console.error("Error reading:", err);
    res.status(500).json({ success: false });
  }
});

// ==========================================
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
