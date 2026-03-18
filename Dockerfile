FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY . .

# Train ML model if not exists
RUN python -c "import os; exec(open('train_model.py').read()) if not os.path.exists('ml/nba_model.joblib') else print('Model exists')"

# Expose port
EXPOSE 5000

# Run with eventlet for WebSocket support
CMD ["gunicorn", "--worker-class", "eventlet", "-w", "1", "--bind", "0.0.0.0:5000", "server:app"]
