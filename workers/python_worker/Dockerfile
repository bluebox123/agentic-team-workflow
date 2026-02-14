FROM python:3.11-slim

WORKDIR /app

# install system deps for WeasyPrint
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    tar \
    libpango-1.0-0 \
    libharfbuzz0b \
    libpangoft2-1.0-0 \
    libgdk-pixbuf-xlib-2.0-0 \
    libgobject-2.0-0 \
    libcairo2 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# install tectonic (LaTeX engine) binary
ARG TECTONIC_VERSION=0.15.0
RUN curl -fsSL -o /tmp/tectonic.tar.gz \
      https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${TECTONIC_VERSION}/tectonic-${TECTONIC_VERSION}-x86_64-unknown-linux-gnu.tar.gz \
    && tar -xzf /tmp/tectonic.tar.gz -C /tmp \
    && mv /tmp/tectonic /usr/local/bin/tectonic \
    && chmod +x /usr/local/bin/tectonic \
    && rm -rf /tmp/tectonic.tar.gz

# install deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# copy worker code
COPY worker.py ai_helper.py latex_pdf.py ./

# Use environment variables provided by the platform (no local .env needed)
CMD ["sh", "-c", "python worker.py || sleep 1000"]
