# mlsecops-application

## Quickstart

1. Clone & install:
   ```bash
   git clone https://github.com/tramcandoit/mlsecops-application.git
   cd mlsecops-application
   npm install
   pip install -r requirements.txt
   ```

2. Setup preprocessor (if there is no src/fit_preprocessor.py):
   ```bash
   # Place Base.csv in root directory
   python3 src/fit_preprocessor.py
   ```

3. Run:
   ```bash
   npm start
   ```

4. Open `http://localhost:3000`