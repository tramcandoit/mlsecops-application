const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const crypto = require("crypto");

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");

const { spawn } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE_NAME = process.env.TABLE_NAME || "silver-table";

const ddbClient = new DynamoDBClient({ region: REGION });
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

const uuidv4 = () => crypto.randomUUID();

// ==========================================
//  UTILITIES: PYTHON PREDICTION SERVICE
// ==========================================

/**
 * Call Python service to preprocess and predict fraud
 * @param {Object} dataDict - Data without fraud_bool, month, ID
 * @returns {Promise<number>} - Predicted fraud_bool (0 or 1)
 */
function callPythonPredictService(dataDict) {
  return new Promise((resolve, reject) => {
    // Use python3 from virtualenv if available
    const pythonPath = 'python3';
    const python = spawn(pythonPath, ['./src/data_handler.py']);

    let outputData = '';
    let errorData = '';

    python.stdout.on('data', (data) => {
      outputData += data.toString();
    });

    python.stderr.on('data', (data) => {
      errorData += data.toString();
      console.error('Python stderr:', data.toString());
    });

    python.on('close', (code) => {
      if (code !== 0) {
        console.error('Python process error:', errorData);
        reject(new Error('Prediction service failed'));
      } else {
        try {
          const result = JSON.parse(outputData);
          resolve(result.fraud_bool || 0);
        } catch (e) {
          console.error('Error parsing Python output:', e);
          reject(new Error('Failed to parse prediction result'));
        }
      }
    });

    // Send input data to Python via stdin
    python.stdin.write(JSON.stringify(dataDict));
    python.stdin.end();
  });
}



// ==========================================
//  API: USER REGISTER (UPLOAD CSV DATA)
// ==========================================
app.post("/register", async (req, res) => {
  try {
    const ID = uuidv4();

    // USER INPUT
    const {
      name,
      email,
      phone,
      userData
    } = req.body;

    if (!name || !email || !phone || !userData) {
      return res.status(400).json({ success: false, msg: "Missing required fields" });
    }

    // Desired column order: ID, fraud_bool, then features from samples.csv
    const featureOrder = [
      'income', 'name_email_similarity', 'prev_address_months_count', 'current_address_months_count',
      'customer_age', 'days_since_request', 'intended_balcon_amount', 'payment_type', 'zip_count_4w',
      'velocity_6h', 'velocity_24h', 'velocity_4w', 'bank_branch_count_8w', 'date_of_birth_distinct_emails_4w',
      'employment_status', 'credit_risk_score', 'email_is_free', 'housing_status', 'phone_home_valid',
      'phone_mobile_valid', 'bank_months_count', 'has_other_cards', 'proposed_credit_limit', 'foreign_request',
      'source', 'session_length_in_minutes', 'device_os', 'keep_alive_session', 'device_distinct_emails_8w',
      'device_fraud_count', 'month'
    ];

    // Use uploaded data directly
    const dataForPython = { ...userData };
    // Ensure types are correct
    Object.keys(dataForPython).forEach(key => {
      if (!isNaN(dataForPython[key])) {
        dataForPython[key] = parseFloat(dataForPython[key]);
      }
    });

    // Call Python service to preprocess and predict fraud
    console.log("Calling Python prediction service...");

    let fraud_bool;
    try {
      fraud_bool = await callPythonPredictService(dataForPython);
      console.log(`Fraud prediction: ${fraud_bool}`);
    } catch (err) {
      console.error('Prediction failed:', err);
      return res.status(503).json({
        success: false,
        msg: "Prediction service unavailable. Please try again in a moment." 
      });
    }

    // Create item to save with correct order: ID, fraud_bool, features
    const itemToSave = {};
    itemToSave.ID = ID;
    itemToSave.fraud_bool = fraud_bool;
    itemToSave.timestamp = new Date().toISOString();
    itemToSave.confirmed_fraud = false;
    itemToSave.status_history = [{
      timestamp: new Date().toISOString(),
      status: fraud_bool === 1 ? 'suspected_fraud' : 'approved',
      fraud_bool: fraud_bool
    }];
    featureOrder.forEach(key => {
      itemToSave[key] = userData[key] !== undefined ? (isNaN(userData[key]) ? userData[key] : parseFloat(userData[key])) : 0;
    });

    // Save to DynamoDB
    const command = new PutCommand({
      TableName: TABLE_NAME,
      Item: itemToSave,
    });

    await ddbDocClient.send(command);

    res.json({
      success: true,
      ID,
      fraud_bool,
      message: "User registration successful",
    });

  } catch (err) {
    console.error("Error saving:", err);
    res.status(500).json({ success: false });
  }
});

// ==========================================
//  API: GET USER BY ID
// ==========================================
app.get("/register/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await ddbDocClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "ID = :id",
        ExpressionAttributeValues: { ":id": id }
      })
    );

    if (result.Items && result.Items.length > 0) {
      res.json({ success: true, item: result.Items[0] });
    } else {
      res.status(404).json({ success: false, msg: "Not found" });
    }
  } catch (err) {
    console.error("Error fetching:", err);
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

    const desiredOrder = [
      'fraud_bool', 'income', 'name_email_similarity', 'prev_address_months_count', 'current_address_months_count',
      'customer_age', 'days_since_request', 'intended_balcon_amount', 'payment_type', 'zip_count_4w',
      'velocity_6h', 'velocity_24h', 'velocity_4w', 'bank_branch_count_8w', 'date_of_birth_distinct_emails_4w',
      'employment_status', 'credit_risk_score', 'email_is_free', 'housing_status', 'phone_home_valid',
      'phone_mobile_valid', 'bank_months_count', 'has_other_cards', 'proposed_credit_limit', 'foreign_request',
      'source', 'session_length_in_minutes', 'device_os', 'keep_alive_session', 'device_distinct_emails_8w',
      'device_fraud_count', 'month'
    ];

    // Sort by timestamp descending and organize keys
    const sortedItems = (result.Items || [])
      .sort((a, b) => {
        const timeA = a.timestamp || '';
        const timeB = b.timestamp || '';
        return timeB.localeCompare(timeA);
      })
      .map(item => {
        const sortedItem = {};
        desiredOrder.forEach(key => {
          if (item[key] !== undefined) {
            sortedItem[key] = item[key];
          }
        });
        Object.keys(item).forEach(key => {
          if (!desiredOrder.includes(key)) {
            sortedItem[key] = item[key];
          }
        });
        return sortedItem;
      });

    res.json({ items: sortedItems });
  } catch (err) {
    console.error("Error reading:", err);
    res.status(500).json({ success: false });
  }
});

