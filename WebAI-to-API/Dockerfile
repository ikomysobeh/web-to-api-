FROM python:3.12-slim

# Install Requirements
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Disable Python output buffering for real-time logs
ENV PYTHONUNBUFFERED=1

# Ensure the application source directory is discoverable by Python imports
ENV PYTHONPATH=/app/src

COPY requirements.txt .
RUN pip install --upgrade pip
RUN pip install --no-cache-dir -r requirements.txt

# Copy project files
COPY . .

# Default Port 
EXPOSE 6969

# Run Uvicorn server
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "6969", "--workers", "1", "--log-level", "info"]
