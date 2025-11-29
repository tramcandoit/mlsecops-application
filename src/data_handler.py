import sys
import json
import pandas as pd
import numpy as np
import joblib
import requests
import os

# MLflow API URL
MLFLOW_API_URL = "http://localhost:5000/predict"

# Path to fitted preprocessor
PREPROCESSOR_PATH = os.path.join(os.path.dirname(__file__), 'preprocessor.pkl')

# Define features (same as training)
CATEGORICAL_FEATURES = ['payment_type', 'employment_status', 'housing_status', 'source', 'device_os']
NUMERICAL_FEATURES = [
    'income', 'name_email_similarity', 'prev_address_months_count', 'current_address_months_count',
    'customer_age', 'days_since_request', 'intended_balcon_amount', 'zip_count_4w',
    'velocity_6h', 'velocity_24h', 'velocity_4w', 'bank_branch_count_8w',
    'date_of_birth_distinct_emails_4w', 'credit_risk_score', 'email_is_free',
    'phone_home_valid', 'phone_mobile_valid', 'bank_months_count', 'has_other_cards',
    'proposed_credit_limit', 'foreign_request', 'session_length_in_minutes',
    'device_distinct_emails_8w', 'device_fraud_count', 'month'  # ADD month
]


def load_preprocessor():
    try:
        if not os.path.exists(PREPROCESSOR_PATH):
            print(f"Error: Preprocessor not found at {PREPROCESSOR_PATH}", file=sys.stderr)
            print("Run: python3 fit_preprocessor.py first", file=sys.stderr)
            return None

        preprocessor = joblib.load(PREPROCESSOR_PATH)
        return preprocessor
    except Exception as e:
        print(f"Error loading preprocessor: {e}", file=sys.stderr)
        return None


def preprocess_data(data_dict):
    preprocessor = load_preprocessor()
    if preprocessor is None:
        raise RuntimeError("Preprocessor not loaded. Run fit_preprocessor.py first.")

    # Convert to DataFrame
    df = pd.DataFrame([data_dict])

    # Ensure all features exist
    for feat in NUMERICAL_FEATURES + CATEGORICAL_FEATURES:
        if feat not in df.columns:
            df[feat] = None

    # Select only needed features in correct order
    df = df[NUMERICAL_FEATURES + CATEGORICAL_FEATURES]

    # Fill NaN for numerical features with 0
    for feat in NUMERICAL_FEATURES:
        if feat in df.columns:
            df[feat] = df[feat].fillna(0).infer_objects(copy=False)

    # Transform
    try:
        X_transformed = preprocessor.transform(df)
        return X_transformed[0]  # Return 1D array
    except Exception as e:
        raise RuntimeError(f"Error transforming data: {e}")


def predict_fraud(features):
    n_features = len(features)
    columns = [f"feature_{i}" for i in range(n_features)]

    payload = {
        "dataframe_split": {
            "columns": columns,
            "data": [features.tolist()]
        }
    }

    try:
        response = requests.post(
            MLFLOW_API_URL,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=10
        )

        if response.status_code != 200:
            raise RuntimeError(f"MLflow API error: {response.status_code} {response.text}")

        result = response.json()
        prediction = int(result["predictions"][0])
        return prediction

    except Exception as e:
        raise RuntimeError(f"Error calling MLflow API: {e}")


def main():
    try:
        # Read input from stdin
        input_data = sys.stdin.read()
        data_dict = json.loads(input_data)

        # Preprocess
        features = preprocess_data(data_dict)

        # Predict
        fraud_prediction = predict_fraud(features)

        # Output result
        result = {
            "fraud_bool": fraud_prediction,
            "n_features": len(features)
        }

        print(json.dumps(result))
        sys.exit(0)

    except Exception as e:
        error_result = {
            "error": str(e),
            "fraud_bool": 0
        }
        print(json.dumps(error_result), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
