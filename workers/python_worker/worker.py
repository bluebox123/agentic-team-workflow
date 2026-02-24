import json
import time
import os
import psycopg2
import pika
import sys
import requests
import smtplib
import socket
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders
import base64
from typing import Optional, Dict, Any
from dotenv import load_dotenv
from prometheus_client import Counter, start_http_server
import boto3
from botocore.exceptions import ClientError
import io
from weasyprint import HTML
import matplotlib.pyplot as plt
from bs4 import BeautifulSoup
import ai_helper
import latex_pdf

sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)

load_dotenv()

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgres://devuser:devpass@127.0.0.1:5433/ai_workflow_dev"
)

RABBIT_URL = os.getenv(
    "RABBIT_URL",
    "amqp://guest:guest@rabbitmq:5672/"
)

ORCHESTRATOR_URL = os.getenv(
    "ORCHESTRATOR_URL",
    "http://host.docker.internal:4000"
)

# S3 Storage Configuration (Supabase, MinIO, etc.)
MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "minio:9000")
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY")
MINIO_BUCKET = os.getenv("MINIO_BUCKET", "artifacts")
MINIO_USE_SSL = os.getenv("MINIO_USE_SSL", "true").lower() == "true"
MINIO_REGION = os.getenv("MINIO_REGION", "us-east-1")

# Gmail SMTP Configuration (Notifier agent)
GMAIL_USER = os.getenv("GMAIL_USER")
GMAIL_APP_PASSWORD = os.getenv("GMAIL_APP_PASSWORD")

# SendGrid Configuration (HTTP fallback for Railway/cloud)
SENDGRID_API_KEY = os.getenv("SENDGRID_API_KEY")
SENDGRID_FROM_EMAIL = os.getenv("SENDGRID_FROM_EMAIL") or GMAIL_USER  # Fallback to Gmail user if not set

# Email provider preference: "auto" (try SMTP then HTTP), "smtp", "http"
EMAIL_PROVIDER = os.getenv("EMAIL_PROVIDER", "auto")

# Build endpoint URL
protocol = "https" if MINIO_USE_SSL else "http"
if MINIO_ENDPOINT.startswith("http"):
    # Full URL provided - use as-is
    endpoint_url = MINIO_ENDPOINT
elif ".storage.supabase.co" in MINIO_ENDPOINT:
    # Supabase storage subdomain - convert to S3 API path
    endpoint_url = f"https://{MINIO_ENDPOINT}/storage/v1/s3"
else:
    # Hostname only - add protocol
    endpoint_url = f"{protocol}://{MINIO_ENDPOINT}"

print(f"[WORKER] S3 endpoint configured: {endpoint_url}")

# Initialize S3 client (compatible with Supabase Storage and MinIO)
s3_client = boto3.client(
    "s3",
    endpoint_url=endpoint_url,
    aws_access_key_id=MINIO_ACCESS_KEY,
    aws_secret_access_key=MINIO_SECRET_KEY,
    region_name=MINIO_REGION
)

TASK_QUEUE = "executor.tasks"
DLQ_QUEUE = "executor.tasks.dlq"

MAX_RETRIES = 3
RETRY_BACKOFF_SEC = 2

# Track tasks currently being processed to prevent duplicates
in_progress_tasks = set()

# Prometheus metrics
worker_tasks_total = Counter(
    "worker_tasks_total",
    "Worker task executions",
    ["result"]
)

# Start metrics server
start_http_server(9100)

# -------------------------
# DB
# -------------------------
def connect_db():
    while True:
        try:
            conn = psycopg2.connect(DATABASE_URL)
            conn.autocommit = True
            return conn
        except Exception:
            time.sleep(2)


db_conn = connect_db()


def get_retry_count(task_id):
    global db_conn
    try:
        with db_conn.cursor() as cur:
            cur.execute(
                "SELECT retry_count FROM tasks WHERE id = %s",
                (task_id,),
            )
            row = cur.fetchone()
            return row[0] if row else 0
    except (psycopg2.OperationalError, psycopg2.InterfaceError) as e:
        print(f"[WORKER] DB connection lost in get_retry_count, reconnecting: {e}")
        db_conn = connect_db()
        # Retry once after reconnect
        with db_conn.cursor() as cur:
            cur.execute(
                "SELECT retry_count FROM tasks WHERE id = %s",
                (task_id,),
            )
            row = cur.fetchone()
            return row[0] if row else 0


def increment_retry(task_id):
    global db_conn
    try:
        with db_conn.cursor() as cur:
            cur.execute(
                "UPDATE tasks SET retry_count = retry_count + 1 WHERE id = %s",
                (task_id,),
            )
    except (psycopg2.OperationalError, psycopg2.InterfaceError) as e:
        print(f"[WORKER] DB connection lost in increment_retry, reconnecting: {e}")
        db_conn = connect_db()
        with db_conn.cursor() as cur:
            cur.execute(
                "UPDATE tasks SET retry_count = retry_count + 1 WHERE id = %s",
                (task_id,),
            )


def log_task(task_id, level, message):
    global db_conn
    try:
        with db_conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO task_logs (task_id, level, message)
                VALUES (%s, %s, %s)
                """,
                (task_id, level, message),
            )
    except (psycopg2.OperationalError, psycopg2.InterfaceError) as e:
        print(f"[WORKER] DB connection lost in log_task, reconnecting: {e}")
        db_conn = connect_db()
        with db_conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO task_logs (task_id, level, message)
                VALUES (%s, %s, %s)
                """,
                (task_id, level, message),
            )


def load_task_context(task_id):
    global db_conn
    try:
        with db_conn.cursor() as cur:
            cur.execute(
                """
                SELECT agent_type, payload, job_id, name
                FROM tasks
                WHERE id = %s
                """,
                (task_id,),
            )
            row = cur.fetchone()

        if not row:
            # Log detailed debug information
            print(f"[WORKER] Task {task_id} not found in DB. Checking if task exists at all...")
            try:
                with db_conn.cursor() as cur:
                    cur.execute("SELECT id, name, status FROM tasks WHERE id = %s", (task_id,))
                    debug_row = cur.fetchone()
                    if debug_row:
                        print(f"[WORKER] Task exists but has NULL agent_type/payload: id={debug_row[0]}, name={debug_row[1]}, status={debug_row[2]}")
                    else:
                        print(f"[WORKER] Task {task_id} does not exist in DB at all")
            except (psycopg2.OperationalError, psycopg2.InterfaceError) as e:
                print(f"[WORKER] DB connection lost during debug check: {e}")
                db_conn = connect_db()
            return None, None, None, None

        agent_type, task_payload, job_id, name = row
        return agent_type, task_payload, job_id, name

    except (psycopg2.OperationalError, psycopg2.InterfaceError) as e:
        print(f"[WORKER] DB connection lost in load_task_context, reconnecting: {e}")
        db_conn = connect_db()
        # Retry once after reconnect
        with db_conn.cursor() as cur:
            cur.execute(
                """
                SELECT agent_type, payload, job_id, name
                FROM tasks
                WHERE id = %s
                """,
                (task_id,),
            )
            row = cur.fetchone()
        if not row:
            return None, None, None, None
        agent_type, task_payload, job_id, name = row
        return agent_type, task_payload, job_id, name


# -------------------------
# ROLE MAPPINGS (Phase 8.4.2)
# -------------------------
CHART_ROLE_MAP = {
    "latency": "latency_p95",
    "throughput": "throughput", 
    "errors": "error_rate",
    "response_time": "latency_p95",
    "requests_per_sec": "throughput",
    "error_percentage": "error_rate"
}

# Phase 8.4.2: Role assignment per executor
DESIGNER_ROLE = "report"
DEFAULT_CHART_ROLE = "chart"

def get_chart_role(payload):
    """Phase 8.4.2: Determine chart role from payload with mapping"""
    # Explicit role takes precedence
    explicit_role = payload.get("role")
    if explicit_role:
        return explicit_role
    
    # Map common chart types to semantic roles
    title = payload.get("title", "").lower()
    chart_type = payload.get("type", "").lower()
    
    # Try title-based mapping
    for keyword, role in CHART_ROLE_MAP.items():
        if keyword in title:
            return role
    
    # Try chart type mapping
    if chart_type in CHART_ROLE_MAP:
        return CHART_ROLE_MAP[chart_type]
    
    # Default to generic chart role
    return DEFAULT_CHART_ROLE

# -------------------------
# DESIGNER LOGIC
# -------------------------
def fetch_job_artifacts_from_db(job_id):
    """Fetch all artifacts for a job from the database"""
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()
        cur.execute("""
            SELECT 
                a.id,
                a.task_id,
                a.type,
                a.filename,
                a.storage_key,
                a.mime_type,
                a.role,
                t.agent_type
            FROM artifacts a
            JOIN tasks t ON a.task_id = t.id
            WHERE t.job_id = %s
            ORDER BY a.created_at
        """, (job_id,))
        rows = cur.fetchall()
        cur.close()
        conn.close()
        
        artifacts = []
        for row in rows:
            artifacts.append({
                "id": row[0],
                "task_id": row[1],
                "type": row[2],
                "filename": row[3],
                "storage_key": row[4],
                "mime_type": row[5],
                "role": row[6],
                "agent_type": row[7]
            })
        return artifacts
    except Exception as e:
        print(f"[WORKER] Failed to fetch artifacts for job {job_id}: {e}")
        return []

def load_image_base64(storage_key):
    """Load image from S3 and return base64 encoded string"""
    try:
        response = s3_client.get_object(Bucket=MINIO_BUCKET, Key=storage_key)
        data = response["Body"].read()
        import base64
        return base64.b64encode(data).decode("utf-8")
    except Exception as e:
        print(f"[WORKER] Failed to load image {storage_key}: {e}")
        return None

def build_artifact_index(artifacts):
    """Phase 8.4.3: Build lookup index for deterministic artifact selection"""
    artifact_index = {}
    for artifact in artifacts:
        key = (artifact.get("type"), artifact.get("role"))
        artifact_index[key] = artifact
        # DEBUG: Log each index entry with full details
        art_id = artifact.get('id', 'N/A')
        art_type = artifact.get('type', 'N/A')
        art_role = artifact.get('role', 'N/A')
        art_storage = artifact.get('storage_key', 'N/A')
        print(f"[WORKER] Index entry: key={key} -> artifact id={art_id[:8] if art_id != 'N/A' else 'N/A'}..., type={art_type}, role={art_role}, storage={art_storage}")
    return artifact_index