// ==========================================
//  ADMIN: GET WAITING FOR APPROVAL (fraud_bool=1)
// ==========================================
app.get("/admin/waiting-data", async (req, res) => {
  try {
    const result = await ddbDocClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "fraud_bool = :val",
        ExpressionAttributeValues: { ":val": 1 }
      })
    );

    const desiredOrder = [
      'fraud_bool', 'income', 'name_email_similarity', 'prev_address_months_count', 'current_address_months_count',
      'customer_age', 'days_since_request', 'intended_balcon_amount', 'payment_type', 'zip_count_4w',
      'velocity_6h', 'velocity_24h', 'velocity_4w', 'bank_branch_count_8w', 'date_of_birth_distinct_emails_4w',
      'employment_status', 'credit_risk_score', 'email_is_free', 'housing_status', 'phone_home_valid',
      'phone_mobile_valid', 'bank_months_count', 'has_other_cards', 'proposed_credit_limit', 'foreign_request',
      'source', 'session_length_in_minutes', 'device_os', 'keep_alive_session', 'device_distinct_emails_8w',
      'device_fraud_count', 'month'
    ];

    const sortedItems = (result.Items || []).map(item => {
      const sortedItem = {};
      desiredOrder.forEach(key => {
        if (item[key] !== undefined) {
          sortedItem[key] = item[key];
        }
      });
      sortedItem.ID = item.ID;
      return sortedItem;
    });

    res.json({ items: sortedItems });
  } catch (err) {
    console.error("Error reading:", err);
    res.status(500).json({ success: false });
  }
});

// ==========================================
//  ADMIN: UPDATE FRAUD_BOOL
// ==========================================
app.put("/admin/update-fraud/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { fraud_bool } = req.body;

    if (fraud_bool !== 0 && fraud_bool !== 1) {
      return res.status(400).json({ success: false, msg: "Invalid fraud_bool" });
    }

    // Get current item to append to history
    const getResult = await ddbDocClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "ID = :id",
        ExpressionAttributeValues: { ":id": id }
      })
    );

    if (!getResult.Items || getResult.Items.length === 0) {
      return res.status(404).json({ success: false, msg: "Item not found" });
    }

    const currentItem = getResult.Items[0];
    const statusHistory = currentItem.status_history || [];

    // Add new status to history
    statusHistory.push({
      timestamp: new Date().toISOString(),
      status: fraud_bool === 1 ? 'confirmed_fraud' : 'confirmed_safe',
      fraud_bool: fraud_bool,
      confirmed_by: 'admin'
    });

    const command = new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { ID: id },
      UpdateExpression: "SET fraud_bool = :val, confirmed_fraud = :confirmed, status_history = :history",
      ExpressionAttributeValues: {
        ":val": fraud_bool,
        ":confirmed": fraud_bool === 1,
        ":history": statusHistory
      },
      ConditionExpression: "attribute_exists(ID)"
    });

    await ddbDocClient.send(command);

    res.json({ success: true });
  } catch (err) {
    console.error("Error updating:", err);
    res.status(500).json({ success: false });
  }
});

// ==========================================
//  ADMIN: GET NON-FRAUD (fraud_bool=0)
// ==========================================
app.get("/admin/non-fraud-data", async (req, res) => {
  try {
    const result = await ddbDocClient.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "fraud_bool = :val",
        ExpressionAttributeValues: { ":val": 0 }
      })
    );

    const desiredOrder = [
      'fraud_bool', 'income', 'name_email_similarity', 'prev_address_months_count', 'current_address_months_count',
      'customer_age', 'days_since_request', 'intended_balcon_amount', 'payment_type', 'zip_count_4w',
      'velocity_6h', 'velocity_24h', 'velocity_4w', 'bank_branch_count_8w', 'date_of_birth_distinct_emails_4w',
      'employment_status', 'credit_risk_score', 'email_is_free', 'housing_status', 'phone_home_valid',
      'phone_mobile_valid', 'bank_months_count', 'has_other_cards', 'proposed_credit_limit', 'foreign_request',
      'source', 'session_length_in_minutes', 'device_os', 'keep_alive_session', 'device_distinct_emails_8w',
      'device_fraud_count', 'month'
    ];

    const sortedItems = (result.Items || []).map(item => {
      const sortedItem = {};
      desiredOrder.forEach(key => {
        if (item[key] !== undefined) {
          sortedItem[key] = item[key];
        }
      });
      sortedItem.ID = item.ID;
      return sortedItem;
    });

    res.json({ items: sortedItems });
  } catch (err) {
    console.error("Error reading:", err);
    res.status(500).json({ success: false });
  }
});

// ==========================================
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
