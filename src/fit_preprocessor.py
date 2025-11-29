import pandas as pd
import joblib
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.compose import ColumnTransformer

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

def main():
    print("Loading Base.csv (training data)...")
    df = pd.read_csv('data/raw/Base.csv')

    # Remove rows with all NaN
    df = df.dropna(how='all')

    print(f"Loaded {len(df)} rows")

    # Drop fraud_bool only (keep month)
    features_df = df.drop(columns=['fraud_bool'], errors='ignore')

    # Select only needed features
    features_df = features_df[NUMERICAL_FEATURES + CATEGORICAL_FEATURES]

    print(f"Features shape: {features_df.shape}")

    # Create preprocessor
    preprocessor = ColumnTransformer(
        transformers=[
            ('num', StandardScaler(), NUMERICAL_FEATURES),
            ('cat', OneHotEncoder(sparse_output=False, drop='first'), CATEGORICAL_FEATURES)
        ]
    )

    # Fit preprocessor
    print("Fitting preprocessor...")
    preprocessor.fit(features_df)

    # Save to pickle
    joblib.dump(preprocessor, 'preprocessor.pkl')
    print("Preprocessor saved to preprocessor.pkl")

    # Test transform
    X_transformed = preprocessor.transform(features_df.head(1))
    print(f"Test transform: {X_transformed.shape[1]} features")
    print(f"First 10 features: {X_transformed[0][:10]}")

if __name__ == "__main__":
    main()