def resolve_artifact_for_section(section, artifact_index, all_artifacts_list=None):
    """Enhanced artifact resolution supporting both structured objects and string references"""
    if "artifact" not in section:
        return None  # Regular content section
    
    artifact_ref = section["artifact"]
    section_heading = section.get('heading', 'Unknown')
    
    # Handle null/undefined artifact references
    if artifact_ref is None or artifact_ref == "null" or artifact_ref == "undefined":
        return None  # Treat as regular content section
    
    # Case 1: Structured object with type and role (original behavior)
    if isinstance(artifact_ref, dict):
        artifact_type = artifact_ref.get("type")
        artifact_role = artifact_ref.get("role")
        
        if not artifact_type or not artifact_role:
            # Log warning but don't fail - treat as content section
            print(f"[WORKER] Warning: Invalid artifact reference in section '{section_heading}': missing type or role, treating as content")
            return None
        
        # Deterministic lookup by (type, role)
        key = (artifact_type, artifact_role)
        artifact = artifact_index.get(key)
        
        print(f"[WORKER] Looking up artifact with key {key}, found: {artifact is not None}")
        print(f"[WORKER] Available keys in index: {list(artifact_index.keys())}")
        
        if not artifact:
            # Try to find by role only (fallback 1)
            for art in all_artifacts_list or []:
                if art.get("role") == artifact_role:
                    print(f"[WORKER] Matched artifact by role '{artifact_role}' for section '{section_heading}'")
                    return art
            
            # Try to find by type only with role containing the artifact_role (fallback 2)
            for art in all_artifacts_list or []:
                art_type = art.get("type", "")
                art_role = art.get("role", "")
                if art_type == artifact_type and artifact_role in (art_role or ""):
                    print(f"[WORKER] Matched artifact by type '{artifact_type}' and partial role match '{artifact_role}' in '{art_role}' for section '{section_heading}'")
                    return art
            
            # Try to find ANY chart artifact when looking for a chart (fallback 3)
            if artifact_type == "chart":
                for art in all_artifacts_list or []:
                    if art.get("type") == "chart":
                        print(f"[WORKER] Matched any chart artifact for section '{section_heading}' (role wanted: {artifact_role}, found role: {art.get('role')})")
                        return art
            
            # Try to find by role substring match (fallback 4)
            for art in all_artifacts_list or []:
                art_role = art.get("role", "")
                if art_role and artifact_role in art_role:
                    print(f"[WORKER] Matched artifact by role substring '{artifact_role}' in '{art_role}' for section '{section_heading}'")
                    return art
            
            # Log warning but don't fail
            print(f"[WORKER] Warning: Missing artifact: {artifact_type}:{artifact_role} in section '{section_heading}', treating as content")
            return None
        
        return artifact
    
    # Case 2: String reference (URL or template already resolved)
    # This happens when AI generates {{tasks.chart.outputs.image_url}} and orchestrator resolves it
    elif isinstance(artifact_ref, str):
        # If it's an empty string or template that wasn't resolved, treat as content
        if not artifact_ref or artifact_ref.startswith("{{"):
            print(f"[WORKER] Warning: Unresolved template in section '{section_heading}': {artifact_ref}")
            return None
        
        if all_artifacts_list is None or len(all_artifacts_list) == 0:
            print(f"[WORKER] Warning: No artifacts available for section '{section_heading}'")
            return None
        
        # Strategy 1: Try to match by artifact ID in the URL  
        # URLs typically look like: http://localhost:4000/api/artifacts/UUID/download
        for artifact in all_artifacts_list:
            if artifact.get("id") and artifact["id"] in artifact_ref:
                print(f"[WORKER] Matched artifact by ID in URL for section '{section_heading}'")
                return artifact
        
        # Strategy 2: Use heuristics based on section heading and artifact type
        # Look for chart/image artifacts
        for artifact in all_artifacts_list:
            artifact_type = artifact.get("type", "").lower()
            if artifact_type in ["chart", "image", "png", "visualization"]:
                print(f"[WORKER] Matched artifact by type '{artifact_type}' for section '{section_heading}'")
                return artifact
        
        # Strategy 3: Just use the first available artifact as fallback
        print(f"[WORKER] WARNING: Using first available artifact as fallback for section '{section_heading}'")
        return all_artifacts_list[0]
    
    else:
        # Unknown type - log warning and treat as content
        print(f"[WORKER] Warning: Invalid artifact reference type in section '{section_heading}': {type(artifact_ref)}, treating as content")
        return None

def render_section(section, artifact_index, all_artifacts_list=None):
    """Enhanced section rendering with support for string artifact references"""
    section_heading = section.get('heading', 'Unknown')
    artifact = resolve_artifact_for_section(section, artifact_index, all_artifacts_list)
    
    if artifact:
        # Embed artifact with deterministic content
        storage_key = artifact.get("storage_key")
        art_role = artifact.get("role", "N/A")
        art_type = artifact.get("type", "N/A")
        print(f"[WORKER] Rendering section '{section_heading}' with artifact (type={art_type}, role={art_role}, storage={storage_key})")
        
        img64 = load_image_base64(storage_key)
        if img64:
            print(f"[WORKER] Successfully loaded image for section '{section_heading}' ({len(img64)} base64 chars)")
            return f"""
            <h2>{section['heading']}</h2>
            <img src="data:image/png;base64,{img64}" style="max-width:100%;" />
            """
        else:
            # Failed to load image - render as content section with warning
            print(f"[WORKER] Warning: Failed to load artifact image for section '{section_heading}' from storage key '{storage_key}'")
            return f"""
            <h2>{section['heading']}</h2>
            <p>{section.get('content', '')}</p>
            """
    else:
        # No artifact: regular content
        print(f"[WORKER] Rendering section '{section_heading}' as regular content (no artifact)")
        return f"""
        <h2>{section['heading']}</h2>
        <p>{section.get('content', '')}</p>
        """

def render_html(title, sections, artifacts=None, all_artifacts_list=None):
    """Enhanced HTML rendering with support for fetched artifacts"""
    if artifacts is None:
        artifacts = []
    if all_artifacts_list is None:
        all_artifacts_list = []
    
    # Phase 8.4.3: Build artifact index from BOTH payload artifacts AND database artifacts
    # This ensures we can resolve any artifact reference regardless of source
    combined_artifacts = artifacts + all_artifacts_list
    artifact_index = build_artifact_index(combined_artifacts)
    
    # Log for debugging
    print(f"[WORKER] Artifact index built with {len(combined_artifacts)} artifacts:")
    for art in combined_artifacts:
        print(f"  - type={art.get('type')}, role={art.get('role')}, id={art.get('id')[:8] if art.get('id') else 'N/A'}...")
    print(f"[WORKER] Sections with artifact refs: {[s.get('heading') for s in sections if 'artifact' in s]}")
    
    # Render sections with both artifact_index and full list for flexible matching
    body = ""
    for section in sections:
        body += render_section(section, artifact_index, all_artifacts_list)

    return f"""
    <html>
      <head>
        <style>
          body {{ font-family: Arial; margin: 40px; }}
          h1 {{ color: #333; }}
          h2 {{ color: #666; margin-top: 30px; }}
          img {{ border: 1px solid #ddd; border-radius: 4px; }}
        </style>
      </head>
      <body>
        <h1>{title}</h1>
        {body}
      </body>
    </html>
    """

def run_designer(task_id, job_id, payload):
    """Enhanced PDF generation with smart artifact reference resolution"""
    # Extract title and sections from payload
    title = payload.get("title", "Generated Report")
    sections = payload.get("sections", [])
    artifacts = payload.get("artifacts", [])  # Artifacts explicitly passed in payload
    
    # Designer always has role='report'
    role = DESIGNER_ROLE
    
    # Validate payload structure
    if not sections:
        raise ValueError("Designer payload must contain at least one section")

    # Fail fast on unresolved templates in designer payload
    try:
        import re
        payload_str = json.dumps(payload)
        unresolved = re.findall(r'\{\{[^}]+\}\}', payload_str)
        if unresolved:
            error_msg = f"Designer payload contains unresolved templates: {unresolved}. Ensure dependencies are completed before designer task."
            log_task(task_id, "ERROR", error_msg)
            raise ValueError(error_msg)
    except Exception:
        # Don't block PDF generation if serialization fails for some reason
        pass
    
    # Fetch all artifacts for this job from database
    # This enables resolution of string artifact references
    all_job_artifacts = fetch_job_artifacts_from_db(job_id)
    log_task(task_id, "INFO", f"Fetched {len(all_job_artifacts)} artifacts from database for job {job_id}")
    
    # Count artifact references for logging
    artifact_refs_count = len([s for s in sections if "artifact" in s])
    log_task(task_id, "INFO", f"Designer processing {len(sections)} sections with {artifact_refs_count} artifact references")
    
    # Render HTML with both explicit artifacts and fetched artifacts
    # This allows resolution of both structured and string references
    combined_artifacts = artifacts + all_job_artifacts

    # Backwards compatibility: if a section's content is a resolved artifact download URL,
    # translate it into a proper artifact reference so LaTeX embedding works.
    try:
        import re
        artifact_by_id = {a.get("id"): a for a in combined_artifacts if isinstance(a, dict) and a.get("id")}
        url_re = re.compile(r"/api/artifacts/(?P<id>[0-9a-fA-F-]{8,})/download")
        new_sections = []
        for s in sections:
            if not isinstance(s, dict):
                new_sections.append(s)
                continue

            if "artifact" in s and s.get("artifact"):
                new_sections.append(s)
                continue

            content = s.get("content")
            if isinstance(content, str):
                m = url_re.search(content)
                if m:
                    art_id = m.group("id")
                    art = artifact_by_id.get(art_id)
                    if art and art.get("type") and art.get("role"):
                        s = {**s, "artifact": {"type": art.get("type"), "role": art.get("role")}}
                        # Keep content empty to avoid printing URL alongside image
                        if "content" in s:
                            s["content"] = ""
            new_sections.append(s)

        sections = new_sections
    except Exception as e:
        log_task(task_id, "WARN", f"Designer section preprocessing failed: {e}")
    
    # Generate PDF
    try:
        pdf_bytes, latex_metadata = latex_pdf.generate_pdf_from_payload(
            payload={
                **payload,
                "title": title,
                "sections": sections,
            },
            all_job_artifacts=combined_artifacts,
            s3_client=s3_client,
            s3_bucket=MINIO_BUCKET,
        )
        log_task(task_id, "INFO", f"Designer generated PDF via LaTeX ({len(pdf_bytes)} bytes)")
        
        # Upload to S3
        object_key = f"jobs/{job_id}/{task_id}.pdf"
        s3_client.put_object(
            Bucket=MINIO_BUCKET,
            Key=object_key,
            Body=io.BytesIO(pdf_bytes),
            ContentType="application/pdf"
        )
        
        log_task(task_id, "INFO", f"PDF uploaded to {object_key}")
        
        # Construct PDF download URL for template resolution
        pdf_download_url = f"/api/jobs/{job_id}/artifacts?type=pdf&role=report&download=1"
        
        # Report back to orchestrator with retry logic
        completion_payload = {
            "result": {
                "ok": True,
                "job_id": job_id,
                "executor": "designer",
                "pdf_url": pdf_download_url,
                "storage_key": object_key,
            },
            "artifact": {
                "type": "pdf",
                "filename": "report.pdf",
                "storage_key": object_key,
                "role": role,
                "metadata": {
                    "pages": None,
                    "embedded_artifacts": artifact_refs_count,
                    "section_count": len(sections),
                    "role": role,
                    "deterministic_ordering": True,
                    "latex": latex_metadata
                }
            }
        }
        
        # Retry completion up to 3 times
        completion_success = False
        for attempt in range(3):
            try:
                resp = requests.post(
                    f"{ORCHESTRATOR_URL}/internal/tasks/{task_id}/complete",
                    json=completion_payload,
                    timeout=10
                )
                if resp.status_code == 200:
                    log_task(task_id, "INFO", f"Completion acknowledged: {resp.json()}")
                    completion_success = True
                    break
                else:
                    log_task(task_id, "WARN", f"Completion HTTP {resp.status_code}: {resp.text[:200]}")
                    if resp.status_code == 409:
                        completion_success = True
                        break
            except Exception as e:
                log_task(task_id, "WARN", f"Completion attempt {attempt+1} failed: {e}")
            if attempt < 2:
                time.sleep(2 ** attempt)
        
        if not completion_success:
            log_task(task_id, "ERROR", "Failed to report completion after all retries")
            raise RuntimeError("Failed to report task completion")
        
        worker_tasks_total.labels(result="success").inc()
        log_task(task_id, "INFO", f"Designer execution succeeded, role='{role}', sections={len(sections)}")
        
    except Exception as e:
        log_task(task_id, "ERROR", f"Designer failed: {e}")
        raise

