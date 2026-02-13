FROM python:3.11-slim

WORKDIR /app

# install system deps for WeasyPrint
RUN apt-get update && apt-get install -y \
    libpango-1.0-0 \
    libharfbuzz0b \
    libpangoft2-1.0-0 \
    libgdk-pixbuf-xlib-2.0-0 \
    libgobject-2.0-0 \
    libcairo2 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# install deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# copy worker code
COPY worker.py ai_helper.py ./

# Use environment variables provided by the platform (no local .env needed)
CMD ["sh", "-c", "python worker.py || sleep 1000"]