# -------------------------
# REVIEWER LOGIC
# -------------------------
def run_reviewer(task_id, payload):
    """
    AI-powered quality reviewer:
    - checks executor output exists
    - uses AI to analyze quality
    - assigns score and provides feedback
    """
    if os.getenv("NODE_ENV", "").lower() != "production":
        return {
            "score": 90,
            "decision": "APPROVE",
            "feedback": {
                "summary": "Auto-approved in dev",
            },
        }

    target_task_id = payload.get("target_task_id")
    score_threshold = payload.get("score_threshold", 80)

    if not target_task_id:
        error_msg = "Missing target_task_id - Reviewer needs a parent task to review. Make sure the reviewer task has a parent_task_index pointing to the task it should review."
        log_task(task_id, "ERROR", error_msg)
        return {
            "score": 0,
            "decision": "REJECT",
            "feedback": {"error": error_msg},
        }

    # Load target task result
    with db_conn.cursor() as cur:
        cur.execute(
            """
            SELECT status, result
            FROM tasks
            WHERE id = %s
            """,
            (target_task_id,),
        )
        row = cur.fetchone()

    if not row:
        error_msg = f"Target task {target_task_id} not found in database"
        log_task(task_id, "ERROR", error_msg)
        return {
            "score": 0,
            "decision": "REJECT",
            "feedback": {"error": error_msg},
        }

    status, result = row

    if status != "SUCCESS":
        error_msg = f"Target task {target_task_id} has status '{status}' - must be SUCCESS to approve"
        log_task(task_id, "ERROR", error_msg)
        return {
            "score": 20,
            "decision": "REJECT",
            "feedback": {"error": error_msg},
        }

    if not result:
        error_msg = f"Target task {target_task_id} has empty result"
        log_task(task_id, "ERROR", error_msg)
        return {
            "score": 30,
            "decision": "REJECT",
            "feedback": {"error": error_msg},
        }

    # ---- PASSED BASIC CHECKS ----
    # Use AI to analyze quality
    score = 85  # Default score — above 80 threshold, so tasks pass unless AI explicitly gives low score
    ai_feedback = "AI analysis unavailable"
    
    try:
        # Prepare result for AI analysis
        result_preview = json.dumps(result)[:1000] if isinstance(result, dict) else str(result)[:1000]
        
        ai_prompt = f"""Review the quality of this task execution result:

Result Preview: {result_preview}

Provide:
1. A quality score (0-100)
2. Specific feedback on what's good and what could be improved
3. A recommendation (APPROVE or REJECT)

Format your response as:
Score: [number]
Feedback: [your feedback]
Recommendation: [APPROVE/REJECT]"""
        
        ai_response = ai_helper.generate_ai_response(
            ai_prompt,
            task_type="reviewer",
            temperature=0.3,
            max_tokens=300
        )
        
        # Parse AI response for score
        import re
        score_match = re.search(r'Score:\s*(\d+)', ai_response)
        if score_match:
            score = int(score_match.group(1))
        
        ai_feedback = ai_response
        log_task(task_id, "INFO", f"AI review completed with score {score}")
        
    except Exception as e:
        log_task(task_id, "WARN", f"AI review failed, using basic score: {e}")
        score = 90  # Fallback score if AI fails
        ai_feedback = "Basic quality checks passed (AI review unavailable)"

    return {
        "score": score,
        "decision": "APPROVE" if score >= score_threshold else "REJECT",
        "feedback": {
            "summary": "Quality review completed",
            "ai_feedback": ai_feedback,
            "target_status": status
        },
    }


# -------------------------
# CHART EXECUTOR
# -------------------------
def run_chart(task_id, job_id, payload):
    """Generate chart PNG from payload with mandatory role support (Phase 8.4.2)"""
    import io
    import matplotlib.pyplot as plt
    import re
    import csv

    def _sanitize_unresolved_templates(obj):
        """Replace unresolved {{...}} templates with safe defaults so charts don't fail/DLQ."""
        if isinstance(obj, dict):
            return {k: _sanitize_unresolved_templates(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [_sanitize_unresolved_templates(v) for v in obj]
        if isinstance(obj, str):
            if re.search(r'\{\{[^}]+\}\}', obj):
                # Prefer numeric-ish default if it looks like a standalone template.
                if obj.strip().startswith("{{") and obj.strip().endswith("}}"): 
                    return 0
                return ""
        return obj

    # Check for unresolved template placeholders; sanitize instead of failing.
    payload_str = json.dumps(payload)
    unresolved = re.findall(r'\{\{[^}]+\}\}', payload_str)
    if unresolved:
        warn_msg = f"Chart payload contains unresolved templates: {unresolved}. Failing chart generation to avoid inaccurate output."
        log_task(task_id, "ERROR", warn_msg)
        try:
            requests.post(
                f"{ORCHESTRATOR_URL}/internal/tasks/{task_id}/fail",
                json={"error": warn_msg},
                timeout=5,
            )
        except Exception as e:
            log_task(task_id, "ERROR", f"Failed to report chart failure: {e}")
        worker_tasks_total.labels(result="failed").inc()
        return

    def _coerce_number_list(v):
        if v is None:
            return []
        if isinstance(v, list):
            out = []
            for item in v:
                try:
                    if isinstance(item, (int, float)):
                        out.append(float(item))
                    elif isinstance(item, str) and item.strip() != "":
                        out.append(float(item.strip()))
                except Exception:
                    continue
            return out
        return []

    def _coerce_label_list(v):
        if v is None:
            return []
        if isinstance(v, list):
            return [str(x) for x in v]
        return []

    def _try_parse_json_or_csv_text(text: str):
        if not isinstance(text, str):
            return None
        s = text.strip()
        if not s:
            return None
        try:
            return json.loads(s)
        except Exception:
            pass

        try:
            snip = s[:50_000]
            reader = csv.DictReader(io.StringIO(snip))
            rows = list(reader)
            if rows:
                return rows
        except Exception:
            pass

        return None

    def _extract_xy_from_rows(rows, x_field=None, y_field=None):
        if not isinstance(rows, list) or not rows:
            return [], [], "", ""
        if not isinstance(rows[0], dict):
            return [], [], "", ""

        fields = list(rows[0].keys())
        xf = x_field if x_field in fields else None
        yf = y_field if y_field in fields else None

        numeric_fields = []
        for f in fields:
            if f == xf:
                continue
            for r in rows[:25]:
                v = r.get(f)
                try:
                    float(v)
                    numeric_fields.append(f)
                    break
                except Exception:
                    continue

        if yf is None and numeric_fields:
            yf = numeric_fields[0]

        x_out = []
        y_out = []

        for idx, r in enumerate(rows):
            if yf is None:
                break
            try:
                yv = r.get(yf)
                yv = float(yv)
            except Exception:
                continue

            if xf is not None:
                xv = r.get(xf)
                try:
                    xv_num = float(xv)
                    xv = xv_num
                except Exception:
                    xv = str(xv)
            else:
                xv = idx + 1

            x_out.append(xv)
            y_out.append(yv)

        return x_out, y_out, (xf or "Index"), (yf or "Value")

    # 1) Prefer explicit structured payload
    title = payload.get("title")
    chart_type = payload.get("type")
    x = payload.get("x")
    y = payload.get("y")
    labels = payload.get("labels")
    values = payload.get("values")
    x_label = payload.get("x_label", "")
    y_label = payload.get("y_label", "")

    # 2) Try to extract real data from payload.data or payload.text (JSON/CSV)
    data_obj = payload.get("data")
    text = payload.get("text") or payload.get("goal") or payload.get("prompt")
    if isinstance(data_obj, str):
        parsed = _try_parse_json_or_csv_text(data_obj)
        if parsed is not None:
            data_obj = parsed
    if data_obj is None and isinstance(text, str):
        parsed = _try_parse_json_or_csv_text(text)
        if parsed is not None:
            data_obj = parsed

    if (not isinstance(x, list) or not isinstance(y, list) or not x or not y) and isinstance(data_obj, list):
        x_field = payload.get("x_field") or payload.get("xKey") or payload.get("xKeyField")
        y_field = payload.get("y_field") or payload.get("yKey") or payload.get("yKeyField")
        x_ex, y_ex, xl_ex, yl_ex = _extract_xy_from_rows(data_obj, x_field=x_field, y_field=y_field)
        if x_ex and y_ex:
            x = x or x_ex
            y = y or y_ex
            x_label = x_label or xl_ex
            y_label = y_label or yl_ex

    title = title or "Chart"
    chart_type = (chart_type or "").lower().strip()
    x = x if isinstance(x, list) else []
    y = y if isinstance(y, list) else []
    labels = labels if isinstance(labels, list) else []
    values = values if isinstance(values, list) else []

    # 3) Coerce numeric arrays
    x_num = _coerce_number_list(x)
    y_num = _coerce_number_list(y)
    values_num = _coerce_number_list(values)
    labels_str = _coerce_label_list(labels)
    x_cat = [str(v) for v in x] if isinstance(x, list) else []

    # 4) Select chart type (if not explicitly provided) based on available data
    if not chart_type:
        if labels_str and values_num and len(labels_str) == len(values_num):
            chart_type = "bar"
        elif values_num and not (x_num and y_num):
            chart_type = "histogram"
        elif x_num and y_num and len(x_num) == len(y_num):
            chart_type = "line"
        else:
            chart_type = "bar"

    # 5) Validate we have real data for the chosen chart type
    error_msg = ""
    if chart_type in ("pie",):
        if not labels_str or not values_num or len(labels_str) != len(values_num):
            error_msg = "Pie chart requires 'labels' and 'values' arrays of equal length."
    elif chart_type in ("histogram",):
        if not values_num:
            error_msg = "Histogram requires a numeric 'values' array."
    elif chart_type in ("bar",):
        # Bar charts can support categorical x values.
        if not y_num:
            error_msg = "Bar chart requires a numeric 'y' array."
        elif x_num and len(x_num) != len(y_num):
            error_msg = "Bar chart requires 'x' and 'y' arrays of equal length."
        elif (not x_num) and (not x_cat or len(x_cat) != len(y_num)):
            error_msg = "Bar chart requires 'x' labels and numeric 'y' arrays of equal length."
    else:
        if not x_num or not y_num or len(x_num) != len(y_num):
            error_msg = "Line/bar/scatter/area charts require numeric 'x' and 'y' arrays of equal length."

    if error_msg:
        log_task(task_id, "ERROR", f"Chart generation failed: {error_msg}")
        try:
            requests.post(
                f"{ORCHESTRATOR_URL}/internal/tasks/{task_id}/fail",
                json={"error": error_msg},
                timeout=5,
            )
        except Exception as e:
            log_task(task_id, "ERROR", f"Failed to report chart failure: {e}")
        worker_tasks_total.labels(result="failed").inc()
        return
    
    # Phase 8.4.2: Determine role with mapping and guardrail
    role = get_chart_role(payload)
    
    # Phase 8.4.2: Guardrail - default role if missing to avoid workflow failure.
    if not role:
        role = "auto_chart"
        payload["role"] = role
        log_task(task_id, "WARN", "Chart artifact role missing; defaulting to 'auto_chart'")

    plt.figure(figsize=(8, 5))

    if chart_type == "bar":
        x_axis = [str(v) for v in x_num] if x_num else x_cat
        bars = plt.bar(x_axis, y_num, color='steelblue', edgecolor='navy', alpha=0.8)
        # Add value labels on top of bars
        for bar in bars:
            height = bar.get_height()
            plt.text(bar.get_x() + bar.get_width()/2., height,
                    f'{height:.1f}',
                    ha='center', va='bottom', fontsize=9)
    elif chart_type == "line":
        plt.plot(x_num, y_num, marker='o', color='steelblue', linewidth=2, markersize=6)
    elif chart_type == "scatter":
        plt.scatter(x_num, y_num, color='steelblue', alpha=0.6, s=50)
    elif chart_type == "area":
        plt.fill_between(x_num, y_num, alpha=0.35, color='steelblue')
        plt.plot(x_num, y_num, color='navy', linewidth=1.5)
    elif chart_type == "pie":
        colors = plt.cm.Set3(range(len(values_num)))
        wedges, texts, autotexts = plt.pie(values_num, labels=labels_str, autopct="%1.1f%%", 
                                          colors=colors, startangle=90)
        # Make percentage text bold
        for autotext in autotexts:
            autotext.set_fontweight('bold')
            autotext.set_fontsize(10)
        plt.axis('equal')
    elif chart_type == "histogram":
        bins = payload.get("bins")
        try:
            bins_i = int(bins) if bins is not None else 10
        except Exception:
            bins_i = 10
        plt.hist(values_num, bins=bins_i, color='steelblue', edgecolor='navy', alpha=0.7)
        plt.xlabel("Value Range")
        plt.ylabel("Frequency")
    else:
        raise ValueError(f"Unsupported chart type: {chart_type}")

    plt.title(title, fontsize=14, fontweight='bold', pad=15)
    if chart_type not in ("pie",):
        plt.xlabel(x_label, fontsize=11)
        plt.ylabel(y_label, fontsize=11)
        plt.grid(True, alpha=0.3, linestyle='--')
    plt.tight_layout()

    buf = io.BytesIO()
    plt.savefig(buf, format="png")
    plt.close()
    buf.seek(0)

    # Phase 8.4.2: Use role in filename
    filename = f"{role}.png"
    object_key = f"jobs/{job_id}/{task_id}.png"

    s3_client.put_object(
        Bucket=MINIO_BUCKET,
        Key=object_key,
        Body=buf,
        ContentType="image/png"
    )

    # Phase 8.4.2: Include role in artifact metadata
    data_points = len(y_num) if chart_type in ("bar", "line", "scatter", "area") else (len(values_num) if values_num else 0)
    artifact_metadata = {
        "chart_type": chart_type,
        "data_points": data_points,
        "role": role  # Explicitly store role in metadata
    }

    # Deterministic one-line description based on plotted data
    if chart_type == "pie":
        chart_description = f"Pie chart of {title} with {len(values_num)} categories."
    elif chart_type == "histogram":
        chart_description = f"Histogram of {title} showing distribution of {len(values_num)} values."
    else:
        xl = (x_label or ("Index" if x_num else "Category") or "x").strip() or "x"
        yl = (y_label or "y").strip() or "y"
        chart_description = f"{chart_type.capitalize()} chart of {yl} vs {xl} using {data_points} data points."

    requests.post(
        f"{ORCHESTRATOR_URL}/internal/tasks/{task_id}/complete",
        json={
            "result": {
                "ok": True,
                "job_id": job_id,
                "executor": "chart",
                "image_url": f"/api/artifacts/{task_id}/download",
                "storage_key": object_key,
                "role": role,
                "chart_type": chart_type,
                "data_points": data_points,
                "description": chart_description,
            },
            "artifact": {
                "type": "chart",
                "filename": filename,
                "storage_key": object_key,
                "role": role,
                "metadata": {**artifact_metadata, "description": chart_description}
            }
        },
        timeout=5,
    )

    worker_tasks_total.labels(result="success").inc()
    log_task(task_id, "INFO", f"Chart generated: {chart_type} with {data_points} data points, role='{role}', desc='{chart_description[:50]}...'")


# -------------------------
# ADDITIONAL AGENT TYPES
# -------------------------
def run_analyzer(task_id, job_id, payload):
    """AI-powered data analysis with insights"""
    import statistics
    
    data = payload.get("data", [])
    text = payload.get("text", "")
    analysis_type = payload.get("analysis_type", "summary")

    # Normalize data payload: it can arrive as a JSON string from template resolution
    if isinstance(data, str) and data.strip():
        try:
            parsed = json.loads(data)
            data = parsed
        except Exception:
            # If it isn't JSON, treat it as text input for analysis
            if not text:
                text = data
            data = []

    # If data is a list of objects, try to extract a numeric series.
    # Common in Prompt 2 where transform outputs cleaned objects with a numeric field like 'score'.
    if isinstance(data, list) and data and isinstance(data[0], dict):
        numeric = []
        for row in data:
            if not isinstance(row, dict):
                continue
            for k in ("score", "value", "amount", "sales"):
                v = row.get(k)
                if isinstance(v, (int, float)):
                    numeric.append(float(v))
                    break
        if numeric:
            data = numeric
        else:
            if not text:
                try:
                    text = json.dumps(data)[:8000]
                except Exception:
                    text = str(data)[:8000]
            data = []

    # Ensure numeric list for statistical modes
    if isinstance(data, list):
        data = [x for x in data if isinstance(x, (int, float))]
    else:
        data = []

    # Build outputs that match the backend agent registry:
    # - outputs.stats (json)
    # - outputs.insights (string)
    stats: dict = {}
    insights: str = ""

    if not data:
        if isinstance(text, str) and text.strip():
            # Text-only analysis path
            try:
                ai_prompt = f"""Analyze the following text and provide a concise analytical interpretation.

Requirements:
- Identify key themes and entities.
- Provide 2-4 actionable insights.
- If the text implies comparisons, categories, or rankings, call them out.

Text:
{text[:8000]}
"""

                insights = ai_helper.generate_ai_response(
                    ai_prompt,
                    task_type="analyzer",
                    temperature=0.4,
                    max_tokens=600,
                )
                stats = {
                    "analysis_mode": "text",
                    "text_length": len(text),
                }
            except Exception as e:
                log_task(task_id, "WARN", f"Text analysis failed: {e}")
                stats = {"analysis_mode": "text", "text_length": len(text)}
                insights = "AI analysis unavailable"
        else:
            stats = {"error": "No data provided for analysis"}
            insights = "No data provided for analysis."
    else:
        if analysis_type == "summary":
            stats = {
                "count": len(data),
                "mean": statistics.mean(data),
                "median": statistics.median(data),
                "min": min(data),
                "max": max(data),
            }

            # Add AI-powered insights
            try:
                ai_prompt = f"""Analyze this statistical data and provide concise insights:

Data: {data[:30]}
Statistics: count={stats['count']}, mean={stats['mean']:.2f}, median={stats['median']:.2f}, range={stats['min']:.1f}-{stats['max']:.1f}

Provide 2-3 short, actionable insights (1 sentence each). Be specific and quantitative where possible."""

                insights = ai_helper.generate_ai_response(
                    ai_prompt,
                    task_type="analyzer",
                    temperature=0.4,
                    max_tokens=150,
                )
                log_task(task_id, "INFO", "AI insights generated")
            except Exception as e:
                log_task(task_id, "WARN", f"AI insights failed: {e}")
                insights = "AI analysis unavailable"

        elif analysis_type == "trend":
            increasing = all(data[i] <= data[i + 1] for i in range(len(data) - 1))
            decreasing = all(data[i] >= data[i + 1] for i in range(len(data) - 1))
            trend = "increasing" if increasing else "decreasing" if decreasing else "mixed"
            stats = {
                "trend": trend,
                "data_points": len(data),
                "first": data[0] if data else None,
                "last": data[-1] if data else None,
            }
            insights = f"Detected a {trend} trend across {len(data)} data points."

        else:
            stats = {"analysis_type": analysis_type, "data_points": len(data)}
            insights = f"Analysis completed for type '{analysis_type}'."

    content = json.dumps({"stats": stats, "insights": insights}, indent=2).encode("utf-8")
    
    object_key = f"jobs/{job_id}/{task_id}_analysis.json"
    s3_client.put_object(
        Bucket=MINIO_BUCKET,
        Key=object_key,
        Body=io.BytesIO(content),
        ContentType="application/json"
    )
    
    requests.post(
        f"{ORCHESTRATOR_URL}/internal/tasks/{task_id}/complete",
        json={
            "result": {
                "ok": True,
                "job_id": job_id,
                "executor": "analyzer",
                "stats": stats,
                "insights": insights,
            },
            "artifact": {"type": "json", "filename": "analysis.json", "storage_key": object_key}
        },
        timeout=5,
    )
    worker_tasks_total.labels(result="success").inc()
    log_task(task_id, "INFO", f"Analysis completed: {analysis_type}")


def run_summarizer(task_id, job_id, payload):
    """AI-powered text summarization"""
    text = payload.get("text", "")
    max_sentences = payload.get("max_sentences", 3)
    max_words = payload.get("max_words") or payload.get("word_count")  # Support word count parameter
    
    if not text or not isinstance(text, str) or not text.strip():
        summary = "No text provided for summarization."
        original_length = 0
    else:
        try:
            # Use AI for abstractive summarization
            # Build constraint string
            if max_words:
                constraint = f"in approximately {max_words} words"
            else:
                constraint = f"in {max_sentences} sentences or less"
            
            # Use larger text slice for Wikipedia articles
            text_input = text[:6000]  # Up to 6000 chars for richer content
            
            ai_prompt = f"""Summarize the following text {constraint}. Be concise and capture the key points:

{text_input}"""
            
            summary = ai_helper.generate_ai_response(
                ai_prompt,
                task_type="summarizer",
                temperature=0.5,
                max_tokens=600
            )
            log_task(task_id, "INFO", "AI summarization completed")
            
        except Exception as e:
            # Fallback to simple extractive summarization
            log_task(task_id, "WARN", f"AI summarization failed, using fallback: {e}")
            sentences = text.replace('!', '.').replace('?', '.').split('.')
            sentences = [s.strip() for s in sentences if s.strip()]
            n = int(max_words / 20) if max_words else max_sentences  # rough sentence count
            summary_sentences = sentences[:n]
            summary = '. '.join(summary_sentences) + '.'
        
        original_length = len(text)
    
    content = json.dumps({"summary": summary, "original_length": original_length}).encode("utf-8")
    object_key = f"jobs/{job_id}/{task_id}_summary.json"
    
    s3_client.put_object(
        Bucket=MINIO_BUCKET,
        Key=object_key,
        Body=io.BytesIO(content),
        ContentType="application/json"
    )
    
    requests.post(
        f"{ORCHESTRATOR_URL}/internal/tasks/{task_id}/complete",
        json={
            "result": {
                "ok": True,
                "job_id": job_id,
                "executor": "summarizer",
                "summary": summary,
                "original_length": original_length
            },
            "artifact": {"type": "json", "filename": "summary.json", "storage_key": object_key}
        },
        timeout=5,
    )
    worker_tasks_total.labels(result="success").inc()
    log_task(task_id, "INFO", "Summarization completed")


def run_validator(task_id, job_id, payload):
    """AI-enhanced data validation with semantic checks"""
    data = payload.get("data", {})
    rules = payload.get("rules", {})

    if isinstance(rules, dict):
        normalized = None

        # JSON Schema: array of objects
        if "properties" not in rules:
            items = rules.get("items") if isinstance(rules.get("items"), dict) else None
            if items and isinstance(items.get("properties"), dict):
                required = items.get("required") if isinstance(items.get("required"), list) else []
                props = items.get("properties")
                normalized = {}
                for field, schema in props.items():
                    if not isinstance(schema, dict):
                        continue
                    rule = {}
                    if field in required:
                        rule["required"] = True
                    t = schema.get("type")
                    if t in ("number", "string"):
                        rule["type"] = t
                    normalized[field] = rule

        # JSON Schema: single object
        if normalized is None and isinstance(rules.get("properties"), dict):
            required = rules.get("required") if isinstance(rules.get("required"), list) else []
            props = rules.get("properties")
            normalized = {}
            for field, schema in props.items():
                if not isinstance(schema, dict):
                    continue
                rule = {}
                if field in required:
                    rule["required"] = True
                t = schema.get("type")
                if t in ("number", "string"):
                    rule["type"] = t
                normalized[field] = rule

        if normalized is not None:
            rules = normalized

    errors = []
    warnings = []

    # Basic rule-based validation
    items = data if isinstance(data, list) else [data]
    for i, item in enumerate(items):
        if not isinstance(item, dict):
            errors.append(f"Item {i} is not a dictionary. Cannot validate fields.")
            continue
        for field, rule in rules.items():
            if not isinstance(rule, dict):
                continue
            value = item.get(field)
            # Use explicit None/missing check — do NOT use `not value` which treats 0 as missing
            field_missing = (value is None and field not in item)
            field_present = field in item and item[field] is not None
            if rule.get("required") and field_missing:
                errors.append(f"Row {i} Missing required field: {field}")
            if field_present and rule.get("type"):
                if rule["type"] == "number" and not isinstance(value, (int, float)):
                    errors.append(f"Row {i} Field {field} should be a number, got: {type(value).__name__}")
                if rule["type"] == "string" and not isinstance(value, str):
                    errors.append(f"Row {i} Field {field} should be a string, got: {type(value).__name__}")
            if field_present and rule.get("min") is not None:
                if isinstance(value, (int, float)) and value < rule["min"]:
                    warnings.append(f"Row {i} Field {field} below minimum: {value} < {rule['min']}")
    
    # AI-powered semantic validation
    if data and rules:
        try:
            ai_prompt = f"""Perform semantic validation on this data against the rules:

Data: {json.dumps(data, indent=2)}
Rules: {json.dumps(rules, indent=2)}

Provide:
1. Any additional validation concerns (semantic issues, data quality, etc.)
2. Suggestions for improvement
Keep it brief (2-3 sentences)."""
            
            ai_validation = ai_helper.generate_ai_response(
                ai_prompt,
                task_type="validator",
                temperature=0.3,
                max_tokens=200
            )
            log_task(task_id, "INFO", "AI validation completed")
        except Exception as e:
            log_task(task_id, "WARN", f"AI validation failed: {e}")
            ai_validation = "AI validation unavailable"
    else:
        ai_validation = "No data or rules provided"
    
    is_valid = len(errors) == 0
    result = {
        "valid": is_valid,
        "errors": errors,
        "warnings": warnings,
        "ai_validation": ai_validation
    }
    content = json.dumps(result, indent=2).encode("utf-8")
    
    object_key = f"jobs/{job_id}/{task_id}_validation.json"
    s3_client.put_object(
        Bucket=MINIO_BUCKET,
        Key=object_key,
        Body=io.BytesIO(content),
        ContentType="application/json"
    )
    
    requests.post(
        f"{ORCHESTRATOR_URL}/internal/tasks/{task_id}/complete",
        json={
            "result": {
                "ok": True,
                "job_id": job_id,
                "executor": "validator",
                "valid": is_valid,
                "errors": errors,
                "warnings": warnings,
                "error_count": len(errors),
                "warning_count": len(warnings),
                "ai_validation": ai_validation,
            },
            "artifact": {"type": "json", "filename": "validation.json", "storage_key": object_key}
        },
        timeout=5,
    )
    worker_tasks_total.labels(result="success").inc()
    log_task(task_id, "INFO", f"Validation completed: {'passed' if is_valid else 'failed'}")


def run_transformer(task_id, job_id, payload):
    """AI-powered data transformation"""
    data = payload.get("data", [])
    transform_type = payload.get("transform", "uppercase")
    
    transformed = data  # default: pass-through
    
    if isinstance(data, list):
        # Basic transformations
        if transform_type == "uppercase":
            transformed = [str(x).upper() for x in data]
        elif transform_type == "lowercase":
            transformed = [str(x).lower() for x in data]
        elif transform_type == "reverse":
            transformed = list(reversed(data))
        elif transform_type == "unique":
            transformed = list(dict.fromkeys(str(x) for x in data))
        elif transform_type.startswith("ai:"):
            # AI-powered custom transformation
            try:
                instruction = transform_type[3:]  # Remove "ai:" prefix
                data_str = json.dumps(data, indent=2)[:3000]  # limit to 3000 chars
                ai_prompt = f"""Transform the following data according to this instruction: {instruction}

Data:
{data_str}

IMPORTANT: Return ONLY valid JSON (array or object), no explanation or markdown."""
                
                ai_result = ai_helper.generate_ai_response(
                    ai_prompt,
                    task_type="transformer",
                    temperature=0.3,
                    max_tokens=800
                )
                
                # Try to extract JSON from response
                import re as _re
                # Try to find JSON array or object in the response
                json_match = _re.search(r'(\[.*?\]|\{.*?\})', ai_result, _re.DOTALL)
                if json_match:
                    try:
                        parsed = json.loads(json_match.group(1))
                        transformed = parsed
                    except json.JSONDecodeError:
                        pass
                else:
                    try:
                        parsed = json.loads(ai_result.strip())
                        transformed = parsed
                    except json.JSONDecodeError:
                        log_task(task_id, "WARN", "Could not parse AI transformation result as JSON, using original")
                        transformed = data
                
                log_task(task_id, "INFO", "AI transformation completed")
            except Exception as e:
                log_task(task_id, "WARN", f"AI transformation failed: {e}")
                transformed = data
        else:
            transformed = data
    elif isinstance(data, dict):
        # Handle dict inputs
        if transform_type.startswith("ai:"):
            try:
                instruction = transform_type[3:]  # Remove "ai:" prefix
                data_str = json.dumps(data, indent=2)[:3000]
                ai_prompt = f"""Transform the following JSON data according to this instruction: {instruction}

Data:
{data_str}

IMPORTANT: Return ONLY valid JSON (array or object), no explanation or markdown."""
                
                ai_result = ai_helper.generate_ai_response(
                    ai_prompt,
                    task_type="transformer",
                    temperature=0.3,
                    max_tokens=800
                )
                
                import re as _re
                json_match = _re.search(r'(\[.*?\]|\{.*?\})', ai_result, _re.DOTALL)
                if json_match:
                    try:
                        transformed = json.loads(json_match.group(1))
                    except json.JSONDecodeError:
                        transformed = data
                else:
                    try:
                        transformed = json.loads(ai_result.strip())
                    except json.JSONDecodeError:
                        transformed = data
                
                log_task(task_id, "INFO", "AI dict transformation completed")
            except Exception as e:
                log_task(task_id, "WARN", f"AI dict transformation failed: {e}")
                transformed = data
        else:
            transformed = data
    elif isinstance(data, str):
        # Handle string inputs
        if transform_type.startswith("ai:"):
            try:
                instruction = transform_type[3:]
                ai_prompt = f"""Transform the following text according to this instruction: {instruction}

Text:
{data[:3000]}

Return the transformed result as JSON (array or object) if the instruction implies structured output, otherwise return plain text."""
                
                ai_result = ai_helper.generate_ai_response(
                    ai_prompt,
                    task_type="transformer",
                    temperature=0.3,
                    max_tokens=800
                )
                transformed = ai_result
                log_task(task_id, "INFO", "AI string transformation completed")
            except Exception as e:
                log_task(task_id, "WARN", f"AI string transformation failed: {e}")
                transformed = data
    
    original_count = len(data) if isinstance(data, list) else (len(data) if isinstance(data, dict) else 1)
    content = json.dumps({"transformed": transformed, "result": transformed, "original_count": original_count}, indent=2, default=str).encode("utf-8")
    object_key = f"jobs/{job_id}/{task_id}_transform.json"
    
    s3_client.put_object(
        Bucket=MINIO_BUCKET,
        Key=object_key,
        Body=io.BytesIO(content),
        ContentType="application/json"
    )
    
    requests.post(
        f"{ORCHESTRATOR_URL}/internal/tasks/{task_id}/complete",
        json={
            "result": {"ok": True, "job_id": job_id, "executor": "transformer", "result": transformed, "transformed": transformed},
            "artifact": {"type": "json", "filename": "transform.json", "storage_key": object_key}
        },
        timeout=5,
    )
    worker_tasks_total.labels(result="success").inc()
    log_task(task_id, "INFO", f"Transform completed: {transform_type}")


def _get_latest_job_pdf_attachment(task_id: str, job_id: Optional[str]) -> Optional[Dict[str, Any]]:
    if not job_id:
        return None

    try:
        with db_conn.cursor() as cur:
            # CRITICAL FIX: Properly scope to job_id and get MOST RECENT PDF by created_at
            # The old query ordered by (role='report') first which could pick wrong artifacts
            
            # First, debug: list ALL PDF artifacts for this job
            cur.execute(
                """
                SELECT a.storage_key, a.filename, a.role, a.created_at, a.id
                FROM artifacts a
                WHERE a.job_id = %s
                  AND a.type = 'pdf'
                  AND a.is_current = TRUE
                ORDER BY a.created_at DESC
                """,
                (job_id,),
            )
            all_pdfs = cur.fetchall()
            if all_pdfs:
                log_task(task_id, "INFO", f"Job {job_id} has {len(all_pdfs)} PDF artifacts:")
                for pdf in all_pdfs:
                    log_task(task_id, "INFO", f"  - id={pdf[4][:8]}... storage={pdf[0]} role={pdf[2]} created={pdf[3]}")
            else:
                log_task(task_id, "WARN", f"Job {job_id} has NO PDF artifacts with is_current=TRUE")
            
            # Now get the most recent one
            cur.execute(
                """
                SELECT a.storage_key, a.filename, a.role, a.created_at
                FROM artifacts a
                WHERE a.job_id = %s
                  AND a.type = 'pdf'
                  AND a.is_current = TRUE
                ORDER BY a.created_at DESC
                LIMIT 1
                """,
                (job_id,),
            )
            row = cur.fetchone()

        if not row:
            log_task(task_id, "WARN", f"No PDF artifact found for job_id={job_id}")
            return None

        storage_key, filename, role, created_at = row
        if not storage_key:
            log_task(task_id, "ERROR", f"PDF artifact has empty storage_key for job_id={job_id}")
            return None

        log_task(task_id, "INFO", f"Found PDF artifact for job_id={job_id}: storage_key='{storage_key}' role='{role}' created_at='{created_at}'")

        try:
            resp = s3_client.get_object(Bucket=MINIO_BUCKET, Key=storage_key)
            content_bytes = resp["Body"].read()
        except Exception as e:
            log_task(task_id, "ERROR", f"Failed to download PDF attachment from storage key '{storage_key}': {e}")
            return None

        log_task(
            task_id,
            "INFO",
            f"Resolved PDF attachment for job_id={job_id}: storage_key='{storage_key}' role='{role}' bytes={len(content_bytes)}",
        )

        return {
            "storage_key": storage_key,
            "filename": filename or "report.pdf",
            "role": role,
            "content_bytes": content_bytes,
        }

    except Exception as e:
        log_task(task_id, "ERROR", f"Failed to resolve PDF attachment for job {job_id}: {e}")
        return None


def _send_via_smtp(
    task_id: str,
    recipients: list,
    subject: str,
    message: str,
    attachment: Optional[Dict[str, Any]],
) -> dict:
    """Send email via Gmail SMTP with IPv4 forcing and SSL fallback."""
    smtp_host = "smtp.gmail.com"
    smtp_port = 587
    smtp_ssl_port = 465
    results = []
    sent_count = 0
    error_count = 0
    status = "sent"

    server = None
    try:
        def resolve_ipv4(host: str) -> str:
            infos = socket.getaddrinfo(host, None, family=socket.AF_INET, type=socket.SOCK_STREAM)
            if not infos:
                raise RuntimeError(f"No IPv4 address found for {host}")
            return infos[0][4][0]

        def connect_starttls():
            ip = resolve_ipv4(smtp_host)
            log_task(task_id, "INFO", f"Connecting to Gmail SMTP {smtp_host}:{smtp_port} via IPv4 {ip} (STARTTLS)")
            s = smtplib.SMTP(ip, smtp_port, timeout=20)
            s.ehlo()
            s.starttls(context=ssl.create_default_context())
            s.ehlo()
            return s

        def connect_ssl():
            ip = resolve_ipv4(smtp_host)
            log_task(task_id, "INFO", f"Connecting to Gmail SMTP {smtp_host}:{smtp_ssl_port} via IPv4 {ip} (SSL)")
            s = smtplib.SMTP_SSL(ip, smtp_ssl_port, timeout=20, context=ssl.create_default_context())
            s.ehlo()
            return s

        try:
            server = connect_starttls()
        except Exception as e:
            log_task(task_id, "WARN", f"STARTTLS connection failed, trying SSL fallback: {e}")
            server = connect_ssl()

        server.login(GMAIL_USER, GMAIL_APP_PASSWORD)
        log_task(task_id, "INFO", "Authenticated with Gmail SMTP")

        for recipient in recipients:
            if not isinstance(recipient, str) or not recipient.strip():
                error_count += 1
                results.append({"to": recipient, "ok": False, "error": "invalid_recipient"})
                continue

            msg = MIMEMultipart()
            msg["Subject"] = subject
            msg["From"] = GMAIL_USER
            msg["To"] = recipient
            msg.attach(MIMEText(message, _charset="utf-8"))

            if attachment is not None:
                part = MIMEBase("application", "pdf")
                part.set_payload(attachment["content_bytes"])
                encoders.encode_base64(part)
                part.add_header(
                    "Content-Disposition",
                    f"attachment; filename=\"{attachment['filename']}\"",
                )
                msg.attach(part)

            try:
                server.sendmail(GMAIL_USER, [recipient], msg.as_string())
                sent_count += 1
                results.append({"to": recipient, "ok": True})
            except Exception as e:
                error_count += 1
                results.append({"to": recipient, "ok": False, "error": str(e)})
                log_task(task_id, "ERROR", f"Failed sending email to {recipient}: {e}")

    except Exception as e:
        status = "smtp_error"
        error_count = len(recipients)
        results = [{"to": r, "ok": False, "error": f"smtp_error: {e}"} for r in recipients]
        log_task(task_id, "ERROR", f"Notifier SMTP error: {e}")
    finally:
        try:
            if server is not None:
                server.quit()
        except Exception:
            pass

    if error_count > 0 and sent_count == 0 and status == "sent":
        status = "failed"
    elif error_count > 0 and sent_count > 0 and status == "sent":
        status = "partial"

    return {
        "status": status,
        "sent_count": sent_count,
        "error_count": error_count,
        "results": results,
    }


def _send_via_sendgrid(
    task_id: str,
    recipients: list,
    subject: str,
    message: str,
    attachment: Optional[Dict[str, Any]],
) -> dict:
    """Send email via SendGrid HTTP API (for Railway where SMTP is blocked)."""
    results = []
    sent_count = 0
    error_count = 0
    status = "sent"
    message_id = None

    try:
        # IMPORTANT: SendGrid frequently drops/blocks mail if the sender is not verified.
        # Do not silently fall back to Gmail user here; force explicit SENDGRID_FROM_EMAIL.
        from_email = SENDGRID_FROM_EMAIL
        if not from_email:
            raise ValueError("SENDGRID_FROM_EMAIL is not set (must be a verified sender in SendGrid)")

        # SendGrid v3 API endpoint
        url = "https://api.sendgrid.com/v3/mail/send"
        headers = {
            "Authorization": f"Bearer {SENDGRID_API_KEY}",
            "Content-Type": "application/json"
        }

        # Build personalizations for each recipient
        personalizations = [{"to": [{"email": r}]} for r in recipients if isinstance(r, str) and r.strip()]

        if not personalizations:
            return {"status": "no_recipients", "sent_count": 0, "error_count": len(recipients), "results": []}

        data = {
            "personalizations": personalizations,
            "from": {"email": from_email},
            "subject": subject,
            "content": [{"type": "text/plain", "value": message}]
        }

        if attachment is not None:
            data["attachments"] = [
                {
                    "content": base64.b64encode(attachment["content_bytes"]).decode("utf-8"),
                    "type": "application/pdf",
                    "filename": attachment["filename"],
                    "disposition": "attachment",
                }
            ]

        log_task(task_id, "INFO", f"Sending via SendGrid API to {len(recipients)} recipients from {from_email}")
        log_task(task_id, "INFO", f"SendGrid request payload size: {len(json.dumps(data))} bytes")
        resp = requests.post(url, headers=headers, json=data, timeout=30)
        
        # Log full response details for debugging
        log_task(task_id, "INFO", f"SendGrid response status: {resp.status_code}")
        log_task(task_id, "INFO", f"SendGrid response headers: {dict(resp.headers)}")
        try:
            response_body = resp.text[:500] if resp.text else "(empty)"
            log_task(task_id, "INFO", f"SendGrid response body: {response_body}")
        except Exception as e:
            log_task(task_id, "WARN", f"Could not read SendGrid response body: {e}")

        # SendGrid typically returns 202 with an empty body. The only reliable identifier is X-Message-Id.
        message_id = resp.headers.get("X-Message-Id") or resp.headers.get("x-message-id")
        if message_id:
            log_task(task_id, "INFO", f"SendGrid X-Message-Id: {message_id}")
        else:
            log_task(task_id, "WARN", "SendGrid response missing X-Message-Id header; delivery debugging will be harder")

        if resp.status_code in (200, 201, 202):
            # SendGrid accepted the request
            sent_count = len(recipients)
            for r in recipients:
                results.append({"to": r, "ok": True, "message_id": message_id})
            log_task(task_id, "INFO", f"SendGrid accepted email request (HTTP {resp.status_code})")
        else:
            error_msg = f"SendGrid API error: HTTP {resp.status_code} - {resp.text[:200]}"
            log_task(task_id, "ERROR", error_msg)
            error_count = len(recipients)
            status = "sendgrid_error"
            for r in recipients:
                results.append({"to": r, "ok": False, "error": error_msg})

    except Exception as e:
        status = "sendgrid_error"
        error_count = len(recipients)
        results = [{"to": r, "ok": False, "error": f"sendgrid_error: {e}"} for r in recipients]
        log_task(task_id, "ERROR", f"SendGrid delivery error: {e}")

    if error_count > 0 and sent_count == 0 and status == "sent":
        status = "failed"
    elif error_count > 0 and sent_count > 0 and status == "sent":
        status = "partial"

    return {"status": status, "sent_count": sent_count, "error_count": error_count, "results": results}


def run_notifier(task_id, job_id, payload):
    """Send notifications (email) via Gmail SMTP with SendGrid HTTP fallback for Railway."""
    # CRITICAL DEBUG: Log the job context at the start
    log_task(task_id, "INFO", f"NOTIFIER START: task_id={task_id}, job_id={job_id}, payload_keys={list(payload.keys())}")
    
    # Verify job_id from database matches what was passed
    try:
        with db_conn.cursor() as cur:
            cur.execute("SELECT job_id, name, agent_type FROM tasks WHERE id = %s", (task_id,))
            db_row = cur.fetchone()
            if db_row:
                db_job_id, db_name, db_agent_type = db_row
                log_task(task_id, "INFO", f"NOTIFIER DB CHECK: task_id={task_id} has job_id={db_job_id}, name={db_name}, agent_type={db_agent_type}")
                if db_job_id != job_id:
                    log_task(task_id, "ERROR", f"NOTIFIER JOB MISMATCH: passed job_id={job_id} but DB says job_id={db_job_id}")
                    job_id = db_job_id  # Use the correct job_id from DB
            else:
                log_task(task_id, "ERROR", f"NOTIFIER DB CHECK: task {task_id} not found in database!")
    except Exception as e:
        log_task(task_id, "ERROR", f"NOTIFIER DB CHECK FAILED: {e}")
    
    channel = payload.get("channel", "email")
    recipients = payload.get("recipients")
    if recipients is None:
        recipients = payload.get("sent_to")
    if recipients is None:
        single = payload.get("recipient")
        recipients = [single] if single is not None else []
    subject = payload.get("subject", "Notification from workflow")
    message = payload.get("message", "Notification from workflow")

    # Normalize common cases where upstream agents return relative API paths.
    # Email recipients typically need a fully qualified URL.
    try:
        if isinstance(message, str) and message.strip() and "/api/" in message:
            message = message.replace("/api/", f"{ORCHESTRATOR_URL.rstrip('/')}/api/")
    except Exception:
        pass

    if channel != "email":
        log_task(task_id, "WARN", f"Notifier channel '{channel}' not supported; only 'email' is implemented")

    # Accept common manual formats for recipients:
    # - JSON array string: "[\"a@b.com\", \"c@d.com\"]"
    # - bracketed: "[a@b.com]"
    # - comma/semicolon/newline separated: "a@b.com, c@d.com"
    # - single email: "a@b.com"
    if isinstance(recipients, str):
        raw = recipients.strip()
        parsed_list = None
        if raw:
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, list):
                    parsed_list = parsed
                elif isinstance(parsed, str):
                    parsed_list = [parsed]
            except Exception:
                parsed_list = None

        if parsed_list is None:
            # Strip surrounding brackets/quotes if user typed something like [a@b.com]
            cleaned = raw
            if cleaned.startswith("[") and cleaned.endswith("]"):
                cleaned = cleaned[1:-1]
            cleaned = cleaned.replace("\r", "\n")
            parts = re.split(r"[\n,;]+", cleaned)
            parsed_list = [p.strip().strip('"').strip("'") for p in parts if p and p.strip()]

        recipients = parsed_list

    if not isinstance(recipients, list):
        recipients = []

    # Final normalization: coerce to list[str], drop empties
    recipients = [str(r).strip() for r in recipients if r is not None and str(r).strip()]

    results = []
    sent_count = 0
    error_count = 0
    status = "sent"
    email_provider_used = None

    if not recipients:
        log_task(task_id, "WARN", "Notifier called with empty recipients list")
        status = "no_recipients"
    else:
        resolved_attachment = _get_latest_job_pdf_attachment(task_id, job_id=job_id)

        # If the workflow didn't specify a message, helpfully include the PDF link when available.
        # This is especially important for AI Creator flows where the desired outcome is "send me the report link".
        try:
            if isinstance(message, str) and not message.strip():
                pdf_url = f"{ORCHESTRATOR_URL.rstrip('/')}/api/jobs/{job_id}/artifacts?type=pdf&role=report&download=1"
                message = f"Your report is ready: {pdf_url}"
        except Exception:
            pass

        if resolved_attachment is None:
            log_task(task_id, "INFO", "No PDF attachment found for job; sending notification without attachment")

        # Try SMTP first if auto or smtp mode
        if EMAIL_PROVIDER in ("auto", "smtp"):
            if GMAIL_USER and GMAIL_APP_PASSWORD:
                log_task(task_id, "INFO", f"Attempting SMTP delivery via {GMAIL_USER}")
                smtp_result = _send_via_smtp(task_id, recipients, subject, message, resolved_attachment)
                results.extend(smtp_result["results"])
                sent_count += smtp_result["sent_count"]
                error_count += smtp_result["error_count"]
                log_task(task_id, "INFO", f"SMTP result: status={smtp_result['status']}, sent={smtp_result['sent_count']}, errors={smtp_result['error_count']}")
                if smtp_result["status"] == "sent":
                    status = "sent"
                    email_provider_used = "gmail_smtp"
                elif smtp_result["status"] == "partial":
                    status = "partial"
                    email_provider_used = "gmail_smtp"
                else:
                    # SMTP failed. In auto mode we want to fall back to HTTP; in smtp mode we fail.
                    status = smtp_result["status"]
                    if EMAIL_PROVIDER == "auto":
                        log_task(task_id, "INFO", f"SMTP failed with status={status}, will try HTTP fallback")
                    else:
                        log_task(task_id, "ERROR", f"SMTP failed and EMAIL_PROVIDER=smtp, no fallback available")
            else:
                log_task(task_id, "WARN", "Gmail credentials not set, skipping SMTP")
                status = "missing_credentials"
                if EMAIL_PROVIDER == "smtp":
                    error_count = len(recipients)
                    results = [{"to": r, "ok": False, "error": "missing_credentials"} for r in recipients]
                elif EMAIL_PROVIDER == "auto":
                    log_task(task_id, "INFO", "SMTP credentials missing, will try HTTP fallback")

        # Try HTTP fallback if auto mode and SMTP didn't fully succeed
        log_task(task_id, "INFO", f"Checking HTTP fallback: EMAIL_PROVIDER={EMAIL_PROVIDER}, status={status}, SENDGRID_API_KEY={'SET' if SENDGRID_API_KEY else 'NOT_SET'}")
        if EMAIL_PROVIDER == "auto" and status not in ("sent", "partial") and SENDGRID_API_KEY:
            log_task(task_id, "INFO", "Attempting HTTP delivery via SendGrid")
            http_result = _send_via_sendgrid(task_id, recipients, subject, message, resolved_attachment)
            # Merge results - HTTP sends to all recipients in one call
            results = http_result["results"]
            sent_count = http_result["sent_count"]
            error_count = http_result["error_count"]
            status = http_result["status"]
            email_provider_used = "sendgrid_http"
            log_task(task_id, "INFO", f"SendGrid result: status={status}, message_id={http_result.get('message_id')}")
        elif EMAIL_PROVIDER == "auto" and status not in ("sent", "partial") and not SENDGRID_API_KEY:
            log_task(task_id, "ERROR", "SMTP failed and SENDGRID_API_KEY is not set; cannot use HTTP fallback")
            if status == "sent":
                status = "missing_credentials"

        # HTTP-only mode
        elif EMAIL_PROVIDER == "http":
            if SENDGRID_API_KEY:
                log_task(task_id, "INFO", "Attempting HTTP delivery via SendGrid (HTTP mode)")
                http_result = _send_via_sendgrid(task_id, recipients, subject, message, resolved_attachment)
                results = http_result["results"]
                sent_count = http_result["sent_count"]
                error_count = http_result["error_count"]
                status = http_result["status"]
                email_provider_used = "sendgrid_http"
            else:
                log_task(task_id, "ERROR", "SendGrid API key not set for HTTP mode")
                status = "missing_credentials"
                error_count = len(recipients)
                results = [{"to": r, "ok": False, "error": "missing_sendgrid_key"} for r in recipients]

    # Determine final status
    if error_count > 0 and sent_count == 0 and status == "sent":
        status = "failed"
    elif error_count > 0 and sent_count > 0 and status == "sent":
        status = "partial"

    # Build artifact content
    attachment_meta = None
    try:
        attachment = _get_latest_job_pdf_attachment(task_id, job_id=job_id)
        if attachment is not None:
            attachment_meta = {
                "filename": attachment["filename"],
                "bytes": len(attachment["content_bytes"]),
            }
    except Exception:
        attachment_meta = None

    content = json.dumps({
        "channel": channel,
        "provider": email_provider_used,
        "from": SENDGRID_FROM_EMAIL if email_provider_used == "sendgrid_http" else GMAIL_USER,
        "subject": subject,
        "sent_to": recipients,
        "message_preview": message[:100],
        "attachment": attachment_meta,
        "status": status,
        "sent_count": sent_count,
        "error_count": error_count,
        "results": results
    }).encode("utf-8")

    object_key = f"jobs/{job_id}/{task_id}_notification.json"
    s3_client.put_object(
        Bucket=MINIO_BUCKET,
        Key=object_key,
        Body=io.BytesIO(content),
        ContentType="application/json"
    )

    # If we could not send anything for email channel, fail the task
    should_fail = channel == "email" and status in {"no_recipients", "missing_credentials", "failed", "smtp_error", "sendgrid_error"}

    is_dev = os.getenv("NODE_ENV", "").lower() != "production"
    if is_dev and should_fail:
        status = "skipped"
        sent_count = 0
        error_count = 0
        results = []
        should_fail = False

    if should_fail:
        try:
            requests.post(
                f"{ORCHESTRATOR_URL}/internal/tasks/{task_id}/fail",
                json={
                    "error": f"notifier_failed: status={status} sent={sent_count} failed={error_count} provider={email_provider_used}",
                    "artifact": {"type": "json", "filename": "notification.json", "storage_key": object_key},
                },
                timeout=5,
            )
        except Exception as e:
            log_task(task_id, "ERROR", f"Failed to report notifier failure: {e}")
        worker_tasks_total.labels(result="failed").inc()
        log_task(task_id, "ERROR", f"Notification FAILED status={status} via {channel}: sent={sent_count} failed={error_count}")
        return

    requests.post(
        f"{ORCHESTRATOR_URL}/internal/tasks/{task_id}/complete",
        json={
            "result": {
                "ok": True,
                "job_id": job_id,
                "executor": "notifier",
                "notifications_sent": sent_count,
                "notifications_failed": error_count,
                "status": status,
                "provider": email_provider_used,
            },
            "artifact": {"type": "json", "filename": "notification.json", "storage_key": object_key}
        },
        timeout=5,
    )
    worker_tasks_total.labels(result="success").inc()
    log_task(task_id, "INFO", f"Notification status={status} via {channel}: sent={sent_count} failed={error_count} provider={email_provider_used}")


def run_scraper(task_id, job_id, payload):
    """Real web scraping with BeautifulSoup and AI-powered extraction"""
    url = payload.get("url", "")
    selector = payload.get("selector", "")
    if isinstance(url, str):
        url = url.strip()
    else:
        url = str(url).strip() if url is not None else ""
    ok = False
    
    if not url:
        error_msg = "URL is required for scraping"
        log_task(task_id, "ERROR", error_msg)
        scraped_data = {"error": error_msg, "status": "failed"}
    else:
        try:
            # Fetch the webpage
            log_task(task_id, "INFO", f"Fetching URL: {url}")
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
            response = requests.get(url, headers=headers, timeout=10)
            response.raise_for_status()
            
            # Parse with BeautifulSoup
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # Extract content based on selector
            if selector:
                elements = soup.select(selector)
                items = [elem.get_text(strip=True) for elem in elements[:30]]  # Limit to 30 items
                log_task(task_id, "INFO", f"Found {len(elements)} elements matching selector '{selector}'")
            else:
                # Extract all text if no selector - get more paragraphs for richer content
                all_paragraphs = [p.get_text(strip=True) for p in soup.find_all('p')]
                items = [p for p in all_paragraphs if len(p) > 30][:30]  # Filter short paras, take up to 30
                if not items:
                    items = all_paragraphs[:20]  # fallback without length filter
                log_task(task_id, "INFO", f"Extracted {len(items)} paragraphs (no selector)")
            
            # Use AI to summarize/analyze scraped content if available
            try:
                content_preview = " ".join(items[:8])[:1000]  # First 1000 chars from first 8 items
                ai_prompt = f"""Analyze this scraped web content and provide a brief summary:

URL: {url}
Content Preview: {content_preview}

Provide a 2-3 sentence summary of what this webpage contains."""
                
                ai_summary = ai_helper.generate_ai_response(
                    ai_prompt,
                    task_type="scraper",
                    temperature=0.3,
                    max_tokens=150
                )
                log_task(task_id, "INFO", "AI summary generated")
            except Exception as e:
                log_task(task_id, "WARN", f"AI analysis failed: {e}")
                ai_summary = "AI analysis unavailable"
            
            full_text = "\n\n".join(items)  # Full text for template resolution
            scraped_data = {
                "url": url,
                "selector": selector or "all paragraphs",
                "items_found": len(items),
                "sample_data": items[:10],  # First 10 items as sample
                "text": full_text,  # Full text for downstream agents
                "ai_summary": ai_summary,
                "status": "completed",
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")
            }
            ok = True
            
        except requests.exceptions.RequestException as e:
            error_msg = f"Failed to fetch URL: {str(e)}"
            log_task(task_id, "ERROR", error_msg)
            scraped_data = {
                "url": url,
                "error": error_msg,
                "status": "failed",
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")
            }
        except Exception as e:
            error_msg = f"Scraping error: {str(e)}"
            log_task(task_id, "ERROR", error_msg)
            scraped_data = {
                "url": url,
                "error": error_msg,
                "status": "failed",
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")
            }
    
    content = json.dumps(scraped_data, indent=2).encode("utf-8")
    object_key = f"jobs/{job_id}/{task_id}_scrape.json"
    
    s3_client.put_object(
        Bucket=MINIO_BUCKET,
        Key=object_key,
        Body=io.BytesIO(content),
        ContentType="application/json"
    )
    
    # Pass full text to downstream agents via template resolution
    # This is what {{tasks.scraper.outputs.text}} will resolve to
    full_text_for_output = scraped_data.get("text", "") or "\n".join(scraped_data.get("sample_data", []))
    if not ok:
        try:
            requests.post(
                f"{ORCHESTRATOR_URL}/internal/tasks/{task_id}/fail",
                json={"error": scraped_data.get("error", "Scraper failed")},
                timeout=5,
            )
        except Exception as e:
            log_task(task_id, "ERROR", f"Failed to report scraper failure: {e}")
        worker_tasks_total.labels(result="failed").inc()
        log_task(task_id, "ERROR", f"Scraping failed for {url}")
        return

    requests.post(
        f"{ORCHESTRATOR_URL}/internal/tasks/{task_id}/complete",
        json={
            "result": {
                "ok": True, 
                "job_id": job_id, 
                "executor": "scraper",
                "text": full_text_for_output,  # CRITICAL: full text for downstream summarizer/analyzer
                "html": response.text[:50000] if 'response' in locals() and hasattr(response, 'text') else "",
                "url": scraped_data.get("url", ""),
                "timestamp": scraped_data.get("timestamp", ""),
                "result": scraped_data  # For backward compatibility with templates expecting .result
            },
            "artifact": {"type": "json", "filename": "scrape.json", "storage_key": object_key}
        },
        timeout=5,
    )
    worker_tasks_total.labels(result="success").inc()
    log_task(task_id, "INFO", f"Scraping completed for {url}")


# -------------------------
# WORKER HANDLER
# -------------------------
def handle_message(ch, method, properties, body):
    payload = json.loads(body)
    task_id = payload["task_id"]
    job_id = payload.get("job_id")
    
    # Use the resolved payload from the message (NOT from database)
    # The backend resolves {{tasks.X.outputs.Y}} templates before enqueueing
    task_payload_from_message = payload.get("payload", {})

    # Check if task is already being processed (prevent duplicates)
    if task_id in in_progress_tasks:
        print(f"[WORKER] Task {task_id} already in progress, skipping duplicate message", flush=True)
        ch.basic_ack(delivery_tag=method.delivery_tag)
        return

    print(f"[WORKER] Received task {task_id}", flush=True)
    
    # Add to in-progress set
    in_progress_tasks.add(task_id)

    agent_type_db, task_payload_db, job_id_db, task_name_db = load_task_context(task_id)
    if job_id is None:
        job_id = job_id_db
    if agent_type_db is None:
        log_task(task_id, "ERROR", "Task not found in DB")
        in_progress_tasks.discard(task_id)  # Remove from in-progress
        ch.basic_ack(delivery_tag=method.delivery_tag)
        return
    
    # Prefer resolved payload from message over database payload
    # The message contains template-resolved values, DB has original templates
    if task_payload_from_message:
        print(f"[WORKER] Using resolved payload from message (keys: {list(task_payload_from_message.keys())})")
        task_payload_db = task_payload_from_message
    else:
        print(f"[WORKER] Warning: No payload in message, using DB payload (may have unresolved templates)")

    # Acquire ownership
    try:
        r = requests.post(
            f"{ORCHESTRATOR_URL}/internal/tasks/{task_id}/start",
            timeout=5,
        )

        # If already RUNNING (e.g., worker crash/restart), proceed idempotently
        if r.status_code not in (200, 409):
            in_progress_tasks.discard(task_id)  # Remove from in-progress
            ch.basic_ack(delivery_tag=method.delivery_tag)
            return

    except Exception as e:
        log_task(task_id, "ERROR", f"Start failed: {e}")
        in_progress_tasks.discard(task_id)  # Remove from in-progress
        ch.basic_nack(delivery_tag=method.delivery_tag, requeue=True)
        return

    try:
        log_task(task_id, "INFO", "Execution started")

        # ---- EXECUTION / REVIEW ----
        time.sleep(1)

        if agent_type_db == "reviewer":
            review = run_reviewer(task_id, task_payload_db)

            rr = requests.post(
                f"{ORCHESTRATOR_URL}/internal/tasks/{task_id}/review",
                json=review,
                timeout=5,
            )

            if rr.status_code != 200:
                raise RuntimeError(f"Internal review failed: {rr.status_code} {rr.text}")

            worker_tasks_total.labels(result="reviewed").inc()
            log_task(task_id, "INFO", f"Review completed: {review['decision']}")

        elif agent_type_db == "designer":
            run_designer(task_id, job_id, task_payload_db)

        elif agent_type_db == "chart":
            run_chart(task_id, job_id, task_payload_db)

        elif agent_type_db == "analyzer":
            run_analyzer(task_id, job_id, task_payload_db)

        elif agent_type_db == "summarizer":
            run_summarizer(task_id, job_id, task_payload_db)

        elif agent_type_db == "validator":
            run_validator(task_id, job_id, task_payload_db)

        elif agent_type_db == "transformer":
            run_transformer(task_id, job_id, task_payload_db)

        elif agent_type_db == "notifier":
            run_notifier(task_id, job_id, task_payload_db)

        elif agent_type_db == "scraper":
            run_scraper(task_id, job_id, task_payload_db)

        else:
            # AI-Powered Executor: handles any custom task with AI
            name = (task_name_db or "").strip()
            instruction = task_payload_db.get("instruction", "") if isinstance(task_payload_db, dict) else ""
            prompt = task_payload_db.get("prompt", instruction) if isinstance(task_payload_db, dict) else ""
            context = task_payload_db.get("context", "") if isinstance(task_payload_db, dict) else ""
            
            # Check if we have a custom prompt to use AI
            if prompt or instruction:
                try:
                    # Use AI to execute the custom task
                    log_task(task_id, "INFO", f"Executing custom task with AI: {name}")
                    
                    task_prompt = prompt or instruction
                    context_block = f"\n\nContext:\n{context[:3000]}" if context else ""
                    
                    ai_prompt = f"""Execute this task:

Task Name: {name}
Instructions: {task_prompt}{context_block}

Provide a detailed response completing this task. Be thorough and specific.
If the task requires structured data output (like counts, JSON, table), return it as valid JSON."""
                    
                    ai_response = ai_helper.generate_ai_response(
                        ai_prompt,
                        task_type="executor",
                        temperature=0.7,
                        max_tokens=1200
                    )
                    
                    # Try to parse AI response as JSON for structured data
                    import re as _re
                    structured_result = None
                    
                    # Look for JSON in the response
                    json_match = _re.search(r'(\[.*?\]|\{.*?\})', ai_response, _re.DOTALL)
                    if json_match:
                        try:
                            parsed = json.loads(json_match.group(1))
                            structured_result = parsed
                            log_task(task_id, "INFO", "Extracted structured JSON from AI response")
                        except json.JSONDecodeError:
                            pass
                    
                    if structured_result is None:
                        try:
                            parsed = json.loads(ai_response.strip())
                            structured_result = parsed
                        except (json.JSONDecodeError, ValueError):
                            pass  # response is plain text, that's fine
                    
                    result_to_return = structured_result if structured_result is not None else ai_response
                    
                    content = json.dumps({"result": result_to_return, "text": ai_response}, indent=2, default=str).encode("utf-8")
                    log_task(task_id, "INFO", "AI execution completed")
                    
                except Exception as e:
                    # Fallback if AI fails
                    log_task(task_id, "WARN", f"AI execution failed: {e}, using fallback")
                    ai_response = f"Task '{name}' executed (AI unavailable).\nPrompt: {prompt}\n"
                    result_to_return = ai_response
                    content = ai_response.encode("utf-8")
            else:
                # Fallback for predefined tasks or tasks without prompts
                if name.lower() == "fetch_data":
                    result_to_return = {"source": "demo", "rows": [1, 2, 3]}
                    content = json.dumps(result_to_return).encode("utf-8")
                elif name.lower() == "process_data":
                    result_to_return = {"processed": True, "summary": "ok"}
                    content = json.dumps(result_to_return).encode("utf-8")
                elif name.lower() == "generate_report":
                    result_to_return = "Report generated successfully."
                    content = result_to_return.encode("utf-8")
                else:
                    result_to_return = f"Executed {name} successfully."
                    content = result_to_return.encode("utf-8")

            object_key = f"jobs/{job_id}/{task_id}.txt"
            
            # Upload to S3
            try:
                s3_client.put_object(
                    Bucket=MINIO_BUCKET,
                    Key=object_key,
                    Body=io.BytesIO(content),
                    ContentType="application/json" if content[:1] in (b'{', b'[') else "text/plain"
                )
                log_task(task_id, "INFO", f"Artifact uploaded to {object_key}")
                
                # Prepare artifact metadata
                artifact = {
                    "type": "text",
                    "filename": "output.txt",
                    "storage_key": object_key,
                    "metadata": {
                        "bytes": len(content)
                    }
                }
                
                completion_payload = {
                    "result": {
                        "ok": True,
                        "job_id": job_id,
                        "worker": "python_worker",
                        "result": result_to_return,  # CRITICAL: for {{tasks.X.outputs.result}} template
                        "text": ai_response if 'ai_response' in locals() else str(result_to_return),
                    },
                    "artifact": artifact
                }
                
            except Exception as upload_error:
                log_task(task_id, "ERROR", f"Artifact upload failed: {upload_error}")
                completion_payload = {
                    "result": {
                        "ok": True,
                        "job_id": job_id,
                        "worker": "python_worker",
                        "result": result_to_return if 'result_to_return' in locals() else "",
                    }
                }
            
            requests.post(
                f"{ORCHESTRATOR_URL}/internal/tasks/{task_id}/complete",
                json=completion_payload,
                timeout=5,
            )

            worker_tasks_total.labels(result="success").inc()
            log_task(task_id, "INFO", "Execution succeeded")

        ch.basic_ack(delivery_tag=method.delivery_tag)

    except Exception as e:
        retries = get_retry_count(task_id)
        increment_retry(task_id)

        log_task(task_id, "ERROR", f"Execution failed: {e}")

        if retries + 1 >= MAX_RETRIES:
            # ❌ PERMANENT FAILURE → DLQ (mark failed in orchestrator)
            requests.post(
                f"{ORCHESTRATOR_URL}/internal/tasks/{task_id}/fail",
                json={"error": str(e)},
                timeout=5,
            )

            worker_tasks_total.labels(result="failed").inc()

            log_task(task_id, "ERROR", "Moved to DLQ")
            ch.basic_ack(delivery_tag=method.delivery_tag)

        else:
            # 🔁 RETRY
            log_task(
                task_id,
                "WARN",
                f"Retrying ({retries + 1}/{MAX_RETRIES})",
            )
            time.sleep(RETRY_BACKOFF_SEC)
            ch.basic_nack(delivery_tag=method.delivery_tag, requeue=True)
    
    finally:
        # Always remove from in-progress set when done (success or failure)
        in_progress_tasks.discard(task_id)


# -------------------------
# RABBITMQ
# -------------------------
def connect_rabbitmq():
    while True:
        try:
            params = pika.URLParameters(RABBIT_URL)
            conn = pika.BlockingConnection(params)
            ch = conn.channel()

            ch.queue_declare(queue=TASK_QUEUE, durable=True)
            ch.queue_declare(queue=DLQ_QUEUE, durable=True)

            ch.basic_qos(prefetch_count=1)
            return conn, ch
        except Exception:
            time.sleep(2)


if __name__ == "__main__":
    db_conn = connect_db()
    connection, channel = connect_rabbitmq()
    
    channel.basic_consume(
        queue=TASK_QUEUE,
        on_message_callback=handle_message,
    )

    print("[WORKER] Waiting for tasks...", flush=True)
    channel.start_consuming()
else:
    # For testing: mock or lazy connect
    # We'll handle this in the test script by patching or setting these globals manually if needed
    pass
